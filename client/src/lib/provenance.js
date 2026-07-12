/**
 * How an inventory row got here (wallet scan / cert lookup / CSV import), as a
 * display string. Lives in lib because both the Inventory page and the holding
 * detail modal render it — a component importing it from the page would invert
 * the dependency direction.
 *
 * @param {object} item - inventory row (addedVia / sourceWallet / createdAt).
 * @param {(key: string, vars?: object) => string} t - i18next translator.
 * @returns {string} localized label, or '' when the row carries no provenance.
 */
export function provenanceLabel(item, t) {
  const date = item?.createdAt ? new Date(item.createdAt).toLocaleDateString() : '';
  const wallet = item?.sourceWallet
    ? `${item.sourceWallet.slice(0, 6)}…${item.sourceWallet.slice(-4)}`
    : '';
  switch (item?.addedVia) {
    case 'scan': return t('inventory.provenanceScan', { wallet, date });
    case 'cert': return t('inventory.provenanceCert', { date });
    case 'csv': return t('inventory.provenanceCsv', { date });
    default: return item?.createdAt ? t('inventory.provenanceUnknown', { date }) : '';
  }
}
