/**
 * renaissMarketplaceLookup.js — best-effort cert → marketplace identity.
 *
 * Renaiss OS Index (api.renaissos.com) has no tokenId. The marketplace site
 * exposes an unauthenticated tRPC search that returns tokenId + itemId for a
 * serial. itemId is the same UUID the official Index accepts as
 * renaiss_item_id on GET /v1/cards/by-renaiss-id/{rid}.
 *
 * This is an *undocumented* site-internal API — no version contract. Fail-open
 * always: timeout / 5xx / shape change / no exact Serial match → null. Never
 * throws. Exact Serial match is mandatory (search is fuzzy).
 *
 * In-memory cache is long (tokenId never changes for a minted NFT). Cache
 * negative results too so a missing listing does not re-hammer tRPC.
 */

export const MARKETPLACE_TRPC_URL = 'https://www.renaiss.xyz/api/trpc/collectible.list';
export const LOOKUP_TIMEOUT_MS = 8_000;
export const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_LOOKUP_CACHE = 2000;

/** @type {Map<string, { value: object|null, computedAt: number }>} */
const cache = new Map();
let maxCache = MAX_LOOKUP_CACHE;

/**
 * @param {string} cert
 * @returns {Promise<{
 *   tokenId: string|null,
 *   renaissItemId: string|null,
 *   name: string|null,
 *   setName: string|null,
 * }|null>}
 */
export async function lookupMarketplaceByCert(cert) {
  const key = normalizeCert(cert);
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.computedAt < LOOKUP_CACHE_TTL_MS) {
    return hit.value;
  }

  let value = null;
  try {
    value = await fetchExactMatch(key);
  } catch (err) {
    console.warn(`[renaissMarketplaceLookup] ${key}: ${err?.message ?? err}`);
    value = null;
  }

  writeCache(key, value);
  return value;
}

/**
 * Parallel lookup for many certs. Fail-open per cert.
 * @param {string[]} certs
 * @returns {Promise<Map<string, object|null>>} cert → lookup or null
 */
export async function lookupMarketplaceByCerts(certs) {
  const list = Array.isArray(certs) ? certs : [];
  const entries = await Promise.all(
    list.map(async (c) => [normalizeCert(c) || String(c), await lookupMarketplaceByCert(c)]),
  );
  return new Map(entries);
}

function normalizeCert(cert) {
  if (typeof cert !== 'string') return null;
  const s = cert.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,64}$/.test(s)) return null;
  return s;
}

function writeCache(key, value) {
  if (!cache.has(key)) {
    while (cache.size >= maxCache) {
      cache.delete(cache.keys().next().value);
    }
  }
  cache.set(key, { value, computedAt: Date.now() });
}

function buildInput(cert) {
  // Shape reverse-engineered 2026-07-12 from www.renaiss.xyz collectible.list.
  return {
    0: {
      json: {
        limit: 5,
        offset: 0,
        search: cert,
        sortBy: 'listDate',
        sortOrder: 'desc',
        categoryFilter: null,
        listedOnly: null,
        characterFilter: '',
        languageFilter: '',
        gradingCompanyFilter: '',
        gradeFilter: '',
        yearRange: '',
        priceRangeFilter: '',
      },
      meta: {
        values: {
          categoryFilter: ['undefined'],
          listedOnly: ['undefined'],
        },
      },
    },
  };
}

async function fetchExactMatch(cert) {
  const input = encodeURIComponent(JSON.stringify(buildInput(cert)));
  const url = `${MARKETPLACE_TRPC_URL}?batch=1&input=${input}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  const body = await res.json();
  return pickExact(body, cert);
}

/**
 * @param {unknown} body - tRPC batch response
 * @param {string} cert - already uppercased
 */
export function pickExact(body, cert) {
  const want = String(cert).trim().toUpperCase();
  const collection = body?.[0]?.result?.data?.json?.collection;
  if (!Array.isArray(collection)) return null;

  for (const row of collection) {
    const serial = extractSerial(row);
    if (!serial || serial.toUpperCase() !== want) continue;
    const tokenId = normalizeTokenId(row?.tokenId);
    const renaissItemId = typeof row?.itemId === 'string' && row.itemId.length >= 8
      ? row.itemId.slice(0, 64)
      : null;
    if (!tokenId && !renaissItemId) continue;
    return {
      tokenId,
      renaissItemId,
      name: typeof row?.name === 'string' ? row.name.slice(0, 200) : null,
      setName: typeof row?.setName === 'string' ? row.setName.slice(0, 200) : null,
    };
  }
  return null;
}

function extractSerial(row) {
  const attrs = Array.isArray(row?.attributes) ? row.attributes : [];
  for (const a of attrs) {
    if (String(a?.trait || '').toLowerCase() === 'serial' && typeof a?.value === 'string') {
      return a.value.trim();
    }
  }
  // Some rows put the serial in the name prefix ("PSA 10 … PSA104644162") — skip;
  // only trust the Serial attribute for exact match.
  return null;
}

function normalizeTokenId(value) {
  if (value == null) return null;
  // tRPC may return bigint as string in JSON or number for small values.
  const s = String(value).trim();
  if (!/^\d{10,100}$/.test(s)) return null;
  return s;
}

export function __resetForTest() {
  cache.clear();
  maxCache = MAX_LOOKUP_CACHE;
}

export function __setMaxCacheForTest(n) {
  maxCache = n;
}

export function __cacheSizeForTest() {
  return cache.size;
}
