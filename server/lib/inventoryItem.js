/** Shared inventory-item sanitizer and constants. */

import { isValidAddressShape } from './walletGuard.js';
import { sanitizeMoney, sanitizeQty, sanitizeNonNegInt } from './moneySanitize.js';

export const COLLECTION = 'hackathonMerchantInventory';
export const CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/;

const STATUSES = new Set(['active', 'promoted', 'delisted', 'sold', 'hold', 'clear']);
const ACQUIRE_TYPES = new Set(['PACK_PULL', 'MINT', 'TRANSFER', 'UNKNOWN', 'PACK_PAYMENT']);
const COST_SOURCES = new Set([
  'manual', 'pack_payment', 'pack_payment_split', 'pack_unmatched',
  'secondary_transfer', 'unavailable', 'buy',
]);
const ADDED_VIA = new Set(['scan', 'cert', 'csv']);
const DECISIONS = new Set(['promote', 'hold', 'clear']);

// alphaPct30d is a decimal fraction (0.12 = +12%): floor at a total loss,
// cap well above any plausible 30d move to reject junk without truncating signal.
const ALPHA_PCT_MIN = -1;
const ALPHA_PCT_MAX = 10;

export function sanitizeWallet(v) {
  const w = typeof v === 'string' ? v.trim() : '';
  if (!isValidAddressShape(w)) return null;
  return w.toLowerCase();
}

/** Filter uid-scoped rows; a wallet filter also retains seeded default cards. */
export function selectInventoryItems(rows, walletFilter, defaultWallet = null) {
  const list = Array.isArray(rows) ? rows : [];
  const w = walletFilter ? String(walletFilter).toLowerCase() : '';
  if (!w) return list;
  const dw = defaultWallet ? String(defaultWallet).toLowerCase() : '';
  return list.filter((row) => {
    const rw = typeof row.wallet === 'string' ? row.wallet.toLowerCase() : '';
    return rw === w || (dw && rw === dw);
  });
}

function sanitizeString(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

// renaiss.xyz /card/{tokenId} deep-link key: a large decimal uint256 string.
// Mirrors the client's normalizeTokenId — junk must be dropped, never stored;
// the client refuses to build a URL off it, so persisting it only masks the miss.
function sanitizeTokenId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^\d{10,100}$/.test(s)) return null;
  return s;
}

export function sanitizeItem(body, cert) {
  const status = typeof body.status === 'string' && STATUSES.has(body.status)
    ? body.status : 'active';
  const wallet = sanitizeWallet(body.wallet);
  const acquireType = typeof body.acquireType === 'string' && ACQUIRE_TYPES.has(body.acquireType)
    ? body.acquireType : null;
  const costSource = typeof body.costSource === 'string' && COST_SOURCES.has(body.costSource)
    ? body.costSource : null;
  const patch = {
    cert,
    wallet,
    cost: sanitizeMoney(body.cost),
    listPrice: sanitizeMoney(body.listPrice),
    qty: sanitizeQty(body.qty),
    target: sanitizeMoney(body.target),
    stop: sanitizeMoney(body.stop),
    status,
    name: sanitizeString(body.name, 200),
    setName: sanitizeString(body.setName, 200),
    grade: sanitizeString(body.grade, 40),
    imageUrl: sanitizeString(body.imageUrl, 500),
    priceUsdCents: sanitizeNonNegInt(body.priceUsdCents, { max: 999_999_999 * 100 }),
    // Optional demo fallback used when the live movers feed is unavailable.
    // Only a real number counts: Number(null) / Number('') are 0, which would
    // persist a spurious 0 alpha and shadow the nullish demo fallback client-side.
    alphaPct30d: typeof body.alphaPct30d === 'number' && Number.isFinite(body.alphaPct30d)
      ? Math.max(ALPHA_PCT_MIN, Math.min(ALPHA_PCT_MAX, body.alphaPct30d))
      : null,
    href: sanitizeString(body.href, 300),
    tokenId: sanitizeTokenId(body.tokenId),
    notes: sanitizeString(body.notes, 1000),
    acquireType,
    costSource,
    onChainCostUsd: sanitizeMoney(body.onChainCostUsd),
    packPaymentTxHash: sanitizeString(body.packPaymentTxHash, 80),
    addedVia: typeof body.addedVia === 'string' && ADDED_VIA.has(body.addedVia) ? body.addedVia : null,
    sourceWallet: sanitizeWallet(body.sourceWallet),
    // Merchant's manual promote/hold/clear override; null lets the client fall
    // back to the rules-engine classification.
    decision: typeof body.decision === 'string' && DECISIONS.has(body.decision) ? body.decision : null,
    updatedAt: new Date().toISOString(),
  };
  if (patch.decision == null) delete patch.decision;
  if (patch.acquireType == null) delete patch.acquireType;
  if (patch.costSource == null) delete patch.costSource;
  if (patch.onChainCostUsd == null) delete patch.onChainCostUsd;
  if (patch.packPaymentTxHash == null) delete patch.packPaymentTxHash;
  if (patch.addedVia == null) delete patch.addedVia;
  if (patch.tokenId == null) delete patch.tokenId;
  if (patch.sourceWallet == null) delete patch.sourceWallet;
  if (patch.alphaPct30d == null) delete patch.alphaPct30d;
  if (patch.wallet == null) delete patch.wallet;
  return patch;
}
