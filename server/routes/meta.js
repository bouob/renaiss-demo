/**
 * GET/PUT /meta — uid-scoped inventory metadata under
 * hackathonMerchantInventory/{uid}/items/{cert}.
 * GET /meta?wallet=0x… is required (wallet-scoped inventory).
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { rememberHeldCert, rememberHeldCerts } from '../services/heldCertGate.js';
import { ensureDefaultPortfolio } from '../services/defaultPortfolio.js';
import { COLLECTION, CERT_SHAPE, sanitizeWallet, sanitizeItem } from '../lib/inventoryItem.js';

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
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable', items: [] });
    }
    const seed = await ensureDefaultPortfolio(req.uid).catch((err) => {
      console.warn(`[meta:get] seed skipped: ${err?.message ?? err}`);
      return { wallet: null, seeded: false };
    });
    const walletFilter = sanitizeWallet(req.query?.wallet) || seed.wallet;
    if (!walletFilter) {
      return res.json({ items: [], uid: req.uid, wallet: null, reason: 'wallet_required' });
    }

    const snap = await adminDb
      .collection(COLLECTION)
      .doc(req.uid)
      .collection('items')
      .get();
    // Demo default cards live under the account's synthetic default wallet.
    // Keep them visible when an existing user loads a real wallet; the cert
    // document is still unique per account, so this does not duplicate tokens.
    const defaultWallet = seed.wallet ? seed.wallet.toLowerCase() : null;
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((row) => {
        const w = typeof row.wallet === 'string' ? row.wallet.toLowerCase() : '';
        return w === walletFilter || w === defaultWallet;
      });
    rememberHeldCerts(items.map((i) => i.cert || i.id));
    return res.json({ items, uid: req.uid, wallet: walletFilter });
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

export default router;
