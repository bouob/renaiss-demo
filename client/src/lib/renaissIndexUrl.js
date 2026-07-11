/**
 * Resolve a Renaiss OS Index card href the same way Dokipoki does
 * (RenaissPortfolioSection / RenaissAdjacentCertSection):
 * relative path + base origin, fail-closed if not same-origin.
 */

export const RENAISS_INDEX_BASE_URL = 'https://index.renaissos.com';

/**
 * @param {string|null|undefined} href - e.g. "/card/pokemon/..." from API
 * @returns {string|null} absolute same-origin index URL, or null
 */
export function resolveIndexUrl(href) {
  if (typeof href !== 'string' || !href) return null;
  try {
    const url = new URL(href, RENAISS_INDEX_BASE_URL);
    return url.origin === new URL(RENAISS_INDEX_BASE_URL).origin ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Open index card in a new tab (stopPropagation so nested row handlers are safe).
 * @param {string|null|undefined} href
 * @param {Event} [e]
 */
export function openIndexPage(href, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const url = resolveIndexUrl(href);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
