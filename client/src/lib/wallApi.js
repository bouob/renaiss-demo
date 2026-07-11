import { getJson } from './httpClient.js';

/** GET /wall — L1 market context */
export function fetchWall(options = {}) {
  return getJson('/wall', options);
}
