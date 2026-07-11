/**
 * GET/PUT /meta — uid-scoped inventory metadata
 * (cost / listPrice / qty / target / stop / status) under
 * hackathonMerchantInventory/{uid}/items/{cert}.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { rememberHeldCert, rememberHeldCerts } from '../services/heldCertGate.js';

const router = Router();
const COLLECTION = 'hackathonMerchantInventory';
const CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/;
const STATUSES = new Set(['active', 'promoted', 'delisted', 'sold', 'hold', 'clear']);

function itemRef(uid, cert) {
  return adminDb.collection(COLLECTION).doc(uid).collection('items').doc(cert);
}

function sanitizeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeItem(body, cert) {
  const status = typeof body.status === 'string' && STATUSES.has(body.status)
    ? body.status
    : 'active';
  return {
    cert,
    cost: sanitizeNumber(body.cost),
    listPrice: sanitizeNumber(body.listPrice),
    qty: sanitizeNumber(body.qty) ?? 1,
    target: sanitizeNumber(body.target),
    stop: sanitizeNumber(body.stop),
    status,
    name: typeof body.name === 'string' ? body.name.slice(0, 200) : null,
    setName: typeof body.setName === 'string' ? body.setName.slice(0, 200) : null,
    grade: typeof body.grade === 'string' ? body.grade.slice(0, 40) : null,
    imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl.slice(0, 500) : null,
    priceUsdCents: sanitizeNumber(body.priceUsdCents),
    href: typeof body.href === 'string' ? body.href.slice(0, 300) : null,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null,
    updatedAt: new Date().toISOString(),
  };
}

router.get('/meta', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable', items: [] });
    }
    const snap = await adminDb
      .collection(COLLECTION)
      .doc(req.uid)
      .collection('items')
      .get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rememberHeldCerts(items.map((i) => i.cert || i.id));
    return res.json({ items, uid: req.uid });
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
    const merged = {
      ...(existing.exists ? existing.data() : {}),
      ...patch,
      createdAt: existing.exists ? (existing.data().createdAt ?? patch.updatedAt) : patch.updatedAt,
    };
    await ref.set(merged, { merge: true });
    rememberHeldCert(cert);
    return res.json({ ok: true, item: merged });
  } catch (err) {
    console.warn(`[meta:put] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'meta_write_failed' });
  }
});

/** Bulk CSV-style import: { items: [{ cert, ... }] } */
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
