import { getJson } from './httpClient.js';

/** GET /movers — ranked movers + promote/hold/clear */
export function fetchMovers(options = {}) {
  return getJson('/movers', options);
}
