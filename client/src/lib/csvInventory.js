/**
 * CSV inventory import parser (P6).
 * Expects header row with at least `cert`; optional qty, cost, listPrice, name, status.
 * Rejects malformed rows (both accept and reject branches).
 */

const REQUIRED = 'cert';

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * @param {string} text
 * @returns {{ accepted: object[], rejected: { row: number, reason: string, raw?: string }[] }}
 */
export function parseInventoryCsv(text) {
  const accepted = [];
  const rejected = [];
  if (typeof text !== 'string' || !text.trim()) {
    return { accepted, rejected: [{ row: 0, reason: 'empty_file' }] };
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { accepted, rejected: [{ row: 0, reason: 'missing_header_or_rows' }] };
  }

  const headers = lines[0].split(',').map(normalizeHeader);
  const certIdx = headers.indexOf(REQUIRED);
  if (certIdx < 0) {
    return { accepted, rejected: [{ row: 1, reason: 'missing_cert_column' }] };
  }

  const idx = (name) => headers.indexOf(name);

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const cols = raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const cert = cols[certIdx] ?? '';
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(cert)) {
      rejected.push({ row: i + 1, reason: 'invalid_cert', raw });
      continue;
    }
    const qtyRaw = idx('qty') >= 0 ? cols[idx('qty')] : '1';
    const qty = Number(qtyRaw);
    if (qtyRaw !== '' && qtyRaw != null && !Number.isFinite(qty)) {
      rejected.push({ row: i + 1, reason: 'invalid_qty', raw });
      continue;
    }
    accepted.push({
      cert,
      qty: Number.isFinite(qty) ? qty : 1,
      cost: numOrNull(cols[idx('cost')]),
      listPrice: numOrNull(cols[idx('listprice')] ?? cols[idx('list_price')]),
      name: cols[idx('name')] || null,
      status: cols[idx('status')] || 'active',
    });
  }

  return { accepted, rejected };
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
