// Maps server error codes (httpClient puts response body `error` on err.code)
// to i18n keys under `detail.aiErrors.*`. Server codes come from
// server/routes/insight.js + server/middleware/requireAuth.js.
const CODE_TO_KEY = {
  gemini_unconfigured: 'unavailable',
  gemini_failed: 'unavailable',
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
  const key = CODE_TO_KEY[err?.code];
  return key ? t(`detail.aiErrors.${key}`) : t('detail.aiFailed');
}
