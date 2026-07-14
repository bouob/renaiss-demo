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
 * `tokenId` is the only field read. Any other key on `card` (cert, name,
 * setName…) is ignored by contract — callers must not expect it to identify a
 * card here, and the tests pin that.
 *
 * @param {object} [card]
 * @param {string|null|undefined} [card.tokenId] - chain NFT token id (decimal string)
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

// Mirrors server/lib/tokenId.js — client MUST NOT import server runtime code,
// so this copy is deliberate. Keep the two regexes in step.
function normalizeTokenId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  // tokenIds are large decimal integers; reject empty / non-digit noise.
  if (!/^\d{10,100}$/.test(s)) return null;
  return s;
}
