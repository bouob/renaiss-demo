// Single HTTP entry point for the client. Pages/components/hooks MUST go
// through this module (or a thin *Api.js wrapper built on top of it) — no
// direct fetch()/axios in UI code. Mirrors the boundary rule Dokipoki
// enforces in client/src/lib/httpClient.js, adapted for this standalone app
// (no Firebase auth header on Version A/market routes; Version B routes that
// need an ID token pass one in explicitly via `authToken`).

// API base path invariant (PLAN.md §部署): the server is a separate
// `merchantApi` function mounted at /merchant/api/**, never under Dokipoki's
// own /api/**.
const API_BASE = '/merchant/api';

const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
    didTimeOut: () => timedOut,
  };
}

function shouldSetJsonContentType(body, headers) {
  return (
    body != null
    && !(body instanceof FormData)
    && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
  );
}

async function parseResponse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function buildError(res) {
  const body = await parseResponse(res).catch(() => ({}));
  const err = new Error(body?.error ?? `${res.status} ${res.statusText}`);
  err.code = body?.code ?? body?.error ?? null;
  err.status = res.status;
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    err.retryAfter = retryAfter ? Number(retryAfter) : null;
  }
  err.body = body;
  return err;
}

/**
 * requestJson — the only place in the client that calls fetch().
 *
 * @param {string} path - route under /merchant/api, e.g. '/wall'.
 * @param {object} [options]
 * @param {string|null} [options.authToken] - Firebase ID token for
 *   uid-scoped Version B routes (/meta, /scan). Omit for Version A
 *   (/wall, /movers) — those routes are unauthenticated by design.
 * @param {Record<string,string>} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<any>}
 */
export async function requestJson(path, options = {}) {
  const {
    authToken = null,
    headers: extraHeaders = {},
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...fetchOptions
  } = options;

  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const headers = { ...authHeaders, ...extraHeaders };

  if (shouldSetJsonContentType(fetchOptions.body, headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const timeout = withTimeout(signal, timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: timeout.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError' && timeout.didTimeOut()) {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms: ${path}`);
      timeoutErr.code = 'request_timeout';
      throw timeoutErr;
    }
    throw err;
  } finally {
    timeout.cancel();
  }

  if (!res.ok) {
    throw await buildError(res);
  }

  return parseResponse(res);
}

export function getJson(path, options = {}) {
  return requestJson(path, { ...options, method: 'GET' });
}

export function postJson(path, body, options = {}) {
  return requestJson(path, { ...options, method: 'POST', body: JSON.stringify(body ?? {}) });
}

export function putJson(path, body, options = {}) {
  return requestJson(path, { ...options, method: 'PUT', body: JSON.stringify(body ?? {}) });
}
