export const LAST_WALLET_KEY = 'merchant_last_wallet';

/** Lowercased 0x-address if well-shaped, else empty string. */
export function normalizeWallet(addr) {
  const wallet = String(addr ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : '';
}

/** Wallet last loaded in Inventory, from localStorage; '' if unset/unavailable. */
export function readLastWallet() {
  try {
    return normalizeWallet(localStorage.getItem(LAST_WALLET_KEY));
  } catch {
    return '';
  }
}
