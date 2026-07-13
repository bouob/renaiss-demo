/**
 * GET /card/:cert — single-cert FMV + brief (+ optional 30d series).
 * graded-only; found:false when no Renaiss data. Never guesses price.
 */

import { Router } from 'express';
import {
  getGradedFmv,
  getGradedCardBrief,
  getCardFmvSeries,
  isConfigured,
} from '../services/renaissOsIndex.js';
import { hrefToSlug, ATTRIBUTION_URL } from '../services/renaissPortfolioSeries.js';
import { rememberHeldCert } from '../services/heldCertGate.js';

const router = Router();
const CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/;

function seriesReturn(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0]?.usdCents;
  const last = points[points.length - 1]?.usdCents;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return (last - first) / first;
}

router.get('/card/:cert', async (req, res) => {
  try {
    const cert = String(req.params.cert ?? '').trim();
    if (!CERT_SHAPE.test(cert)) {
      return res.status(400).json({ error: 'invalid_cert', found: false });
    }
    // Only cache well-formed lookups — never a 400 with a public directive.
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');

    // Looking up a cert counts as "scanned" for related-gate purposes
    rememberHeldCert(cert);

    if (!isConfigured()) {
      return res.json({
        found: false,
        reason: 'service_unconfigured',
        cert,
        fmv: null,
        brief: null,
        series30d: [],
        returnPct30d: null,
        attributionUrl: ATTRIBUTION_URL,
      });
    }

    const [fmv, brief] = await Promise.all([
      getGradedFmv(cert),
      getGradedCardBrief(cert),
    ]);

    const found = Boolean(fmv?.found || brief?.found);
    if (!found) {
      return res.json({
        found: false,
        reason: fmv?.reason ?? brief?.reason ?? 'not_found',
        cert,
        fmv: fmv ?? null,
        brief: brief ?? null,
        series30d: [],
        returnPct30d: null,
        attributionUrl: ATTRIBUTION_URL,
      });
    }

    const href = fmv?.href ?? brief?.href ?? null;
    const slug = hrefToSlug(href);
    let series30d = [];
    let returnPct30d = null;
    if (slug && (req.query.series === '1' || req.query.series === 'true' || req.query.includeSeries === '1')) {
      const points = await getCardFmvSeries(slug, { window: 30 });
      series30d = Array.isArray(points) ? points : [];
      returnPct30d = seriesReturn(series30d);
    }

    return res.json({
      found: true,
      reason: null,
      cert,
      fmv: fmv ?? null,
      brief: brief ?? null,
      series30d,
      returnPct30d,
      slug,
      attributionUrl: ATTRIBUTION_URL,
    });
  } catch (err) {
    console.warn(`[card] unexpected error: ${err?.message ?? err}`);
    return res.json({
      found: false,
      reason: 'error',
      cert: req.params.cert ?? null,
      fmv: null,
      brief: null,
      series30d: [],
      returnPct30d: null,
      attributionUrl: ATTRIBUTION_URL,
    });
  }
});

export default router;
