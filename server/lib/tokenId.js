/**
 * tokenId.js — the renaiss.xyz /card/{tokenId} deep-link key.
 *
 * A chain NFT tokenId is a uint256 rendered as a decimal string (real ones run
 * ~20–77 digits). Both the marketplace lookup (which parses it out of tRPC) and
 * the inventory writer (which persists it) must agree on what counts as one —
 * a split definition would let one side store a value the other refuses to
 * build a URL from.
 *
 * The client keeps its own copy (client/src/lib/renaissMarketplaceUrl.js):
 * client MUST NOT import server runtime code, so that mirror is deliberate.
 */

/**
 * @param {unknown} value - tRPC may hand back a bigint-as-string or a number.
 * @returns {string|null} the decimal tokenId, or null for anything unusable.
 */
export function normalizeTokenId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!/^\d{10,100}$/.test(s)) return null;
  return s;
}
