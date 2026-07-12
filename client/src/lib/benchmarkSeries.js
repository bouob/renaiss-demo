/**
 * Pure helpers for the Dashboard benchmark "inventory vs index" chart.
 * No React/i18n imports so they run under `node --test`.
 */

function toValueMap(series) {
  const map = new Map();
  for (const point of series ?? []) {
    const t = point?.t;
    const v = point?.usdCents;
    if (typeof t === 'string' && Number.isFinite(v)) map.set(t, v);
  }
  return map;
}

/**
 * Rebase both series to 100 at the earliest date they share (finite on both).
 * Returns null when there is no shared date.
 */
export function rebaseToShared(portfolio, indexSparkline) {
  const pMap = toValueMap(portfolio);
  const iMap = toValueMap(indexSparkline);

  const sharedDates = [...pMap.keys()].filter((t) => iMap.has(t)).sort();
  if (sharedDates.length === 0) return null;

  const baseDate = sharedDates[0];
  const pBase = pMap.get(baseDate);
  const iBase = iMap.get(baseDate);
  if (!pBase || !iBase) return null;

  const portfolioRebased = sharedDates.map((t) => ({ t, v: Math.round((pMap.get(t) / pBase) * 100 * 1e10) / 1e10 }));
  const indexRebased = sharedDates.map((t) => ({ t, v: Math.round((iMap.get(t) / iBase) * 100 * 1e10) / 1e10 }));
  return { portfolioRebased, indexRebased, baseDate };
}

/** Percentage-point outperformance of the portfolio line over the index line. */
export function computeAlpha(portfolioRebased, indexRebased) {
  if (!portfolioRebased?.length || !indexRebased?.length) return 0;
  const pLast = portfolioRebased[portfolioRebased.length - 1].v;
  const iLast = indexRebased[indexRebased.length - 1].v;
  return (pLast - 100) - (iLast - 100);
}
