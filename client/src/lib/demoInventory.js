/**
 * Demo seed vs linked-wallet inventory helpers.
 *
 * Demo rows are tagged with the per-uid synthetic wallet from the server
 * (`defaultWallet` on GET /meta). When a personal wallet is linked, any demo
 * row whose cert also appears on that wallet is hidden — personal wins. Unlink
 * deletes personal rows and restores missing seed certs server-side, so demos
 * reappear without a full account reset.
 */

/** @param {unknown} wallet */
export function normalizeWalletAddr(wallet) {
  const w = String(wallet ?? '').trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(w) ? w : '';
}

/**
 * @param {object|null|undefined} item
 * @param {string|null|undefined} defaultWallet - synthetic demo wallet from GET /meta
 */
export function isDemoItem(item, defaultWallet) {
  const rowW = normalizeWalletAddr(item?.wallet);
  const demoW = normalizeWalletAddr(defaultWallet);
  return Boolean(demoW && rowW && rowW === demoW);
}

/**
 * Visible inventory under optional linked wallet.
 *
 * - No link: all rows (demo + personal + manual).
 * - Linked: personal rows for that wallet + non-demo other sources + demos whose
 *   cert is NOT held on the linked wallet (personal covers demo on collision).
 *
 * @param {Array<object>} items
 * @param {string|null|undefined} linkedWallet
 * @param {string|null|undefined} defaultWallet
 * @returns {Array<object>}
 */
export function filterLinkedInventory(items, linkedWallet, defaultWallet) {
  const list = Array.isArray(items) ? items : [];
  const linked = normalizeWalletAddr(linkedWallet);
  if (!linked) return list;

  const personal = [];
  const other = [];
  const demos = [];
  const personalCerts = new Set();

  for (const it of list) {
    const cert = String(it?.cert || it?.id || '');
    const w = normalizeWalletAddr(it?.wallet);
    if (w === linked) {
      personal.push(it);
      if (cert) personalCerts.add(cert);
      continue;
    }
    if (isDemoItem(it, defaultWallet)) {
      demos.push(it);
      continue;
    }
    other.push(it);
  }

  const visibleDemos = demos.filter((it) => {
    const cert = String(it?.cert || it?.id || '');
    return cert && !personalCerts.has(cert);
  });

  return [...personal, ...other, ...visibleDemos];
}
