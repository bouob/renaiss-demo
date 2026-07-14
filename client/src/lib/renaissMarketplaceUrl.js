/**
 * renaissMarketplaceUrl.js — deep-link a known graded card onto renaiss.xyz.
 *
 * Official Index API (api.renaissos.com) has no NFT tokenId field. The
 * marketplace (renaiss.xyz) is the only surface that can open a specific
 * collectible, and /card/{tokenId} is the only link worth emitting:
 *
 * Deliberately NO `?q={cert}` search fallback. A cert the marketplace doesn't
 * carry lands on an EMPTY search page (verified: unminted neighbor certs
 * return zero rows from the same collectible.list search this site uses) —
 * worse than no link. When tokenId is absent it means the card is not on the
 * marketplace: chain scans carry tokenId natively and the adjacent-cert
 * service enriches neighbors via the marketplace search, so "no tokenId"
 * is a determinate miss, not a lookup we skipped. Callers fall back to the
 * index.renaissos.com pricing page (resolveIndexUrl) or render no link.
 *
 * Never invent a tokenId. Fail-closed to null when nothing usable.
 */

export const RENAISS_MARKETPLACE_BASE_URL = 'https://www.renaiss.xyz';

/**
 * @param {object} [card]
 * @param {string|null|undefined} [card.tokenId] - chain NFT token id (decimal string)
 * @param {string|null|undefined} [card.cert] - accepted for caller convenience; never builds a URL
 * @param {string|null|undefined} [card.name] - accepted for caller convenience; never builds a URL
 * @param {string|null|undefined} [card.setName] - accepted for caller convenience; never builds a URL
 * @returns {string|null} absolute marketplace URL, or null when the card has no tokenId
 */
export function resolveMarketplaceUrl(card = {}) {
  const c = card && typeof card === 'object' ? card : {};
  const tokenId = normalizeTokenId(c.tokenId);
  if (tokenId) {
    return `${RENAISS_MARKETPLACE_BASE_URL}/card/${encodeURIComponent(tokenId)}`;
  }
  return null;
}

/**
 * Open marketplace page in a new tab (stopPropagation for nested handlers).
 * @param {object} [card]
 * @param {Event} [e]
 * @returns {boolean} true if a tab was opened
 */
export function openMarketplacePage(card, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const url = resolveMarketplaceUrl(card);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

function normalizeTokenId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  // tokenIds are large decimal integers; reject empty / non-digit noise.
  if (!/^\d{10,100}$/.test(s)) return null;
  return s;
}
