/**
 * GET/PUT /meta — uid-scoped inventory metadata under
 * hackathonMerchantInventory/{uid}/items/{cert}.
 * GET /meta?wallet=0x… is required (wallet-scoped inventory).
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { adminDb, adminAuth } from '../services/firebaseAdmin.js';
import { rememberHeldCert, rememberHeldCerts, forgetHeldCert } from '../services/heldCertGate.js';
import { discardDemoData, checkDiscardEligibility } from '../services/demoCleanup.js';
import {
  ensureDefaultPortfolio,
  syntheticWallet,
  unlinkWalletInventory,
  clearDemoInventory,
} from '../services/defaultPortfolio.js';
import { COLLECTION, CERT_SHAPE, sanitizeWallet, sanitizeItem, selectInventoryItems } from '../lib/inventoryItem.js';

const router = Router();
export { COLLECTION } from '../lib/inventoryItem.js';

function itemRef(uid, cert) {
  return adminDb.collection(COLLECTION).doc(uid).collection('items').doc(cert);
}

/** Whether uid owns cert under optional wallet filter (for insight ownership gate). */
export async function userOwnsCert(uid, cert, wallet = null) {
  if (!adminDb || !uid || !CERT_SHAPE.test(String(cert || ''))) return false;
  const snap = await itemRef(uid, String(cert).trim()).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  if (data.status === 'sold' || data.status === 'delisted') {
    // still "owned" for historical AI? plan says inventory certs — allow active-ish
  }
  if (wallet) {
    const w = sanitizeWallet(wallet);
    const rowW = typeof data.wallet === 'string' ? data.wallet.toLowerCase() : '';
    if (w && rowW && rowW !== w) return false;
  }
  return true;
}

router.get('/meta', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable', items: [] });
    }
    const seed = await ensureDefaultPortfolio(req.uid).catch((err) => {
      console.warn(`[meta:get] seed skipped: ${err?.message ?? err}`);
      return { wallet: null, seeded: false };
    });
    const walletFilter = sanitizeWallet(req.query?.wallet);
    const snap = await adminDb
      .collection(COLLECTION)
      .doc(req.uid)
      .collection('items')
      .get();
    // Always expose a demo wallet id so chips/filter work even when seed
    // write failed (account may already have synthetic-wallet rows).
    const defaultWallet = (seed.wallet || syntheticWallet(req.uid) || '').toLowerCase() || null;
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const items = selectInventoryItems(rows, walletFilter, defaultWallet);
    rememberHeldCerts(items.map((i) => i.cert || i.id));
    return res.json({
      items,
      uid: req.uid,
      wallet: walletFilter,
      // Synthetic seed wallet — client uses this to chip/filter demo rows.
      defaultWallet,
    });
  } catch (err) {
    console.warn(`[meta:get] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'meta_read_failed', items: [] });
  }
});

router.put('/meta', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable' });
    }
    const cert = String(req.body?.cert ?? '').trim();
    if (!CERT_SHAPE.test(cert)) {
      return res.status(400).json({ error: 'invalid_cert' });
    }

    const patch = sanitizeItem(req.body ?? {}, cert);
    const ref = itemRef(req.uid, cert);
    const existing = await ref.get();
    const prev = existing.exists ? existing.data() : {};
    const merged = {
      ...prev,
      ...patch,
      wallet: patch.wallet ?? prev.wallet ?? null,
      createdAt: existing.exists ? (prev.createdAt ?? patch.updatedAt) : patch.updatedAt,
    };
    await ref.set(merged, { merge: true });
    rememberHeldCert(cert);
    return res.json({ ok: true, item: merged });
  } catch (err) {
    console.warn(`[meta:put] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'meta_write_failed' });
  }
});

router.post('/meta/bulk', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable' });
    }
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rows.length === 0) {
      return res.status(400).json({ error: 'empty_items', accepted: 0, rejected: [] });
    }
    if (rows.length > 200) {
      return res.status(400).json({ error: 'too_many_items', accepted: 0, rejected: [] });
    }

    const accepted = [];
    const rejected = [];
    // Firestore batch limit 500; we cap at 200 items.
    const batch = adminDb.batch();
    let batchCount = 0;

    for (const row of rows) {
      const cert = String(row?.cert ?? '').trim();
      if (!CERT_SHAPE.test(cert)) {
        rejected.push({ cert, reason: 'invalid_cert' });
        continue;
      }
      const patch = sanitizeItem(row, cert);
      const ref = itemRef(req.uid, cert);
      // merge:true preserves fields omitted from patch; stamp createdAt only when new.
      batch.set(ref, { ...patch, createdAt: patch.updatedAt }, { merge: true });
      batchCount += 1;
      accepted.push(cert);
      rememberHeldCert(cert);
    }

    if (batchCount > 0) await batch.commit();
    return res.json({ ok: true, accepted: accepted.length, rejected, certs: accepted });
  } catch (err) {
    console.warn(`[meta:bulk] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'meta_bulk_failed', accepted: 0, rejected: [] });
  }
});

/**
 * POST /meta/discard-demo — tear down an abandoned anonymous demo account.
 *
 * Called after a demo visitor upgrades to Google: the request is authenticated
 * as the new real user (requireAuth), and the anonymous ID token — captured
 * client-side before the switch — is passed in the body to prove ownership of
 * the account being deleted. Nothing is migrated; the demo data is disposable.
 * Idempotent/retry-safe, so the client may re-send on a prior failure.
 */
router.post('/meta/discard-demo', requireAuth, async (req, res) => {
  try {
    if (!adminDb || !adminAuth) {
      return res.status(503).json({ error: 'store_unavailable' });
    }
    const anonToken = typeof req.body?.anonToken === 'string' ? req.body.anonToken : '';
    if (!anonToken) {
      return res.status(400).json({ error: 'missing_anon_token' });
    }

    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(anonToken);
    } catch {
      return res.status(400).json({ error: 'invalid_anon_token' });
    }

    // Only an anonymous session may be discarded, and never the caller's own
    // (real) account — guards against a token mix-up wiping live data.
    const eligibility = checkDiscardEligibility(decoded, req.uid);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({ error: eligibility.error });
    }
    const { anonUid } = eligibility;

    const { deleted } = await discardDemoData(anonUid);

    // Best-effort auth-account removal. Already-deleted is success (idempotent);
    // any other failure leaves an empty auth stub the client can retry against.
    let userDeleted = true;
    try {
      await adminAuth.deleteUser(anonUid);
    } catch (err) {
      if (err?.code === 'auth/user-not-found') {
        // Idempotent: the auth record is already gone, so cleanup is complete.
        userDeleted = true;
      } else {
        userDeleted = false;
        console.warn(`[meta:discard-demo] deleteUser ${anonUid}: ${err?.message ?? err}`);
      }
    }

    if (!userDeleted) {
      // Firestore data has already been removed, but the auth account still
      // exists. Return non-2xx so the client retains its pending-cleanup token
      // and retries account deletion instead of clearing the marker.
      return res.status(502).json({
        error: 'demo_auth_cleanup_failed',
        ok: false,
        deleted,
        userDeleted: false,
      });
    }

    return res.json({ ok: true, deleted, userDeleted });
  } catch (err) {
    console.warn(`[meta:discard-demo] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'discard_failed' });
  }
});

/**
 * POST /meta/unlink-wallet — remove personal holdings for a wallet and restore
 * any demo seed certs that were overwritten by cert collisions.
 * Body: { wallet: "0x…" }
 */
router.post('/meta/unlink-wallet', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable' });
    }
    const wallet = sanitizeWallet(req.body?.wallet);
    if (!wallet) {
      return res.status(400).json({ error: 'invalid_wallet' });
    }
    const result = await unlinkWalletInventory(req.uid, wallet);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.warn(`[meta:unlink-wallet] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'unlink_failed' });
  }
});

/**
 * POST /meta/clear-demo — delete every seeded demo row (rows tagged with the
 * account's synthetic wallet). Personal / manual rows and sales are left intact.
 */
router.post('/meta/clear-demo', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable' });
    }
    const result = await clearDemoInventory(req.uid);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.warn(`[meta:clear-demo] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'clear_demo_failed' });
  }
});

/**
 * DELETE /meta/:cert — remove a single holding the user owns (demo or personal).
 * Demo deletes stick: the seeder does not re-add certs the user removed.
 */
router.delete('/meta/:cert', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable' });
    }
    const cert = String(req.params?.cert ?? '').trim();
    if (!CERT_SHAPE.test(cert)) {
      return res.status(400).json({ error: 'invalid_cert' });
    }
    const ref = itemRef(req.uid, cert);
    const existing = await ref.get();
    const removed = existing.exists ? 1 : 0;
    if (removed) await ref.delete();
    // Drop the /related quota allowance for a cert the user no longer holds,
    // mirroring how PUT/GET remember held certs.
    forgetHeldCert(cert);
    return res.json({ ok: true, removed });
  } catch (err) {
    console.warn(`[meta:delete] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'meta_delete_failed' });
  }
});

export default router;
