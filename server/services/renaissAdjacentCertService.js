/**
 * renaissAdjacentCertService.js — ±1 adjacent-cert suggestion cache.
 *
 * Ported subset of
 * D:/Desktop/Dokipoki/server/services/renaissAdjacentCertService.js for
 * project-renaiss. For a graded cert (e.g. PSA41932666), computes the ±1
 * neighbor cert numbers (./renaissCertAdjacency.js) and fetches their display
 * briefs via ./renaissOsIndex.js's getGradedCardBrief, keeping only the ones
 * the upstream actually has (`found: true`) — connoisseurs treat consecutive
 * serials as often same-batch/same-set, so a found neighbor is a "you might
 * also like" suggestion, not a definitive relationship claim.
 *
 * NOT ported from the Dokipoki source (out of project-renaiss's scope per
 * PLAN.md §不搬 — no PokeTrace / cardMatcher / Gemini card recognition /
 * `adminDb`): the PSA population-count enrichment step
 * (`matchToPokeTrace` + `fetchPsaPopData` + a `setCardCache` Firestore
 * read). Every neighbor here carries `psaPop: null` — a graceful degrade
 * (field kept, always null), not a removed field, so the response shape
 * stays forward-compatible with a future re-add.
 *
 * Cost note (same as the source): an *untracked* neighbor cert still
 * resolves `found: false` from `/v1/graded/{cert}`, but getting that answer
 * triggers the upstream's live FMV compute pipeline (`reason:
 * compute_incomplete`) — a real, rate-limited cost, not a free negative
 * lookup. This module caches a *genuine* empty result too (every neighbor
 * came back a definitive `found: false`), keyed by the queried cert, so
 * repeat views within the TTL never re-trigger that pipeline. A *transient*
 * failure (a null brief from an open breaker / exhausted quota / timeout /
 * 5xx) is deliberately NOT cached — freezing it would leave the cert stuck as
 * "no neighbors" for the full TTL even after upstream recovers, violating the
 * Renaiss both-success-only invariant. Capped at MAX_CACHE_ENTRIES with
 * oldest-first eviction — the cert key is caller-supplied and would otherwise
 * grow the Map unbounded on a long-lived instance.
 *
 * Gating (MUST, per PLAN.md §關聯卡片探索): callers must only invoke this for
 * held/scanned certs or behind an IP rate limit — an arbitrary cert lookup
 * spends the shared upstream quota/breaker and would degrade every other
 * Renaiss OS Index caller (getGradedFmv included). This module itself does
 * not gate — that is the route layer's job (server/routes/related.js).
 *
 * Fail-open: any failure (adapter error, unexpected shape) resolves to
 * `{ neighbors: [], attributionUrl }` — same contract as every other
 * Renaiss OS Index read path in this codebase. Never throws.
 */

import { adjacentCerts } from './renaissCertAdjacency.js';
import { getGradedCardBrief } from './renaissOsIndex.js';
import { lookupMarketplaceByCerts } from './renaissMarketplaceLookup.js';

// Human-facing index site (attribution link target) — same value as
// Dokipoki's renaissIndexService.js ATTRIBUTION_URL. Duplicated here rather
// than imported cross-module since this project does not port the
// Firestore-backed renaissIndexService.js global-summary persistence (see
// renaissPortfolioSeries.js's header for why).
export const ATTRIBUTION_URL = 'https://index.renaissos.com';

// 6h — generous enough to blunt repeat page views/re-expands of the same
// card within a session (and across sessions the same day) without staling a
// genuinely new neighbor cert for long.
export const ADJACENT_CERT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Per-instance state (in-memory only — not shared across warm instances or
// persisted; cross-instance consistency is bounded by the TTL, not
// guaranteed).
const cache = new Map(); // cert -> { result, computedAt }

// Hard cap on distinct cached certs. The key is a caller-supplied cert (a
// huge distinct-value space), so an unbounded Map would grow until the
// process OOMs. Oldest-first eviction (Map preserves insertion order) keeps
// memory bounded and sweeps stale entries that are never re-read.
export const MAX_CACHE_ENTRIES = 5000;
let maxCacheEntries = MAX_CACHE_ENTRIES;

function emptyShape() {
  return { neighbors: [], attributionUrl: ATTRIBUTION_URL, marketplaceDegraded: false };
}

function isFresh(entry) {
  return Boolean(entry) && Date.now() - entry.computedAt < ADJACENT_CERT_CACHE_TTL_MS;
}

function writeCache(cert, result) {
  if (!cache.has(cert)) {
    while (cache.size >= maxCacheEntries) {
      cache.delete(cache.keys().next().value); // evict oldest inserted
    }
  }
  cache.set(cert, { result, computedAt: Date.now() });
}

/**
 * @param {string} cert - a Renaiss graded cert. Callers MUST have already
 *   applied the ownership/rate-limit gate (see module header) before calling
 *   this — it performs no gating of its own.
 * @returns {Promise<{
 *   neighbors: Array<{ delta: number, cert: string, found: true, reason: null,
 *     name: string|null, setName: string|null, cardNumber: string|null,
 *     gradeLabel: string|null, priceUsdCents: number|null, confidence: string|null,
 *     imageUrl: string|null, imageUrlThumb: string|null, href: string|null,
 *     tokenId: string, renaissItemId: string|null,
 *     psaPop: null }>,
 *   attributionUrl: string,
 *   marketplaceDegraded: boolean,
 * }>} `neighbors` holds only certs the Index knows AND the marketplace lists
 *   (hence `tokenId` is always present — every row opens on renaiss.xyz).
 *   `marketplaceDegraded` marks an empty/short list caused by a tRPC failure
 *   rather than by the market genuinely not carrying the neighbor.
 *   Fail-open on any failure mode, an unparseable cert, or zero found
 *   neighbors. Never throws.
 */
export async function getAdjacentCertSuggestions(cert) {
  try {
    const cached = cache.get(cert);
    if (isFresh(cached)) return cached.result;

    const candidates = adjacentCerts(cert, 1);
    if (candidates.length === 0) {
      const result = emptyShape();
      writeCache(cert, result);
      return result;
    }

    const briefs = await Promise.all(candidates.map((c) => getGradedCardBrief(c.cert)));
    const foundNeighbors = briefs
      .map((brief, i) => {
        if (!brief?.found) return null;
        // `language` was an internal-only routing field for the source's POP
        // match step (not ported); strip it so the response shape matches
        // the documented contract exactly.
        const { language, ...display } = brief;
        return { ...display, delta: candidates[i].delta, cert: candidates[i].cert, psaPop: null };
      })
      .filter(Boolean);

    // Marketplace identity (tokenId + renaiss_item_id). A failure leaves
    // tokenId/renaissItemId null, and the client renders no marketplace link
    // (it falls back to the Index pricing page, or to a plain row) — there is
    // deliberately no /?q={cert} search fallback, because a cert the
    // marketplace does not carry lands on an empty search page.
    //
    // Which is exactly why a *transient* tRPC failure joins the both-success
    // cache gate below: freezing a tokenId-less result for 6h would strip the
    // deep link off listed cards long after the site recovered, with nothing to
    // soften it. A *determinate* miss (200, cert genuinely not listed) is a
    // real answer and stays cacheable.
    let marketByCert = new Map();
    let marketTransient = false;
    if (foundNeighbors.length > 0) {
      try {
        const lookup = await lookupMarketplaceByCerts(foundNeighbors.map((n) => n.cert));
        marketByCert = lookup.byCert;
        marketTransient = lookup.transient;
      } catch (err) {
        console.warn(`[renaissAdjacentCertService] marketplace enrich failed: ${err?.message ?? err}`);
        marketTransient = true;
      }
    }

    // Only neighbors the marketplace can actually open survive. A cert the
    // Index knows but renaiss.xyz does not list is dropped entirely — showing it
    // would either dangle a dead row or push the merchant at the Index pricing
    // page, which is not a buy surface.
    const neighbors = foundNeighbors
      .map((n) => {
        const m = marketByCert.get(String(n.cert).toUpperCase())
          || marketByCert.get(n.cert)
          || null;
        return {
          ...n,
          tokenId: m?.tokenId ?? null,
          renaissItemId: m?.renaissItemId ?? null,
        };
      })
      .filter((n) => n.tokenId);

    // `marketplaceDegraded` is how the client tells "this market has no adjacent
    // cards" (a real answer) apart from "the marketplace lookup fell over"
    // (which zeroes the list for the wrong reason, and is retryable).
    const result = {
      neighbors,
      attributionUrl: ATTRIBUTION_URL,
      marketplaceDegraded: marketTransient,
    };

    // Both-success-only write (mirrors the Renaiss index invariant): a null
    // brief is a *transient* upstream failure (open breaker / exhausted
    // quota / timeout / 5xx), not a healthy `{ found: false }` negative; the
    // marketplace enrich contributes its own transient flag the same way.
    // Only freeze the result for the full TTL when every part got a
    // definitive answer — otherwise a breaker/timeout blip would poison this
    // cert for 6h. The partial/empty result is still returned now
    // (fail-open), just not cached, so the next call re-queries once
    // upstream recovers.
    const anyTransient = briefs.some((brief) => brief == null) || marketTransient;
    if (!anyTransient) writeCache(cert, result);
    return result;
  } catch (err) {
    console.warn(`[renaissAdjacentCertService] getAdjacentCertSuggestions(${cert}) errored: ${err.message}`);
    return emptyShape();
  }
}

/** Test-only: resets the in-memory per-cert cache (and cap) between tests. */
export function __resetForTest() {
  cache.clear();
  maxCacheEntries = MAX_CACHE_ENTRIES;
}

/** Test-only: shrinks the cache cap so eviction is exercisable without
 * inserting MAX_CACHE_ENTRIES distinct certs. */
export function __setMaxCacheEntriesForTest(n) {
  maxCacheEntries = n;
}

/** Test-only: current number of cached certs. */
export function __cacheSizeForTest() {
  return cache.size;
}
