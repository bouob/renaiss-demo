/**
 * Firebase Admin SDK init from GCP_SERVICE_ACCOUNT_BASE64 (Dokipoki dev project).
 * Fail-open: if unset/invalid, adminDb/adminAuth stay null and auth-gated
 * routes return 503 rather than crashing.
 */

import admin from 'firebase-admin';

/** @type {import('firebase-admin').firestore.Firestore | null} */
export let adminDb = null;
/** @type {import('firebase-admin').auth.Auth | null} */
export let adminAuth = null;
/** @type {import('firebase-admin').app.App | null} */
export let adminApp = null;

function init() {
  const b64 = process.env.GCP_SERVICE_ACCOUNT_BASE64;
  if (!b64 || b64.startsWith('REPLACE_ME')) {
    console.warn('[firebaseAdmin] GCP_SERVICE_ACCOUNT_BASE64 unset — Admin SDK disabled (fail-open).');
    return;
  }
  try {
    if (admin.apps?.length) {
      adminApp = admin.app();
    } else {
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(json),
      });
    }
    adminDb = admin.firestore();
    adminAuth = admin.auth();
  } catch (err) {
    console.warn(`[firebaseAdmin] init failed: ${err?.message ?? err}`);
    adminDb = null;
    adminAuth = null;
    adminApp = null;
  }
}

init();

/**
 * Test-only seam: inject fake Admin SDK handles so uid-scoped route tests can
 * exercise auth-gated paths without real credentials. Mirrors the
 * `__resetForTest` seams in heldCertGate / renaissOsIndex. Because `adminDb`
 * and `adminAuth` are live ESM bindings, reassigning them here updates every
 * importer (routes/meta.js, middleware/requireAuth.js). Pass nulls to restore
 * the fail-open default.
 * @param {{ db?: unknown, auth?: unknown }} [handles]
 */
export function __setAdminForTest({ db = null, auth = null } = {}) {
  adminDb = db;
  adminAuth = auth;
}
