export const NO_PRICE_INFO = 'No Price Info';

export function formatSignedCurrency(value, fmtCurrency, opts) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const amount = Number(value);
  const sign = amount >= 0 ? '+' : '-';
  return `${sign}${fmtCurrency(Math.abs(amount), opts)}`;
}
