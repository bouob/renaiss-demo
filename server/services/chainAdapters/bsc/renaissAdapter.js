// renaissAdapter.js — ported subset of
// D:/Desktop/Dokipoki/server/services/chainAdapters/bsc/renaissAdapter.js
//
// Scope: Merchant Copilot only needs two read-only questions answered —
// "what tokenIds does this wallet currently hold" (fetchHoldings) and "what
// card is tokenId X" (fetchNFTAttributes). Everything the Dokipoki source
// builds on top of the raw transfer walk for portfolio bookkeeping — a
// durable per-wallet transfer cursor, USDT/pack-purchase cost-basis
// recovery, cross-wallet cost recovery for cards that changed custody
// upstream, marketplace-sale classification, and transaction-history
// classification — is dropped entirely here, not stubbed. This app tracks
// inventory cost via /meta (user-entered or on-chain-derived elsewhere), not
// via a full ledger replay.
//
// No durable per-wallet cursor is persisted in this file — every call below
// does a full genesis→latest walk, short-TTL in-memory cached per
// wallet/tokenId. adminDb is kept as an inert null stub purely so this file
// never needs a Firebase Admin import.
const adminDb = null; // eslint-disable-line no-unused-vars -- documents the absence, see header comment

// ─── Contract + selectors ───────────────────────────────────────────────────

export const CONTRACT = '0xF8646A3Ca093e97Bb404c3b25e675C0394DD5b30';
// ERC-721 tokenURI(uint256) selector
const TOKEN_URI_SELECTOR = '0xc87b56dd';

// ─── Endpoint plumbing ──────────────────────────────────────────────────────

/**
 * Reads BSC_RPC_URL from process.env (never hardcoded) and derives the
 * Alchemy NFT API path from it. Returns null — never throws — when the env
 * var is unset or not a recognizable Alchemy v2 URL, so callers can fail
 * open instead of crashing a request.
 */
function getEndpoints() {
  const url = process.env.BSC_RPC_URL;
  if (!url) return null;
  const match = url.match(/^(https:\/\/[^/]+)\/v2\/(.+)$/);
  if (!match) return null;
  return { jsonrpc: url, nft: `${match[1]}/nft/v3/${match[2]}` };
}

/** True when BSC_RPC_URL is set and shaped like an Alchemy v2 URL. */
export function isConfigured() {
  return getEndpoints() != null;
}

// Global concurrency cap shared across all scan requests in this process —
// bounds how many Alchemy HTTP requests are in flight at once.
let _semActive = 0;
const _semQueue = [];
const ALCHEMY_MAX_CONCURRENT = Number(process.env.ALCHEMY_MAX_CONCURRENT) || 12;
// Alchemy Pay-As-You-Go allows 10,000 compute units per second, account-wide.
// This limiter is in-memory and therefore per-process; keep comfortably under
// the account ceiling so a burst here can't starve other Alchemy callers.
const ALCHEMY_CU_PER_SECOND = 10_000;
const ALCHEMY_CU_LIMIT = Number(process.env.ALCHEMY_CU_LIMIT) || Math.floor(ALCHEMY_CU_PER_SECOND * 0.5);
const RPC_MAX_RETRIES = 4;
const RPC_CALL_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const METHOD_CU_COST = {
  alchemy_getAssetTransfers: 120,
  eth_call: 26,
};

// ─── CU/s rate limiter (sliding window) ─────────────────────────────────────
// CU-weighted sliding-window limiter: a call is admitted only when the CU
// charged in the trailing 1s plus the call's own cost stays within
// ALCHEMY_CU_LIMIT.
const _cuSpendLog = []; // [{ ts, cost }] — CU admitted within the last ~1s
let _cuPressureLoggedAt = 0;

function cuWindowSpend(now) {
  while (_cuSpendLog.length && now - _cuSpendLog[0].ts > 1000) _cuSpendLog.shift();
  return _cuSpendLog.reduce((sum, e) => sum + e.cost, 0);
}

function acquireSlot() {
  if (_semActive < ALCHEMY_MAX_CONCURRENT) {
    _semActive++;
    return Promise.resolve();
  }
  return new Promise((resolve) => _semQueue.push(resolve));
}

function releaseSlot() {
  if (_semQueue.length) {
    _semQueue.shift()();
  } else {
    _semActive--;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CU-weighted sliding-window rate limiter. Resolves once `cost` CU can be
 * spent without the trailing-1s total exceeding ALCHEMY_CU_LIMIT.
 */
async function acquireCuBudget(method, cost) {
  const charge = Math.min(cost, ALCHEMY_CU_LIMIT);
  while (true) {
    const now = Date.now();
    if (cuWindowSpend(now) + charge <= ALCHEMY_CU_LIMIT) {
      _cuSpendLog.push({ ts: now, cost: charge });
      const spend = _cuSpendLog.reduce((sum, e) => sum + e.cost, 0);
      if (spend >= ALCHEMY_CU_LIMIT * 0.9 && now - _cuPressureLoggedAt > 60_000) {
        _cuPressureLoggedAt = now;
        console.warn(`[renaissAdapter] CU/s pressure: ${spend}/${ALCHEMY_CU_LIMIT} (last method: ${method})`);
      }
      return;
    }
    const oldest = _cuSpendLog[0];
    const waitMs = oldest ? Math.max(25, 1000 - (now - oldest.ts) + 5) : 25;
    await sleep(waitMs);
  }
}

function isRetryableRpcError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const message = String(err.message || err);
  return (
    message.includes('compute units per second capacity') ||
    message.includes('Unexpected end of JSON input') ||
    message.includes('RPC response was empty') ||
    message.includes('fetch failed') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('network timeout') ||
    message.includes('aborted')
  );
}

function getRetryDelayMs(attempt, err) {
  if (err?.status === 429) {
    return Math.min(30_000, 2_000 * (2 ** attempt));
  }
  return Math.min(2000, 150 * (2 ** attempt));
}

function getRetryAfterMs(headers) {
  const value = headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function getRpcHttpRetryDelayMs(attempt, err) {
  const retryAfterMs = getRetryAfterMs(err?.headers);
  if (retryAfterMs != null) return Math.min(retryAfterMs, 60_000);
  const baseMs = getRetryDelayMs(attempt, err);
  return Math.min(60_000, baseMs + Math.floor(Math.random() * 1000));
}

/**
 * JSON-RPC call against BSC_RPC_URL with CU-budgeted throttling and bounded
 * retry. Throws if the endpoint is unconfigured — callers MUST check
 * isConfigured() first and fail open before reaching here (fetchHoldings and
 * fetchNFTAttributes below both do this).
 */
async function rpc(method, params) {
  const endpoints = getEndpoints();
  if (!endpoints) throw new Error('BSC_RPC_URL is not configured');
  const cost = METHOD_CU_COST[method] ?? 30;
  let lastError = null;
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt += 1) {
    let retryDelayMs = null;
    await acquireCuBudget(method, cost);
    await acquireSlot();
    try {
      const callController = new AbortController();
      const callTimer = setTimeout(() => callController.abort(), RPC_CALL_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(endpoints.jsonrpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: callController.signal,
        });
      } finally {
        clearTimeout(callTimer);
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const err = new Error(`RPC ${method} HTTP ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`);
        err.status = res.status;
        err.headers = res.headers;
        throw err;
      }
      const text = await res.text();
      if (!text.trim()) {
        throw new Error(`RPC ${method} response was empty`);
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error(`RPC ${method} parse failed: ${err.message}`);
      }
      if (data.error) throw new Error(`RPC ${method} error: ${data.error.message}`);
      return data.result;
    } catch (err) {
      lastError = err;
      const retryable =
        (typeof err.status === 'number' && RETRYABLE_STATUS_CODES.has(err.status)) ||
        isRetryableRpcError(err);
      if (!retryable || attempt >= RPC_MAX_RETRIES) {
        if (err.status === 429) {
          err.code = 'rate_limit_exceeded';
        }
        throw err;
      }
      retryDelayMs = getRpcHttpRetryDelayMs(attempt, err);
    } finally {
      releaseSlot();
    }
    if (retryDelayMs != null) await sleep(retryDelayMs);
  }
  throw lastError ?? new Error(`RPC ${method} failed`);
}

// ─── eth_call cache ─────────────────────────────────────────────────────────
// eth_call against `latest` is non-deterministic in general, but for the
// tokenURI(uint256) reads done here it returns the same string for the life
// of the token. Cache by (to + data) with LRU eviction so a long-lived
// process handling many distinct tokens cannot grow this map unbounded.
const ethCallCache = new Map(); // key -> Promise<hex result>
const ETH_CALL_CACHE_MAX = 1000;

function ethCallCacheKey(to, data) {
  return `${(to || '').toLowerCase()}|${data || ''}`;
}

function setEthCallCache(key, value) {
  if (!ethCallCache.has(key) && ethCallCache.size >= ETH_CALL_CACHE_MAX) {
    const oldest = ethCallCache.keys().next().value;
    if (oldest !== undefined) ethCallCache.delete(oldest);
  }
  ethCallCache.set(key, value);
}

async function ethCall(callParams, blockTag = 'latest') {
  const key = ethCallCacheKey(callParams.to, callParams.data);
  if (ethCallCache.has(key)) {
    const cached = ethCallCache.get(key);
    ethCallCache.delete(key);
    ethCallCache.set(key, cached);
    return cached;
  }
  const p = rpc('eth_call', [callParams, blockTag]).catch((err) => {
    ethCallCache.delete(key);
    throw err;
  });
  setEthCallCache(key, p);
  return p;
}

const toHex = (n) => '0x' + BigInt(n).toString(16);

function normalizeBlock(b) {
  if (typeof b === 'number') return b;
  if (typeof b !== 'string') return Number(b);
  return b.startsWith('0x') ? parseInt(b, 16) : parseInt(b, 10);
}

function normalizeTokenId(t) {
  if (t == null) return null;
  const s = String(t);
  return s.startsWith('0x') ? BigInt(s).toString() : s;
}

// ─── Transfer walk (NFT-only, no durable cursor) ────────────────────────────
// Every call walks genesis→latest for the requested direction; there is no
// per-wallet cursor to resume from, so results are cached in-memory with a
// short TTL to absorb repeated calls within one request lifecycle.

const PAGINATION_MAX_PAGES = 200;
const TRANSFERS_TTL_MS = 60_000;

async function paginatedTransfers(directionParam, fromBlock = 0) {
  const out = [];
  let pageKey;
  let pages = 0;
  while (true) {
    if (pages >= PAGINATION_MAX_PAGES) {
      console.warn(`[renaissAdapter] paginatedTransfers hit MAX_PAGES (${PAGINATION_MAX_PAGES}), stopping early`);
      break;
    }
    const result = await rpc('alchemy_getAssetTransfers', [
      {
        fromBlock: toHex(fromBlock),
        toBlock: 'latest',
        ...directionParam,
        contractAddresses: [CONTRACT],
        category: ['erc721'],
        withMetadata: false,
        maxCount: '0x3e8',
        ...(pageKey ? { pageKey } : {}),
      },
    ]);
    pages++;
    out.push(...(result.transfers ?? []));
    if (!result.pageKey) break;
    pageKey = result.pageKey;
  }
  return out;
}

const transfersCache = new Map(); // wallet -> { ts, transfers }
const transfersFetchCache = new Map(); // wallet -> Promise — dedupes concurrent fetches

async function loadAllTransfers(walletAddress) {
  const key = walletAddress.toLowerCase();
  const cached = transfersCache.get(key);
  if (cached && Date.now() - cached.ts < TRANSFERS_TTL_MS) return cached.transfers;
  if (transfersFetchCache.has(key)) return transfersFetchCache.get(key);

  const fetchPromise = Promise.all([
    paginatedTransfers({ fromAddress: walletAddress }),
    paginatedTransfers({ toAddress: walletAddress }),
  ]).then(([outgoing, incoming]) => {
    const seen = new Set();
    const transfers = [];
    for (const t of [...incoming, ...outgoing]) {
      const id = t.uniqueId ?? `${t.hash}:${t.blockNum}:${t.tokenId ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      transfers.push(t);
    }
    transfersCache.set(key, { ts: Date.now(), transfers });
    transfersFetchCache.delete(key);
    return transfers;
  }).catch((err) => {
    transfersFetchCache.delete(key);
    throw err;
  });

  transfersFetchCache.set(key, fetchPromise);
  return fetchPromise;
}

// ─── fetchHoldings ───────────────────────────────────────────────────────────

/**
 * Returns a Map<tokenId, { held: boolean, latestTransferHash: string|null }>
 * for the given wallet. Walks all transfers chronologically; last
 * `to === wallet` wins per tokenId. Fails open to an empty Map — without a
 * network call — when BSC_RPC_URL is unconfigured.
 */
export async function fetchHoldings(walletAddress) {
  if (!isConfigured()) return new Map();

  const wallet = walletAddress.toLowerCase();
  const transfers = await loadAllTransfers(walletAddress);

  const sorted = [...transfers].sort(
    (a, b) => normalizeBlock(a.blockNum) - normalizeBlock(b.blockNum)
  );

  const holdings = new Map();
  for (const t of sorted) {
    const tokenId = normalizeTokenId(t.tokenId);
    if (!tokenId) continue;
    const to = (t.to ?? '').toLowerCase();
    holdings.set(tokenId, { held: to === wallet, latestTransferHash: t.hash ?? null });
  }
  return holdings;
}

// ─── fetchNFTAttributes ──────────────────────────────────────────────────────

function decodeStringReturn(hex) {
  if (!hex || hex === '0x') return null;
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  const offset = parseInt(data.slice(0, 64), 16) * 2;
  const length = parseInt(data.slice(offset, offset + 64), 16) * 2;
  const strHex = data.slice(offset + 64, offset + 64 + length);
  return Buffer.from(strHex, 'hex').toString('utf8');
}

const IPFS_GATEWAYS = ['ipfs.io', 'dweb.link', 'nftstorage.link', 'cloudflare-ipfs.com'];
// Renaiss's graded-card assets (and potentially metadata) live on Vercel Blob
// Storage. The subdomain is the storage account ID for their bucket; it won't
// change between tokens.
const VERCEL_BLOB_HOST = '8nothtoc5ds7a0x3.public.blob.vercel-storage.com';
const ALLOWED_HOSTS = new Set([...IPFS_GATEWAYS, 'arweave.net', 'renaiss.xyz', VERCEL_BLOB_HOST]);
const METADATA_FETCH_TIMEOUT_MS = Number(process.env.RENAISS_METADATA_FETCH_TIMEOUT_MS) || 20_000;
const METADATA_MAX_BYTES = 64 * 1024;

function resolveURI(uri) {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

async function fetchMetadataJSON(uri) {
  if (!uri) return null;
  if (uri.startsWith('data:application/json')) {
    const b64idx = uri.indexOf(';base64,');
    if (b64idx !== -1) {
      return JSON.parse(
        Buffer.from(uri.slice(b64idx + 8), 'base64').toString('utf8')
      );
    }
    const commaIdx = uri.indexOf(',');
    return JSON.parse(decodeURIComponent(uri.slice(commaIdx + 1)));
  }
  const resolved = resolveURI(uri);
  let parsed;
  try {
    parsed = new URL(resolved);
  } catch {
    throw new Error(`metadata URI is not a valid URL: ${resolved}`);
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`metadata URI host not allowed: ${parsed.hostname}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(resolved, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`metadata fetch ${res.status} for ${resolved}`);
    const contentLengthHeader = res.headers.get('content-length');
    const contentLength = Number.parseInt(contentLengthHeader ?? '', 10);
    if (Number.isFinite(contentLength) && contentLength > METADATA_MAX_BYTES) {
      throw new Error('metadata response too large');
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (
      contentType
      && !contentType.includes('application/json')
      && !contentType.includes('text/plain')
      && !contentType.includes('application/octet-stream')
    ) {
      throw new Error(`metadata content type not allowed: ${contentType}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > METADATA_MAX_BYTES) throw new Error('metadata response too large');
    return JSON.parse(Buffer.from(buf).toString('utf8'));
  } finally {
    clearTimeout(timer);
  }
}

// Renaiss "Grade" trait combines number + label, e.g. "9 Mint", "10 Gem Mint".
function splitGrade(raw) {
  if (!raw) return { grade: null, gradeLabel: null };
  const match = String(raw).match(/^(\S+)\s+(.+)$/);
  if (match) return { grade: match[1], gradeLabel: match[2] };
  return { grade: String(raw), gradeLabel: null };
}

function normalizeMetadata(meta) {
  if (!meta) return null;
  const attrs = meta.attributes ?? [];
  const get = (trait) =>
    attrs.find((a) => (a.trait_type ?? a.traitType) === trait)?.value ?? null;

  const { grade, gradeLabel } = splitGrade(get('Grade'));

  return {
    grader: get('Grader'),
    grade,
    gradeLabel,
    serial: get('Serial'),
    year: get('Year') ? Number(get('Year')) : null,
    set: get('Set'),
    language: get('Language'),
    cardNumber: get('Card Number'),
    vaultRegion: get('Vault Region'),
    vaultBusiness: get('Vault Business Name'),
    verifierBusiness: get('Verifier Business Name'),
    status: get('Status'),
    productType: meta.product_type ?? null,
    image: meta.image ?? null,
    name: meta.name ?? null,
    collectionName: meta.collection_name ?? null,
    externalUrl: meta.external_url ?? null,
  };
}

async function fetchMetadataFromAlchemy(tokenId) {
  const endpoints = getEndpoints();
  if (!endpoints) return null;
  const url = new URL(`${endpoints.nft}/getNFTMetadata`);
  url.searchParams.set('contractAddress', CONTRACT);
  url.searchParams.set('tokenId', String(tokenId));
  url.searchParams.set('refreshCache', 'false');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`Alchemy getNFTMetadata HTTP ${res.status}`);
    const data = await res.json();
    if (data?.raw?.error) throw new Error(`metadata unavailable: ${data.raw.error}`);
    return data?.raw?.metadata ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns structured card attributes for a tokenId via on-chain tokenURI().
 * Falls back to Alchemy getNFTMetadata if the origin metadata server
 * (renaiss.xyz) is unreachable, or if the on-chain tokenURI read itself
 * reverts. Fails open to null — without a network call — when BSC_RPC_URL is
 * unconfigured.
 */
export async function fetchNFTAttributes(tokenId) {
  if (!isConfigured()) return null;

  let uri = null;
  let tokenUriError = null;
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const raw = await ethCall({ to: CONTRACT, data: TOKEN_URI_SELECTOR + tokenIdHex });
    uri = decodeStringReturn(raw);
  } catch (err) {
    tokenUriError = err;
  }

  if (uri == null) {
    const metadata = await fetchMetadataFromAlchemy(tokenId).catch(() => null);
    if (metadata == null && tokenUriError) throw tokenUriError;
    return normalizeMetadata(metadata);
  }

  let metadata;
  try {
    metadata = await fetchMetadataJSON(uri);
  } catch {
    metadata = await fetchMetadataFromAlchemy(tokenId);
  }
  return normalizeMetadata(metadata);
}
