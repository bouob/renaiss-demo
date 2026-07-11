import { getJson } from './httpClient.js';

/**
 * GET /portfolio-series — signed-in inventory-vs-index series.
 * Auth-required; wallet-scoped. Server is fail-open, so a resolved value with
 * `index: null` / empty `portfolio` means "no comparison yet", not an error.
 */
export function fetchPortfolioSeries({ authToken, wallet } = {}) {
  const q = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
  return getJson(`/portfolio-series${q}`, { authToken });
}
