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
 * Whether a row is hidden (merchant hid it via the inventory hide/restore
 * controls). Absent field means visible. Kept as a strict `=== true` check so
 * `false`/`undefined` behave identically.
 * @param {object|null|undefined} item
 */
export function isHiddenItem(item) {
  return item?.hidden === true;
}

/**
 * Best-effort linked-wallet recovery from server data. A wallet only counts as
 * "linked" when the account still holds at least one non-demo row for it: the
 * stored wallet wins when a row still backs it, otherwise fall back to the first
 * non-demo wallet on the item rows.
 *
 * The backing-row requirement is load-bearing. A stored wallet is NOT trusted on
 * its own — after an unlink the personal rows are deleted but a stale
 * localStorage entry may still name the old wallet, and honouring it unconditionally
 * left the account reading as "linked" (linked-wallet chip + Unlink button) with
 * no holdings from that wallet left. The synthetic demo wallet is never a linked
 * wallet — it is a well-formed 0x address, so without the exclusion a demo-only
 * account reads as "linked" and grows an Unlink button that deletes-and-reseeds
 * its own demo cards (a no-op that looks like a broken unlink).
 *
 * @param {Array<object>} items
 * @param {string|null|undefined} defaultWallet - synthetic demo wallet from GET /meta
 * @param {string|null|undefined} lastWallet - wallet from localStorage, may be stale
 * @returns {string} lowercased linked wallet, or '' when none
 */
export function recoverLinkedWallet(items, defaultWallet, lastWallet) {
  const demoW = normalizeWalletAddr(defaultWallet);
  const last = normalizeWalletAddr(lastWallet);
  let firstNonDemo = '';
  let lastStillHeld = false;
  for (const it of Array.isArray(items) ? items : []) {
    const w = normalizeWalletAddr(it?.wallet);
    if (!w || w === demoW) continue;
    if (last && w === last) lastStillHeld = true;
    if (!firstNonDemo) firstNonDemo = w;
  }
  if (last && last !== demoW && lastStillHeld) return last;
  return firstNonDemo;
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
