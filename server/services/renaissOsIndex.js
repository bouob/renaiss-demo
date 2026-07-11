/**
 * renaissOsIndex.js — Renaiss OS Index read-only adapters.
 *
 * `getGradedFmv` and `getGradedCardBrief` (both `GET /v1/graded/{cert}`,
 * mapped to two different shapes for two different callers), `getIndices`
 * (`GET /v1/indices`), `getIndexDetail` (`GET /v1/indices/{game}`), and
 * `getCardFmvSeries` (`GET /v1/cards/{game}/{set}/{card}/fmv-series`) on the
 * Renaiss OS Index public API. Contract: docs/spec/boundaries/renaiss-index-service.md
 * Upstream reference: docs/RENAISS_INDEX_API.md
 *
 * All five wrappers share one transport (`requestUpstreamJson`) and therefore
 * one per-instance daily quota counter and one circuit breaker — a run of
 * failures against one endpoint (e.g. `getIndices`) opens the breaker for
 * every other wrapper in this module, including `getGradedFmv`.
 *
 * Fail-open: every failure mode (missing keys, timeout, non-2xx, quota
 * exhaustion, parse error, open circuit) resolves to `null` — this module
 * never throws. Callers must treat `null` as "no data this round", not as an
 * error.
 *
 * Resilience state is per warm instance (in-memory): a daily soft-quota
 * counter, an upstream low-remaining day fuse, and a consecutive-failure
 * circuit breaker that keeps a hanging upstream from stalling every enrich
 * worker for the full 10s timeout, request after request.
 */

const BASE_URL = 'https://api.renaissos.com';
const REQUEST_TIMEOUT_MS = 10_000;
// Per-instance daily budget. Three independent function instances load this
// module (api, renaissScanWorker, scheduledRenaissFmvRefresh) — the default
// covers the interactive instances (enrich only pays on stale/missing quotes),
// and the refresh sweep raises its own instance's budget via
// setDailyQuotaSoftLimit(). Aggregate worst case stays at the upstream 10k/day.
const DEFAULT_DAILY_QUOTA_SOFT_LIMIT = 2_000;
const RATE_LIMIT_REMAINING_FLOOR = 500;
// Upstream Retry-After is untrusted input — an oversized value (e.g. a 3600s
// backoff) must not be slept in a Cloud Function and risk hitting its own
// timeout. Same defect class as this repo's ISSUE-023 (Poketrace retryAfter
// unclamped): clamp by abandoning the retry (and opening the circuit for the
// requested backoff, capped) rather than sleeping a shorter, arbitrary
// duration the upstream never asked for. An unparseable Retry-After (RFC also
// allows an HTTP-date) is treated the same way — never "retry in 1s" against
// an upstream that just asked for a longer pause.
const RETRY_BACKOFF_MAX_MS = 5_000;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
const BREAKER_MAX_MS = 15 * 60_000;

// P0-4 telemetry: named per-feature soft-budget table, informational only —
// crossing a feature's budget only warns (never blocks). The real gate is
// dailyQuotaSoftLimit above; these numbers exist so per-feature cost can be
// eyeballed in logs before any enforcement policy is decided.
const FEATURE_BUDGETS = {
  gradedFmv: 1200,
  gradedCardBrief: 300,
  indices: 200,
  indexDetail: 200,
  cardFmvSeries: 100,
};

// Cert comes from NFT metadata (`nftAttributes.serial`): grading-company
// prefix + digits (e.g. PSA126233443). Anything else (path segments, `..`,
// oversized junk) never reaches the URL.
const CERT_SHAPE = /^[A-Za-z]{0,4}\d{1,20}$/;
// href is persisted to Firestore and later opened by the client against the
// index origin — only a plain relative path survives ingest (a value like
// `@evil.com/x` would URL-parse the origin into userinfo: open redirect).
const HREF_SHAPE = /^\/[A-Za-z0-9/._-]+$/;
// Index game key — bounded allowlist-shaped even though callers are internal
// (defense in depth, same spirit as CERT_SHAPE): lowercase letters/hyphens
// only, e.g. `pokemon`, `one-piece`.
const GAME_SHAPE = /^[a-z][a-z-]{0,20}$/;
// Card slug segment (game/set/card, each taken from an already-ingested
// `href`'s path segments) — same charset as a cert, applied per-segment so a
// `..` or `/` smuggled into one segment can't escape into the next.
const SLUG_SEGMENT_SHAPE = /^[A-Za-z0-9._-]+$/;

// Checked once at module load (matches Cloud Function warm-instance reuse,
// same spirit as the Alchemy CU limiter's per-instance state). A missing key
// disables the adapter for the lifetime of this module instance.
const API_KEY = process.env.RENAISS_INDEX_API_KEY;
const API_SECRET = process.env.RENAISS_INDEX_API_SECRET;
const KEYS_CONFIGURED = Boolean(API_KEY && API_SECRET);
if (!KEYS_CONFIGURED) {
  console.warn(
    '[renaissOsIndex] RENAISS_INDEX_API_KEY / RENAISS_INDEX_API_SECRET not set — FMV lookups disabled (fail-open).'
  );
}

function utcDateString(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

let dailyQuotaSoftLimit = DEFAULT_DAILY_QUOTA_SOFT_LIMIT;
let dailyCount = 0;
let dailyResetDateUTC = utcDateString(new Date());
// UTC date on which the low-remaining flag was raised; cleared on day rollover.
let disabledUntilDateUTC = null;
// UTC date on which the soft-quota warn was emitted (one log per day, not one
// per suppressed lookup).
let quotaWarnedDateUTC = null;
let consecutiveFailures = 0;
let breakerOpenUntilMs = 0;

/**
 * Per-instance daily budget override. The refresh sweep raises its own
 * instance's budget at run start; interactive instances keep the default.
 * MUST NOT be called at module top-level anywhere — server/index.js loads one
 * module graph for every function, so a top-level call would apply to all
 * instances.
 */
export function setDailyQuotaSoftLimit(limit) {
  if (Number.isFinite(limit) && limit > 0) dailyQuotaSoftLimit = limit;
}

function rolloverIfNewDay() {
  const today = utcDateString(new Date());
  if (today !== dailyResetDateUTC) {
    dailyResetDateUTC = today;
    dailyCount = 0;
    disabledUntilDateUTC = null;
    quotaWarnedDateUTC = null;
  }
}

function quotaExhausted() {
  rolloverIfNewDay();
  if (disabledUntilDateUTC === dailyResetDateUTC) return true;
  if (dailyCount >= dailyQuotaSoftLimit) {
    if (quotaWarnedDateUTC !== dailyResetDateUTC) {
      quotaWarnedDateUTC = dailyResetDateUTC;
      console.warn(
        `[renaissOsIndex] daily soft quota exhausted (count=${dailyCount}, limit=${dailyQuotaSoftLimit}) — suppressing lookups until UTC rollover.`
      );
    }
    return true;
  }
  return false;
}

function noteRateLimitRemaining(headers) {
  // Absent header must not trip the fuse: Number(null) is 0, so a bare 5xx or
  // CDN-level response without rate-limit headers would otherwise read as
  // "0 remaining" and silently disable the adapter for the whole day.
  const raw = headers.get('X-RateLimit-Remaining');
  if (raw == null || raw === '') return null;
  const remaining = Number(raw);
  if (!Number.isFinite(remaining)) return null;
  if (remaining < RATE_LIMIT_REMAINING_FLOOR) {
    if (disabledUntilDateUTC !== dailyResetDateUTC) {
      console.warn(
        `[renaissOsIndex] X-RateLimit-Remaining=${remaining} below floor ${RATE_LIMIT_REMAINING_FLOOR} — disabling lookups until UTC rollover (dailyCount=${dailyCount}).`
      );
    }
    disabledUntilDateUTC = dailyResetDateUTC;
  }
  return remaining;
}

// One over-budget warn per feature per UTC day — dailyCount is the shared
// counter (not per-feature), so once the busiest feature's budget is
// crossed, nearly every subsequent call of any feature would otherwise
// re-warn for the rest of the day.
const featureBudgetWarnedDateUTC = new Map();

function logFeatureTelemetry(feature, remaining) {
  if (!feature) return;
  console.log('[renaissOsIndex] telemetry', { feature, remaining, dailyCount, date: dailyResetDateUTC });
  const budget = FEATURE_BUDGETS[feature];
  if (budget != null && dailyCount > budget && featureBudgetWarnedDateUTC.get(feature) !== dailyResetDateUTC) {
    featureBudgetWarnedDateUTC.set(feature, dailyResetDateUTC);
    console.warn(
      `[renaissOsIndex] feature=${feature} dailyCount=${dailyCount} exceeds FEATURE_BUDGETS budget=${budget} (telemetry only, not blocking).`
    );
  }
}

function breakerOpen() {
  return Date.now() < breakerOpenUntilMs;
}

function openBreaker(ms, reason) {
  breakerOpenUntilMs = Date.now() + ms;
  consecutiveFailures = 0;
  console.warn(`[renaissOsIndex] circuit open for ${Math.round(ms / 1000)}s — ${reason}`);
}

// Timeouts, network errors and 5xx count toward the breaker; negative answers
// (404 etc.) mean the upstream is healthy and do not.
function noteFailure(reason) {
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    openBreaker(BREAKER_COOLDOWN_MS, `${BREAKER_THRESHOLD} consecutive failures (last: ${reason})`);
  }
}

function noteSuccess() {
  consecutiveFailures = 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requestOptions() {
  return { headers: { 'X-Api-Key': API_KEY, 'X-Api-Secret': API_SECRET } };
}

/**
 * Shared upstream transport for every `renaissOsIndex` wrapper: breaker /
 * quota gate, 10s timeout, 429 `Retry-After` clamp-or-abandon, and
 * success/failure bookkeeping — all state is module-level so every wrapper
 * (graded lookup, indices, index detail, card fmv-series) draws on the same
 * per-instance daily budget and the same circuit breaker. Extracted from the
 * transport body that used to live inline in `getGradedFmv`; the sequencing
 * and every observable branch (checks-before-fetch order, 429 retry-once,
 * Retry-After clamp, breaker open reasons, quota/day-fuse checks) is
 * unchanged — only the URL and the log label are now parameters.
 *
 * @param {string} path - upstream path beginning with `/`, e.g. `/v1/indices`.
 * @param {string} label - identifies the caller in warn logs (may embed the
 *   already-validated input, e.g. `getGradedFmv(PSA1)`).
 * @param {string} [feature] - P0-4 telemetry tag, see FEATURE_BUDGETS.
 * @returns {Promise<unknown|null>} parsed JSON body, or null on any failure
 *   mode (disabled/breaker open/quota exhausted/non-2xx/timeout/network
 *   error/abandoned 429). Never throws.
 */
async function requestUpstreamJson(path, label, feature) {
  if (!KEYS_CONFIGURED) return null;
  if (breakerOpen()) return null;
  if (quotaExhausted()) return null;

  const url = `${BASE_URL}${path}`;

  try {
    let res = await fetchWithTimeout(url, requestOptions(), REQUEST_TIMEOUT_MS);
    dailyCount += 1;

    if (res.status === 429) {
      const retryAfterRaw = res.headers.get('Retry-After');
      const retryAfterSec = Number(retryAfterRaw);
      const backoffMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : NaN;
      if (!Number.isFinite(backoffMs) || backoffMs > RETRY_BACKOFF_MAX_MS) {
        // Upstream asked for a longer pause than one lookup may sleep: abandon
        // this round, honor its rate-limit headers, and hold the whole
        // instance back for the requested backoff (capped) so a sweep does not
        // hammer an already-throttled upstream request after request.
        noteRateLimitRemaining(res.headers);
        const holdMs = Number.isFinite(backoffMs)
          ? Math.min(backoffMs, BREAKER_MAX_MS)
          : BREAKER_COOLDOWN_MS;
        openBreaker(holdMs, `429 Retry-After=${retryAfterRaw ?? 'n/a'} exceeds ${RETRY_BACKOFF_MAX_MS}ms retry cap`);
        return null;
      }
      await sleep(backoffMs);
      res = await fetchWithTimeout(url, requestOptions(), REQUEST_TIMEOUT_MS);
      dailyCount += 1;
    }

    const remaining = noteRateLimitRemaining(res.headers);
    logFeatureTelemetry(feature, remaining);

    if (!res.ok) {
      if (res.status >= 500) noteFailure(`HTTP ${res.status}`);
      console.warn(`[renaissOsIndex] ${label} failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    noteSuccess();
    return data;
  } catch (err) {
    noteFailure(err.message);
    console.warn(`[renaissOsIndex] ${label} errored:`, err.message);
    return null;
  }
}

// Maps a GradedLookup response onto the RenaissFmv contract shape
// (docs/spec/boundaries/renaiss-index-service.md).
function mapGradedLookupToFmv(data) {
  const card = data?.card ?? null;
  const href = typeof card?.href === 'string' && HREF_SHAPE.test(card.href) ? card.href : null;
  return {
    priceUsdCents: card?.priceUsdCents ?? null,
    confidence: card?.confidence ?? null,
    gradeLabel: data?.gradeLabel ?? null,
    // GradedLookup has no direct catalog UUID field — card.href's slug tail is
    // only an 8-char prefix of the full CardDetail.id UUID, not the UUID
    // itself. Left null until a future by-id lookup can resolve it.
    catalogId: null,
    href,
    found: Boolean(data?.found),
    reason: data?.reason ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

/** True when both API keys were present at module load (adapter enabled). */
export function isConfigured() {
  return KEYS_CONFIGURED;
}

/**
 * @param {string} cert - graded cert, NFT metadata `nftAttributes.serial` as-is
 *   (includes PSA/CGC/BGS prefix).
 * @returns {Promise<object|null>} RenaissFmv, or null when the service is
 *   disabled / quota-exhausted / circuit-open / the upstream call failed.
 *   Never throws.
 */
export async function getGradedFmv(cert) {
  if (!cert || !CERT_SHAPE.test(String(cert))) return null;
  const data = await requestUpstreamJson(`/v1/graded/${encodeURIComponent(cert)}`, `getGradedFmv(${cert})`, 'gradedFmv');
  if (!data) return null;
  return mapGradedLookupToFmv(data);
}

// Maps a GradedLookup response onto the display-oriented "card brief" shape
// the P5 adjacent-cert suggestion UI needs (docs/RENAISS_INDEX_API.md
// §GradedLookup/§CardSummary). Unlike mapGradedLookupToFmv (RenaissFmv
// contract — price/confidence/href only, persisted to Firestore),
// this keeps the CardSummary identification + image fields so a suggestion
// card can render a thumbnail + name without a second lookup. Not persisted
// anywhere — request-scoped only, so it does not need to match the
// RenaissFmv contract shape.
function mapGradedLookupToCardBrief(data) {
  const card = data?.card ?? null;
  const href = typeof card?.href === 'string' && HREF_SHAPE.test(card.href) ? card.href : null;
  return {
    found: Boolean(data?.found),
    reason: data?.reason ?? null,
    name: card?.name ?? null,
    setName: card?.setName ?? null,
    cardNumber: card?.cardNumber ?? null,
    gradeLabel: data?.gradeLabel ?? card?.gradeLabel ?? null,
    priceUsdCents: typeof card?.priceUsdCents === 'number' ? card.priceUsdCents : null,
    confidence: card?.confidence ?? null,
    imageUrl: typeof card?.imageUrl === 'string' ? card.imageUrl : null,
    imageUrlThumb: typeof card?.imageUrlThumb === 'string' ? card.imageUrlThumb : null,
    // CardSummary.language (nullable) — carried for the adjacent-cert POP path to
    // route language-aware matching/spec selection. It is INTERNAL ONLY:
    // renaissAdjacentCertService strips it before the API response, so it is not
    // part of any persisted or wire contract.
    language: card?.language ?? null,
    href,
  };
}

/**
 * @param {string} cert - graded cert (same shape as getGradedFmv).
 * @returns {Promise<object|null>} display-oriented GradedLookup projection
 *   (`{ found, reason, name, setName, cardNumber, gradeLabel, priceUsdCents,
 *   confidence, imageUrl, imageUrlThumb, href }`), or null on invalid cert /
 *   any adapter failure mode. Shares this module's transport, so also shares
 *   its quota/breaker state with getGradedFmv and every other wrapper. Never
 *   throws.
 */
export async function getGradedCardBrief(cert) {
  if (!cert || !CERT_SHAPE.test(String(cert))) return null;
  const data = await requestUpstreamJson(`/v1/graded/${encodeURIComponent(cert)}`, `getGradedCardBrief(${cert})`, 'gradedCardBrief');
  if (!data) return null;
  return mapGradedLookupToCardBrief(data);
}

// --- Indices / index detail / card fmv-series wrappers -------------------
// Contract for these three: docs/RENAISS_INDEX_API.md §IndexTile/IndexDetail
// (IndexTile / IndexMover / IndexDetail / IndexConstituent). All percentage
// fields upstream are whole-number percent (e.g. -17.41); this adapter
// divides by 100 once so every caller downstream sees a decimal fraction
// (0.05 = +5%) — the same "convert once, at the boundary" rule the module
// docstring states for the whole file.

/** number|null → decimal fraction, or null when not a finite number. */
function toDecimalPct(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : null;
}

/** Same open-redirect guard as RenaissFmv.href — invalid shape drops to null. */
function mapHref(href) {
  return typeof href === 'string' && HREF_SHAPE.test(href) ? href : null;
}

// Drops (does not null-pad) any point whose `t` isn't a string or whose
// `usdCents` isn't a finite number — a malformed point silently breaking the
// sparkline shape is worse than a shorter-but-clean series.
function mapSparklinePoints(points) {
  if (!Array.isArray(points)) return [];
  const mapped = [];
  for (const point of points) {
    const t = typeof point?.t === 'string' ? point.t : null;
    const usdCents = point?.usdCents;
    if (t && typeof usdCents === 'number' && Number.isFinite(usdCents)) {
      mapped.push({ t, usdCents });
    }
  }
  return mapped;
}

function mapTopMovers(movers) {
  if (!Array.isArray(movers)) return [];
  return movers.map((mover) => ({
    name: mover?.name ?? null,
    setCode: mover?.setCode ?? null,
    cardNumber: mover?.cardNumber ?? null,
    grade: mover?.grade ?? null,
    href: mapHref(mover?.href),
    deltaPct: toDecimalPct(mover?.deltaPct),
  }));
}

function mapConstituents(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({
    rank: typeof c?.rank === 'number' ? c.rank : null,
    name: c?.name ?? null,
    setName: c?.setName ?? null,
    setCode: c?.setCode ?? null,
    cardNumber: c?.cardNumber ?? null,
    grade: c?.grade ?? null,
    imageUrl: c?.imageUrl ?? null,
    imageUrlThumb: c?.imageUrlThumb ?? null,
    priceUsdCents: typeof c?.priceUsdCents === 'number' ? c.priceUsdCents : null,
    deltaPct: toDecimalPct(c?.deltaPct),
    lastSaleAt: c?.lastSaleAt ?? null,
    href: mapHref(c?.href),
  }));
}

// Maps the IndexTile shape shared by both `/v1/indices` (array of tiles) and
// `/v1/indices/{game}` (IndexDetail = IndexTile + constituents). `value` and
// `base` are index points, not percentages — left untouched (no /100).
function mapIndexTile(tile) {
  if (!tile || typeof tile !== 'object') return null;
  return {
    game: tile.game ?? null,
    label: tile.label ?? null,
    value: typeof tile.value === 'number' ? tile.value : null,
    base: typeof tile.base === 'number' ? tile.base : null,
    constituentCount: typeof tile.constituentCount === 'number' ? tile.constituentCount : null,
    rebalance: tile.rebalance ?? null,
    updatedAt: tile.updatedAt ?? null,
    deltas: {
      d7: toDecimalPct(tile.deltas?.d7),
      d30: toDecimalPct(tile.deltas?.d30),
      d365: toDecimalPct(tile.deltas?.d365),
    },
    sparkline: mapSparklinePoints(tile.sparkline),
    topMovers: mapTopMovers(tile.topMovers),
  };
}

/**
 * @returns {Promise<Array<object>|null>} mapped IndexTile[] (one per
 *   tracked game, e.g. pokemon/one-piece) from `GET /v1/indices`, or null on
 *   any adapter failure mode. Never throws.
 */
export async function getIndices() {
  const data = await requestUpstreamJson('/v1/indices', 'getIndices', 'indices');
  if (!data || !Array.isArray(data.indices)) return null;
  return data.indices.map(mapIndexTile).filter(Boolean);
}

/**
 * @param {string} [game='pokemon'] - index game key (`pokemon`/`one-piece`/`sports`).
 * @returns {Promise<object|null>} mapped IndexDetail (IndexTile fields +
 *   `windowDays`/`baseDate`/`constituents[]`) from `GET /v1/indices/{game}`,
 *   or null on invalid game / any adapter failure mode. Never throws.
 */
export async function getIndexDetail(game = 'pokemon') {
  if (typeof game !== 'string' || !GAME_SHAPE.test(game)) return null;
  const data = await requestUpstreamJson(
    `/v1/indices/${encodeURIComponent(game)}`,
    `getIndexDetail(${game})`,
    'indexDetail'
  );
  const tile = mapIndexTile(data);
  if (!tile) return null;
  return {
    ...tile,
    windowDays: typeof data.windowDays === 'number' ? data.windowDays : null,
    baseDate: data.baseDate ?? null,
    constituents: mapConstituents(data.constituents),
  };
}

/**
 * Phase 2 wrapper — built now (shares transport/breaker/quota state with the
 * rest of this module) but not wired into any caller in Phase 1.
 *
 * @param {string} slug - `{game}/{set}/{card}`, the `/card/` prefix already
 *   stripped from an ingested `href` (e.g. RenaissFmv.href or a topMover/
 *   constituent href). Must be exactly 3 non-empty segments, each shaped like
 *   a cert (`SLUG_SEGMENT_SHAPE`) — anything else is rejected with zero
 *   network calls (same defense-in-depth posture as CERT_SHAPE).
 * @param {{window?: number}} [options]
 * @returns {Promise<Array<{t: string, usdCents: number}>|null>} the
 *   FmvSeriesResponse's top-level `points[]` (not the per-method `series[]`),
 *   or null on invalid slug / any adapter failure mode. Never throws.
 */
export async function getCardFmvSeries(slug, { window = 30 } = {}) {
  if (typeof slug !== 'string') return null;
  const segments = slug.split('/');
  // SLUG_SEGMENT_SHAPE allows `.` (legitimate slug segments may contain one),
  // which also makes a bare `.` or `..` segment pass the regex — and
  // encodeURIComponent does not escape dots, so a `..` segment would reach
  // the URL and let path resolution walk it off `/v1/cards/...` onto an
  // unintended upstream path. Reject those two special tokens explicitly.
  if (
    segments.length !== 3 ||
    segments.some((seg) => !SLUG_SEGMENT_SHAPE.test(seg) || seg === '.' || seg === '..')
  ) {
    return null;
  }
  const windowParam = Number.isFinite(window) && window > 0 ? Math.trunc(window) : 30;
  const path = `/v1/cards/${segments.map(encodeURIComponent).join('/')}/fmv-series?window=${windowParam}`;
  const data = await requestUpstreamJson(path, `getCardFmvSeries(${slug})`, 'cardFmvSeries');
  if (!data || !Array.isArray(data.points)) return null;
  return mapSparklinePoints(data.points);
}

/** Test-only: resets in-memory quota/disable/breaker state between test cases. */
export function __resetForTest() {
  dailyQuotaSoftLimit = DEFAULT_DAILY_QUOTA_SOFT_LIMIT;
  dailyCount = 0;
  dailyResetDateUTC = utcDateString(new Date());
  disabledUntilDateUTC = null;
  quotaWarnedDateUTC = null;
  consecutiveFailures = 0;
  breakerOpenUntilMs = 0;
  featureBudgetWarnedDateUTC.clear();
}
