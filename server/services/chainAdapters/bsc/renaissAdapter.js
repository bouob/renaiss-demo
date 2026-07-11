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
const USDT_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// Pack sale contracts (same set as Dokipoki txClassifier) — NFTs leave these
// to the buyer on pack open; USDT payments to these fund cost basis.
export const PACK_SALE_CONTRACTS = new Set([
  '0xaab5f5fa75437a6e9e7004c12c9c56cda4b4885a', // special / standard packs
  '0x94e7732b0b2e7c51ffd0d56580067d9c2e2b7910', // $48 packs (OMEGA)
  '0xb2891022648c5fad3721c42c05d8d283d4d53080', // $88 packs (RenaCrypt)
  '0xfda4a907d23d9f24271bc47483c5b983831e325e', // $150/card packs (5-card bundle)
]);
// Renaiss system buyback (Dokipoki txClassifier.BUYBACK_CONTRACT)
export const BUYBACK_CONTRACT = '0x94e7732b0b2e7c51ffd0d56580067d9c2e2b7910';
export const REDEEM_SINKS = new Set([
  '0x72a004654cef4694a6377f5b019d0489ba8a6c9e',
]);
// ERC-721 tokenURI(uint256) selector
const TOKEN_URI_SELECTOR = '0xc87b56dd';

export const MAX_SALES = 200;

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
        withMetadata: true, // need blockTimestamp for soldAt
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
 * Returns a Map<tokenId, {
 *   held: boolean,
 *   latestTransferHash: string|null,
 *   acquiredFrom: string|null,
 *   acquiredBlock: number|null,
 * }>
 * Walks transfers chronologically; last `to === wallet` wins per tokenId.
 * Fails open to an empty Map when BSC_RPC_URL is unconfigured.
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
    const from = (t.from ?? '').toLowerCase();
    holdings.set(tokenId, {
      held: to === wallet,
      latestTransferHash: t.hash ?? null,
      acquiredFrom: to === wallet ? from : (holdings.get(tokenId)?.acquiredFrom ?? null),
      acquiredBlock: to === wallet ? normalizeBlock(t.blockNum) : (holdings.get(tokenId)?.acquiredBlock ?? null),
    });
  }
  return holdings;
}

// ─── Pack purchase cost (minimal port of Dokipoki pack-payment correlation) ─

async function paginatedUsdtOut(walletAddress) {
  const out = [];
  let pageKey;
  let pages = 0;
  while (pages < PAGINATION_MAX_PAGES) {
    const result = await rpc('alchemy_getAssetTransfers', [
      {
        fromBlock: '0x0',
        toBlock: 'latest',
        fromAddress: walletAddress,
        contractAddresses: [USDT_CONTRACT],
        category: ['erc20'],
        withMetadata: false,
        maxCount: '0x3e8',
        ...(pageKey ? { pageKey } : {}),
      },
    ]);
    pages += 1;
    out.push(...(result.transfers ?? []));
    if (!result.pageKey) break;
    pageKey = result.pageKey;
  }
  return out;
}

const packPurchasesCache = new Map(); // wallet -> { ts, purchases }

/**
 * USDT payments from wallet to known pack-sale contracts.
 * Alchemy normalises ERC-20 `value` using token decimals (USDT human USD).
 * @returns {Promise<Array<{txHash,blockNumber,amountUSD,packContract}>>}
 */
export async function loadPackPurchases(walletAddress) {
  if (!isConfigured()) return [];
  const key = walletAddress.toLowerCase();
  const cached = packPurchasesCache.get(key);
  if (cached && Date.now() - cached.ts < TRANSFERS_TTL_MS) return cached.purchases;

  const usdtOut = await paginatedUsdtOut(walletAddress);
  const purchases = [];
  for (const t of usdtOut) {
    const to = (t.to ?? '').toLowerCase();
    if (!PACK_SALE_CONTRACTS.has(to)) continue;
    const amount = Number(t.value);
    purchases.push({
      txHash: t.hash ?? null,
      blockNumber: normalizeBlock(t.blockNum),
      amountUSD: Number.isFinite(amount) ? amount : null,
      packContract: to,
    });
  }
  purchases.sort((a, b) => a.blockNumber - b.blockNumber);
  packPurchasesCache.set(key, { ts: Date.now(), purchases });
  return purchases;
}

function matchPackPayment(purchases, blockNumber, preferTxHash) {
  if (!Array.isArray(purchases) || purchases.length === 0) return null;
  if (preferTxHash) {
    const sameTx = purchases.find(
      (p) => p.txHash && String(p.txHash).toLowerCase() === String(preferTxHash).toLowerCase(),
    );
    if (sameTx) return sameTx;
  }
  const block = Number(blockNumber);
  if (!Number.isFinite(block)) return null;
  // Most recent pack payment at or before the NFT acquisition block
  let best = null;
  for (const p of purchases) {
    if (p.blockNumber <= block) best = p;
    else break;
  }
  // Also allow same-block / slightly later (payment sometimes lands same block)
  if (!best) {
    const near = purchases.find((p) => Math.abs(p.blockNumber - block) <= 2);
    if (near) return near;
  }
  return best;
}

/**
 * Classify acquisition + prefill per-card pack cost for currently-held tokens.
 * PACK_PULL / MINT → correlate pack USDT payment; secondary transfer → no auto cost.
 *
 * Multi-card packs: if several held tokens share the same payment tx, divide
 * total USDT by that group size (best-effort; unknown pack size uses group size).
 *
 * @param {string} walletAddress
 * @param {Map<string, object>} holdingsMap - from fetchHoldings
 * @returns {Promise<Map<string, {
 *   acquireType: 'PACK_PULL'|'MINT'|'TRANSFER'|'UNKNOWN',
 *   onChainCostUsd: number|null,
 *   costSource: string,
 *   packPaymentTxHash: string|null,
 *   packContract: string|null,
 * }>>}
 */
export async function enrichHoldingsWithPackCost(walletAddress, holdingsMap) {
  const out = new Map();
  if (!isConfigured() || !holdingsMap?.size) return out;

  let purchases = [];
  try {
    purchases = await loadPackPurchases(walletAddress);
  } catch (err) {
    console.warn(`[renaissAdapter] loadPackPurchases failed: ${err?.message ?? err}`);
    purchases = [];
  }

  /** @type {Map<string, string[]>} paymentTx -> tokenIds */
  const paymentGroups = new Map();
  const draft = new Map();

  for (const [tokenId, row] of holdingsMap) {
    if (!row?.held) continue;
    const from = (row.acquiredFrom ?? '').toLowerCase();
    let acquireType = 'UNKNOWN';
    if (from && PACK_SALE_CONTRACTS.has(from)) acquireType = 'PACK_PULL';
    else if (from === ZERO_ADDRESS) acquireType = 'MINT';
    else if (from) acquireType = 'TRANSFER';

    let payment = null;
    if (acquireType === 'PACK_PULL' || acquireType === 'MINT') {
      payment = matchPackPayment(purchases, row.acquiredBlock, row.latestTransferHash);
    }

    const paymentTx = payment?.txHash ? String(payment.txHash).toLowerCase() : null;
    if (paymentTx) {
      if (!paymentGroups.has(paymentTx)) paymentGroups.set(paymentTx, []);
      paymentGroups.get(paymentTx).push(tokenId);
    }

    draft.set(tokenId, {
      acquireType,
      payment,
      packContract: acquireType === 'PACK_PULL' ? from : (payment?.packContract ?? null),
      packPaymentTxHash: paymentTx,
    });
  }

  for (const [tokenId, d] of draft) {
    let onChainCostUsd = null;
    let costSource = 'unavailable';

    if (d.acquireType === 'TRANSFER') {
      costSource = 'secondary_transfer';
    } else if (d.payment && Number.isFinite(d.payment.amountUSD) && d.payment.amountUSD > 0) {
      const group = d.packPaymentTxHash ? paymentGroups.get(d.packPaymentTxHash) : null;
      const n = group?.length > 0 ? group.length : 1;
      onChainCostUsd = d.payment.amountUSD / n;
      costSource = n > 1 ? 'pack_payment_split' : 'pack_payment';
    } else if (d.acquireType === 'PACK_PULL' || d.acquireType === 'MINT') {
      costSource = 'pack_unmatched';
    }

    out.set(tokenId, {
      acquireType: d.acquireType,
      onChainCostUsd: Number.isFinite(onChainCostUsd) ? onChainCostUsd : null,
      costSource,
      packPaymentTxHash: d.packPaymentTxHash,
      packContract: d.packContract,
    });
  }

  return out;
}

// ─── Sale history (simplified ledger from transfer walk) ─────────────────────

async function paginatedUsdtIn(walletAddress) {
  const out = [];
  let pageKey;
  let pages = 0;
  while (pages < PAGINATION_MAX_PAGES) {
    const result = await rpc('alchemy_getAssetTransfers', [
      {
        fromBlock: '0x0',
        toBlock: 'latest',
        toAddress: walletAddress,
        contractAddresses: [USDT_CONTRACT],
        category: ['erc20'],
        withMetadata: false,
        maxCount: '0x3e8',
        ...(pageKey ? { pageKey } : {}),
      },
    ]);
    pages += 1;
    out.push(...(result.transfers ?? []));
    if (!result.pageKey) break;
    pageKey = result.pageKey;
  }
  return out;
}

function blockTimestampMs(blockNum, metadata) {
  // Alchemy transfer may include metadata.blockTimestamp
  const raw = metadata?.blockTimestamp || metadata?.timestamp;
  if (raw) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function saleIdFor({ tokenId, saleTxHash, soldAtMs }) {
  const basis = `${tokenId}|${saleTxHash || ''}|${soldAtMs || 0}`;
  // short stable id without crypto dep
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
  return `sale_${Math.abs(h).toString(36)}_${String(tokenId).slice(-8)}`;
}

/**
 * Build sold-history rows from NFT transfers out of wallet + USDT inflows.
 * Cost basis: last pack payment correlated when the NFT entered the wallet.
 *
 * @returns {Promise<{ sales: object[], summary: object, truncated: boolean }>}
 */
export async function fetchSaleHistory(walletAddress) {
  if (!isConfigured()) {
    return {
      sales: [],
      summary: { count: 0, totalSoldUsd: 0, totalCostUsd: 0, totalRealizedPnlUsd: 0 },
      truncated: false,
    };
  }

  const wallet = walletAddress.toLowerCase();
  const [nftTransfers, purchases, usdtIn] = await Promise.all([
    loadAllTransfers(walletAddress),
    loadPackPurchases(walletAddress).catch(() => []),
    paginatedUsdtIn(walletAddress).catch(() => []),
  ]);

  /** @type {Map<string, number>} txHash -> total USDT USD into wallet */
  const usdtInByTx = new Map();
  for (const t of usdtIn) {
    const hash = (t.hash ?? '').toLowerCase();
    if (!hash) continue;
    const amount = Number(t.value);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    usdtInByTx.set(hash, (usdtInByTx.get(hash) || 0) + amount);
  }

  // Count NFT outs per tx (for splitting USDT when multi-card sold same tx)
  const outsByTx = new Map();
  for (const t of nftTransfers) {
    const from = (t.from ?? '').toLowerCase();
    if (from !== wallet) continue;
    const hash = (t.hash ?? '').toLowerCase();
    if (!hash) continue;
    outsByTx.set(hash, (outsByTx.get(hash) || 0) + 1);
  }

  const sorted = [...nftTransfers].sort(
    (a, b) => normalizeBlock(a.blockNum) - normalizeBlock(b.blockNum),
  );

  /** @type {Map<string, { costUsd: number|null, costSource: string|null }>} */
  const costBasis = new Map();
  const sales = [];

  for (const t of sorted) {
    const tokenId = normalizeTokenId(t.tokenId);
    if (!tokenId) continue;
    const to = (t.to ?? '').toLowerCase();
    const from = (t.from ?? '').toLowerCase();
    const hash = (t.hash ?? '').toLowerCase() || null;
    const block = normalizeBlock(t.blockNum);

    if (to === wallet) {
      // Acquired — estimate cost from pack payment
      let acquireType = 'UNKNOWN';
      if (from && PACK_SALE_CONTRACTS.has(from)) acquireType = 'PACK_PULL';
      else if (from === ZERO_ADDRESS) acquireType = 'MINT';
      else if (from) acquireType = 'TRANSFER';

      let costUsd = null;
      let costSource = null;
      if (acquireType === 'PACK_PULL' || acquireType === 'MINT') {
        const payment = matchPackPayment(purchases, block, hash);
        if (payment && Number.isFinite(payment.amountUSD) && payment.amountUSD > 0) {
          // Best-effort single-card; group split only among concurrent same-tx holds is hard offline
          costUsd = payment.amountUSD;
          costSource = 'pack_payment';
          // If multiple NFTs in same pack payment tx are later held, scan path may refine;
          // for historical sales we prefer undivided then user can edit — better split:
          const sameTxNfts = sorted.filter((x) => {
            const h = (x.hash ?? '').toLowerCase();
            const tt = (x.to ?? '').toLowerCase();
            return h && payment.txHash && h === String(payment.txHash).toLowerCase() && tt === wallet;
          }).length;
          if (sameTxNfts > 1) {
            costUsd = payment.amountUSD / sameTxNfts;
            costSource = 'pack_payment_split';
          }
        }
      }
      costBasis.set(tokenId, { costUsd, costSource });
      continue;
    }

    if (from !== wallet) continue;

    // Left wallet — redeem sinks are not sales
    if (to && REDEEM_SINKS.has(to)) {
      costBasis.delete(tokenId);
      continue;
    }

    const usdtTotal = hash ? usdtInByTx.get(hash) : null;
    const nOut = hash ? (outsByTx.get(hash) || 1) : 1;
    const soldPriceUsd = Number.isFinite(usdtTotal) && usdtTotal > 0
      ? usdtTotal / nOut
      : null;

    let saleType = 'TRANSFER_OUT';
    if (to && to === BUYBACK_CONTRACT) saleType = 'BUYBACK';
    else if (Number.isFinite(soldPriceUsd) && soldPriceUsd > 0) saleType = 'MARKETPLACE';

    // Skip pure transfers without proceeds from realized totals (still list)
    const basis = costBasis.get(tokenId) || { costUsd: null, costSource: null };
    const costBasisUsd = Number.isFinite(basis.costUsd) ? basis.costUsd : null;
    const realizedPnlUsd = Number.isFinite(soldPriceUsd) && Number.isFinite(costBasisUsd)
      ? soldPriceUsd - costBasisUsd
      : null;

    const soldAtMs = blockTimestampMs(block, t.metadata) ?? null;
    const soldAt = soldAtMs
      ? new Date(soldAtMs).toISOString()
      : (Number.isFinite(block) ? null : null);

    sales.push({
      id: saleIdFor({ tokenId, saleTxHash: hash, soldAtMs: soldAtMs || block }),
      tokenId: String(tokenId),
      saleType,
      soldAt,
      soldBlock: block,
      soldPriceUsd: Number.isFinite(soldPriceUsd) ? soldPriceUsd : null,
      costBasisUsd,
      costSource: basis.costSource,
      realizedPnlUsd: Number.isFinite(realizedPnlUsd) ? realizedPnlUsd : null,
      saleTxHash: hash,
      counterparty: to || null,
      // filled later by scan enrichment
      cert: null,
      name: null,
      imageUrl: null,
      grade: null,
      setName: null,
    });

    costBasis.delete(tokenId);
  }

  // Newest first
  sales.sort((a, b) => {
    const ab = Number(a.soldBlock) || 0;
    const bb = Number(b.soldBlock) || 0;
    return bb - ab;
  });

  const truncated = sales.length > MAX_SALES;
  const sliced = truncated ? sales.slice(0, MAX_SALES) : sales;

  // Summary: only rows with proceeds (BUYBACK / MARKETPLACE)
  let totalSoldUsd = 0;
  let totalCostUsd = 0;
  let totalRealizedPnlUsd = 0;
  let countWithProceeds = 0;
  for (const s of sliced) {
    if (s.saleType === 'TRANSFER_OUT') continue;
    countWithProceeds += 1;
    if (Number.isFinite(s.soldPriceUsd)) totalSoldUsd += s.soldPriceUsd;
    if (Number.isFinite(s.costBasisUsd)) totalCostUsd += s.costBasisUsd;
    if (Number.isFinite(s.realizedPnlUsd)) totalRealizedPnlUsd += s.realizedPnlUsd;
  }

  return {
    sales: sliced,
    summary: {
      count: countWithProceeds,
      totalCount: sliced.length,
      totalSoldUsd,
      totalCostUsd,
      totalRealizedPnlUsd,
    },
    truncated,
  };
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
