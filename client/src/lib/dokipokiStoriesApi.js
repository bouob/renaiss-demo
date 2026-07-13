import { requestJson } from './httpClient.js';

export async function fetchDokipokiStories({ locale } = {}) {
  const params = new URLSearchParams();
  if (locale) params.set('locale', locale);
  const query = params.toString();
  return requestJson(`/dokipoki-stories${query ? `?${query}` : ''}`);
}
