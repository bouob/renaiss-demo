// Path-mode safety net only.
// When Merchant is still served under dokipoki-dev.web.app/merchant/, a visitor
// who lands on merchant.dokipoki.app (DNS → default site) gets bounced to the
// real path so assets/auth work.
//
// Scheme B multi-site (Vite base='/'): custom domain serves this app at ROOT —
// bounce must be disabled or the user loops away from the real site.

const CUSTOM_DOMAIN = 'merchant.dokipoki.app';
const CANONICAL_ORIGIN = 'https://dokipoki-dev.web.app';
const CANONICAL_BASE_PATH = '/merchant';

/**
 * @param {Location} [location]
 * @returns {boolean} true if a redirect was issued
 */
export function redirectIfCustomDomain(location = typeof window !== 'undefined' ? window.location : null) {
  if (!location) return false;

  // Root multi-site build: do not bounce.
  const base = typeof import.meta !== 'undefined' ? import.meta.env?.BASE_URL : '/merchant/';
  if (base === '/' || base === '') return false;

  // Explicit kill-switch (e.g. staging root without rebuilding base).
  if (import.meta.env?.VITE_DISABLE_HOST_REDIRECT === 'true') return false;

  if (location.hostname === CUSTOM_DOMAIN) {
    const suffix = location.pathname === '/' ? '' : location.pathname;
    // Avoid /merchant/merchant if pathname already includes the base.
    const path = suffix.startsWith(CANONICAL_BASE_PATH)
      ? suffix
      : `${CANONICAL_BASE_PATH}${suffix}`;
    const target = `${CANONICAL_ORIGIN}${path}${location.search}${location.hash}`;
    window.location.replace(target);
    return true;
  }

  return false;
}
