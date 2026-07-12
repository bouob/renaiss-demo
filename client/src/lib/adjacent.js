/**
 * adjacent.js — maps a GET /related/:cert response onto the one notice the
 * modal should show instead of the neighbor list (or null: render the list).
 *
 * Pure, so the branch table is testable without a DOM. Every reason the route
 * can emit is covered, including the one it emits *implicitly*: the catch-all
 * in server/routes/related.js returns its `empty` object, which carries
 * `gated: true` but NO `reason` key at all — an unmapped state there renders
 * as a blank panel, which is exactly what the pre-existing UI did.
 */

/**
 * `retryable` is not a guess. The service (server/services/renaissAdjacentCertService.js)
 * only caches a result when *every* neighbor got a definitive answer, so:
 *   - a genuinely empty result is cached → retry costs zero upstream calls;
 *   - an empty result caused by a breaker/quota/timeout is NOT cached → retry
 *     actually re-queries once upstream recovers.
 * Both are worth a retry button. `not_held` is retryable too: the allowlist is
 * per-instance, so a deployed guest can get a spurious not_held from a sibling
 * instance (see the loadRelated comment in HoldingDetailModal.jsx).
 * Only a bad cert and an unconfigured service are terminal — retrying those
 * cannot change the answer.
 */
const ADJACENT_NOTICE = {
  not_held: { key: 'detail.gated', retryable: true },
  invalid_cert: { key: 'detail.adjacentInvalidCert', retryable: false },
  service_unconfigured: { key: 'detail.adjacentUnavailable', retryable: false },
  rate_limited: { key: 'detail.adjacentRateLimited', retryable: true },
  error: { key: 'detail.adjacentFailed', retryable: true },
};

/**
 * @param {object|null} related - the GET /related/:cert payload, or null when
 *   the user has not asked for neighbors yet.
 * @returns {{ key: string, retryable: boolean }|null} the notice to render, or
 *   null to render the neighbor list.
 */
export function adjacentNotice(related) {
  if (!related) return null;

  const mapped = ADJACENT_NOTICE[related.reason];
  if (mapped) return mapped;

  // Gated with no reason = the route's catch-all. Treat as a failure, not as
  // an empty list — the neighbors array is empty because nothing ran, not
  // because the cert has no neighbors.
  if (related.gated) return { key: 'detail.adjacentFailed', retryable: true };

  if (!related.neighbors?.length) return { key: 'detail.noNeighbors', retryable: true };

  return null;
}
