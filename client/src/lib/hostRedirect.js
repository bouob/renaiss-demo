// Deployment invariant (PLAN.md §部署 / §架構):
// `merchant.dokipoki.app` is a custom-domain alias that Jacker points at
// `dokipoki-dev.web.app` at the DNS layer, but Firebase Hosting itself only
// serves this app under the `dokipoki-dev.web.app/merchant` path — so a
// visitor landing on the bare custom domain must be bounced to the real
// path, preserving whatever deep link (path + query + hash) they arrived
// with. Firebase Auth also only has `dokipoki-dev.web.app` as an authorized
// domain (not the custom domain), so login would silently fail without this
// redirect.
const CUSTOM_DOMAIN = 'merchant.dokipoki.app';
const CANONICAL_ORIGIN = 'https://dokipoki-dev.web.app';
const CANONICAL_BASE_PATH = '/merchant';

/**
 * If the page is being viewed on the custom domain, replace the current
 * location with the canonical hosting URL, preserving path/search/hash.
 * No-op otherwise (including SSR/non-browser contexts with no `window`).
 *
 * @param {Location} [location] - injectable for tests; defaults to
 *   `window.location`.
 * @returns {boolean} true if a redirect was issued, false on the no-op path.
 */
export function redirectIfCustomDomain(location = typeof window !== 'undefined' ? window.location : null) {
  if (!location) return false;

  if (location.hostname === CUSTOM_DOMAIN) {
    // Match branch: bounce to the canonical host, keeping the visitor's
    // intended deep link intact. `pathname` already starts with '/' so we
    // append it directly onto the fixed /merchant base — this ASSUMES the
    // custom domain serves this app at its root (no base path of its own).
    // Unverified: hosting/DNS coordination for merchant.dokipoki.app is
    // manual/out-of-scope for this sprint (PLAN.md §部署). If it turns out
    // to also be rooted at /merchant, `pathname` will already contain that
    // prefix and this would double it to .../merchant/merchant/... — verify
    // at actual deploy time and adjust if so.
    const suffix = location.pathname === '/' ? '' : location.pathname;
    const target = `${CANONICAL_ORIGIN}${CANONICAL_BASE_PATH}${suffix}${location.search}${location.hash}`;
    window.location.replace(target);
    return true;
  }

  // No-op branch: any other hostname (dokipoki-dev.web.app itself, or
  // localhost during dev) is already canonical — do nothing.
  return false;
}
