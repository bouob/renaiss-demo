/**
 * Firebase ID token verification for uid-scoped Version B routes.
 * Version A (/wall, /movers) stays unauthenticated.
 */

import { adminAuth } from '../services/firebaseAdmin.js';

/**
 * Require a valid Bearer Firebase ID token. Sets req.user and req.uid.
 * 401 if missing/invalid; 503 if Admin Auth unavailable (fail-closed on
 * store outage — never elevates anonymous to authenticated).
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token provided' });
  }
  if (!adminAuth) {
    return res.status(503).json({ error: 'Auth service unavailable' });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    req.uid = decoded.uid;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

/**
 * Optional auth — attaches req.user when token valid, never rejects.
 */
export async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token && adminAuth) {
    try {
      req.user = await adminAuth.verifyIdToken(token);
      req.uid = req.user.uid;
    } catch { /* stay anonymous */ }
  }
  next();
}
