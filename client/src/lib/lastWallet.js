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

/**
 * Record the wallet the user just scanned. BenchmarkPanel reads it back to
 * scope the inventory-vs-index series, so a scan that does not write here
 * leaves the Vs tab permanently in its no-wallet state.
 */
export function rememberLastWallet(addr) {
  const wallet = normalizeWallet(addr);
  if (!wallet) return;
  try {
    localStorage.setItem(LAST_WALLET_KEY, wallet);
  } catch { /* private mode / quota — the Vs tab just stays unscoped */ }
}

/** Clear the linked wallet (Inventory unlink + Benchmark unscoped). */
export function clearLastWallet() {
  try {
    localStorage.removeItem(LAST_WALLET_KEY);
  } catch { /* ignore */ }
}
