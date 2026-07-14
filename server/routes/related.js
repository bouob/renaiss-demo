/**
 * GET /related/:cert — cert → card brief + ±1 adjacent suggestions.
 * MUST be gated: non-held cert → fail-open empty WITHOUT calling upstream.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getAdjacentCertSuggestions, ATTRIBUTION_URL } from '../services/renaissAdjacentCertService.js';
import { getGradedCardBrief, isConfigured } from '../services/renaissOsIndex.js';
import { isHeldCertAllowed } from '../services/heldCertGate.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { optionalAuth } from '../middleware/requireAuth.js';

const router = Router();
const CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/;

const relatedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', neighbors: [], card: null },
});

async function isInInventory(uid, cert) {
  if (!adminDb || !uid) return false;
  try {
    const snap = await adminDb
      .collection('hackathonMerchantInventory')
      .doc(uid)
      .collection('items')
      .doc(cert)
      .get();
    return snap.exists;
  } catch {
    return false;
  }
}

router.get('/related/:cert', relatedLimiter, optionalAuth, async (req, res) => {
  const empty = {
    cert: req.params.cert ?? null,
    card: null,
    neighbors: [],
    attributionUrl: ATTRIBUTION_URL,
    gated: true,
    degraded: false,
  };

  try {
    const cert = String(req.params.cert ?? '').trim();
    if (!CERT_SHAPE.test(cert)) {
      return res.json({ ...empty, cert, reason: 'invalid_cert' });
    }

    // Ownership / scan gate — MUST run before any adjacency upstream call
    const heldInMem = isHeldCertAllowed(cert);
    const heldInInv = req.uid ? await isInInventory(req.uid, cert) : false;
    if (!heldInMem && !heldInInv) {
      // Gated-deny branch: empty result, zero upstream
      return res.json({ ...empty, cert, reason: 'not_held', gated: true });
    }

    // Gated-allow branch
    if (!isConfigured()) {
      return res.json({ ...empty, cert, gated: false, reason: 'service_unconfigured' });
    }

    const [card, suggestions] = await Promise.all([
      getGradedCardBrief(cert),
      getAdjacentCertSuggestions(cert),
    ]);

    return res.json({
      cert,
      card: card?.found ? card : null,
      neighbors: suggestions?.neighbors ?? [],
      attributionUrl: suggestions?.attributionUrl ?? ATTRIBUTION_URL,
      // MUST forward: without it an outage renders as "no adjacent cards on this
      // market" — an answer the merchant cannot act on. The list is empty either
      // way; only this flag says which kind of empty it is.
      degraded: Boolean(suggestions?.degraded),
      gated: false,
      reason: null,
    });
  } catch (err) {
    console.warn(`[related] unexpected error: ${err?.message ?? err}`);
    return res.json(empty);
  }
});

export default router;
