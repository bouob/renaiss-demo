/**
 * renaissMarketplaceUrl.js — deep-link a known graded card onto renaiss.xyz.
 *
 * Official Index API (api.renaissos.com) has no NFT tokenId field. The
 * marketplace (renaiss.xyz) is the only surface that can open a specific
 * collectible. Resolution order:
 *
 *   1. tokenId  →  /card/{tokenId}   (exact NFT page; scan results have this)
 *   2. cert     →  /?q={cert}        (serial uniquely identifies the card;
 *                                     renaiss.xyz search accepts PSA/CGC/BGS)
 *   3. name+set →  /?q={name set}    (last resort when we only know labels)
 *
 * Always identify the card first (caller supplies known fields), then build
 * the URL. Never invent a tokenId. Fail-closed to null when nothing usable.
 */

export const RENAISS_MARKETPLACE_BASE_URL = 'https://www.renaiss.xyz';

/**
 * @param {object} [card]
 * @param {string|null|undefined} [card.tokenId] - chain NFT token id (decimal string)
 * @param {string|null|undefined} [card.cert] - grader serial, e.g. PSA41932666
 * @param {string|null|undefined} [card.name]
 * @param {string|null|undefined} [card.setName]
 * @returns {string|null} absolute marketplace URL, or null
 */
export function resolveMarketplaceUrl(card = {}) {
  const c = card && typeof card === 'object' ? card : {};
  const tokenId = normalizeTokenId(c.tokenId);
  if (tokenId) {
    return `${RENAISS_MARKETPLACE_BASE_URL}/card/${encodeURIComponent(tokenId)}`;
  }

  const cert = normalizeQueryToken(c.cert);
  if (cert) {
    return `${RENAISS_MARKETPLACE_BASE_URL}/?q=${encodeURIComponent(cert)}`;
  }

  const name = normalizeQueryToken(c.name);
  const setName = normalizeQueryToken(c.setName);
  const q = [name, setName].filter(Boolean).join(' ').trim();
  if (!q) return null;
  return `${RENAISS_MARKETPLACE_BASE_URL}/?q=${encodeURIComponent(q)}`;
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

function normalizeQueryToken(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().slice(0, 120);
  return s || null;
}
