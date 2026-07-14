/**
 * In-memory allowlist of certs the caller has scanned or looked up.
 * Used by GET /related/:cert ownership gate so arbitrary certs cannot burn
 * the shared Renaiss quota/breaker. TTL 6h, oldest-first cap.
 */

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

/** @type {Map<string, number>} cert -> expiresAtMs */
const allowlist = new Map();

function evictExpired(now = Date.now()) {
  for (const [cert, exp] of allowlist) {
    if (exp <= now) allowlist.delete(cert);
  }
  while (allowlist.size > MAX_ENTRIES) {
    const oldest = allowlist.keys().next().value;
    allowlist.delete(oldest);
  }
}

export function rememberHeldCert(cert) {
  if (typeof cert !== 'string' || !cert.trim()) return;
  const key = cert.trim();
  allowlist.set(key, Date.now() + TTL_MS);
  if (allowlist.size > MAX_ENTRIES) evictExpired();
}

export function rememberHeldCerts(certs) {
  for (const c of certs ?? []) rememberHeldCert(c);
}

export function forgetHeldCert(cert) {
  if (typeof cert !== 'string' || !cert.trim()) return;
  allowlist.delete(cert.trim());
}

export function isHeldCertAllowed(cert) {
  if (typeof cert !== 'string' || !cert.trim()) return false;
  const key = cert.trim();
  const exp = allowlist.get(key);
  if (!exp) return false;
  if (exp <= Date.now()) {
    allowlist.delete(key);
    return false;
  }
  return true;
}

export function __resetHeldCertGateForTest() {
  allowlist.clear();
}
