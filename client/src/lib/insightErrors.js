// Maps server error codes (httpClient puts response body `error` on err.code)
// to i18n keys under `detail.aiErrors.*`. Server codes come from
// server/routes/insight.js + server/middleware/requireAuth.js +
// server/services/geminiMerchantService.js.
const CODE_TO_KEY = {
  gemini_unconfigured: 'unavailable',
  gemini_failed: 'unavailable',
  gemini_upstream: 'upstream',
  gemini_invalid_output: 'invalidOutput',
  gemini_empty_candidates: 'upstream',
  insight_failed: 'unavailable',
  usage_read_failed: 'unavailable',
  quota_exceeded: 'quota',
  rate_limited: 'rateLimited',
  not_owned: 'notOwned',
  invalid_cert: 'invalidCert',
  request_timeout: 'timeout',
};

/**
 * @param {{ code?: string|null, status?: number }} err
 * @param {(key: string) => string} t - i18next translator
 * @returns {string} user-facing message; never a raw server code
 */
export function merchantInsightErrorMessage(err, t) {
  if (err?.status === 401) return t('detail.aiNeedSignIn');
  // gemini_http_404 etc. still land as Error.message when body is non-JSON;
  // prefer structured code, then fall back to status bucket.
  const code = err?.code;
  if (code && CODE_TO_KEY[code]) return t(`detail.aiErrors.${CODE_TO_KEY[code]}`);
  if (err?.status === 502 || err?.status === 503) return t('detail.aiErrors.upstream');
  if (err?.status === 429) return t('detail.aiErrors.rateLimited');
  return t('detail.aiFailed');
}
