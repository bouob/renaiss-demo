/**
 * walletGuard.js — pure wallet-address validation guards for /scan.
 *
 * Ported subset of D:/Desktop/Dokipoki/server/routes/renaiss.js's inline
 * `BLOCKED_WALLET_ADDRESSES` (+ the contract-constant imports it composes
 * from D:/Desktop/Dokipoki/server/services/chainAdapters/bsc/txClassifier.js)
 * and its `/^0x[0-9a-fA-F]{40}$/` address-shape check.
 *
 * Blocks Renaiss platform contracts (the NFT contract, buyback contract,
 * USDT contract, pack-sale contracts, the known migration contract) and the
 * zero address from being registered as a personal wallet — binding one of
 * these as "a user's wallet" would trigger a runaway full scan (OOM) against
 * a high-activity contract and produce phantom holdings.
 *
 * The addresses below are public on-chain contract addresses (BSC), not
 * credentials — safe to hardcode, same as the Dokipoki source.
 *
 * Pure module: no I/O, no env reads.
 */

const RENAISS_CONTRACT = '0xf8646a3ca093e97bb404c3b25e675c0394dd5b30';
const BUYBACK_CONTRACT = '0x94e7732b0b2e7c51ffd0d56580067d9c2e2b7910';
const USDT_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
// Pack sale contracts — NFTs are pre-minted and held by these contracts, then
// transferred to the buyer atomically alongside the USDT payment.
const PACK_SALE_CONTRACTS = [
  '0xaab5f5fa75437a6e9e7004c12c9c56cda4b4885a', // special / standard packs
  '0x94e7732b0b2e7c51ffd0d56580067d9c2e2b7910', // $48 packs (OMEGA)
  '0xb2891022648c5fad3721c42c05d8d283d4d53080', // $88 packs (RenaCrypt)
  '0xfda4a907d23d9f24271bc47483c5b983831e325e', // $150/card packs (5-card bundle)
];
const MIGRATION_CONTRACT = '0x2e737d552b3c601ada4fcd167bfbd8d4e1043b2c';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Renaiss platform contracts + zero address — never a valid "personal wallet". */
export const BLOCKED_WALLET_ADDRESSES = new Set([
  RENAISS_CONTRACT,
  BUYBACK_CONTRACT,
  USDT_CONTRACT,
  ...PACK_SALE_CONTRACTS,
  MIGRATION_CONTRACT,
  ZERO_ADDRESS,
]);

// Same shape guard as renaissOsIndex.js's CERT_SHAPE/HREF_SHAPE family:
// bounded, allowlist-shaped input validation before any downstream use.
const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

/**
 * @param {string} address
 * @returns {boolean} true when `address` is a syntactically valid 20-byte
 *   EVM address (0x + 40 hex chars). Does not normalize case — callers that
 *   need a canonical form should lowercase before comparing against
 *   BLOCKED_WALLET_ADDRESSES (which stores lowercase addresses).
 */
export function isValidAddressShape(address) {
  return typeof address === 'string' && ADDRESS_SHAPE.test(address);
}

/**
 * @param {string} address
 * @returns {boolean} true when `address` is shape-valid AND not a known
 *   platform contract / zero address (case-insensitive against the
 *   blocklist). false for both "malformed" and "blocked" — callers that need
 *   to distinguish the two reasons should call isValidAddressShape first.
 */
export function isAllowedWallet(address) {
  if (!isValidAddressShape(address)) return false;
  return !BLOCKED_WALLET_ADDRESSES.has(address.toLowerCase());
}
