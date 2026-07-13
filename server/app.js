/**
 * Pure Express app (no Firebase / GCF wrappers).
 * Mounted by:
 *   - index.js  → firebase-functions v2 onRequest (firebase deploy)
 *   - function.js → @google-cloud/functions-framework (gcloud functions deploy)
 *   - local listen when IS_LOCAL_DEV=true (index.js)
 */
import './env.js'; // MUST be first in every entry that imports this module graph
import express from 'express';
import cors from 'cors';

import wallRouter from './routes/wall.js';
import moversRouter from './routes/movers.js';
import cardRouter from './routes/card.js';
import relatedRouter from './routes/related.js';
import scanRouter from './routes/scan.js';
import metaRouter from './routes/meta.js';
import tickerRouter from './routes/ticker.js';
import insightRouter from './routes/insight.js';
import marketInsightRouter from './routes/marketInsight.js';
import salesRouter from './routes/sales.js';
import portfolioSeriesRouter from './routes/portfolioSeries.js';
import dokipokiStoriesRouter from './routes/dokipokiStories.js';

const app = express();
app.disable('x-powered-by');

// CORS: exact list when CORS_ORIGIN is set; reflect when CORS_ORIGIN=*
const rawCorsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5174';
const corsOriginList = rawCorsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
const corsReflect = corsOriginList.includes('*');
if (!process.env.IS_LOCAL_DEV && !process.env.CORS_ORIGIN) {
  console.warn('[startup] CORS_ORIGIN unset in non-local — defaulting to localhost:5174 only. Set CORS_ORIGIN=* for preview hosting or list exact origins.');
}
const corsOrigin = corsReflect
  ? true
  : (corsOriginList.length === 1 ? corsOriginList[0] : corsOriginList);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Routes under /merchant/api/** (path mount) and /api/** (root multi-site).
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'merchantApi',
    ts: new Date().toISOString(),
  });
});

router.use(wallRouter);
router.use(moversRouter);
router.use(tickerRouter);
router.use(cardRouter);
router.use(relatedRouter);
router.use(scanRouter);
router.use(metaRouter);
router.use(insightRouter);
router.use(marketInsightRouter);
router.use(salesRouter);
router.use(portfolioSeriesRouter);
router.use(dokipokiStoriesRouter);

app.use('/merchant/api', router);
app.use('/api', router);

// Also accept health at function URL root (some probes hit /)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'merchantApi',
    ts: new Date().toISOString(),
  });
});

if (!process.env.RENAISS_INDEX_API_KEY || !process.env.RENAISS_INDEX_API_SECRET) {
  console.warn('[startup] RENAISS_INDEX_API_KEY / RENAISS_INDEX_API_SECRET not set — Renaiss index/FMV lookups will fail-open to null/empty.');
}
if (!process.env.BSC_RPC_URL) {
  console.warn('[startup] BSC_RPC_URL not set — wallet scan (fetchHoldings) will fail-open to an empty result.');
} else if (!/^(https:\/\/[^/]+)\/v2\/(.+)$/.test(String(process.env.BSC_RPC_URL).trim())) {
  // isConfigured() requires an Alchemy-shaped …/v2/<key> URL; a bare RPC host
  // or mistyped secret disables scan while looking "configured" in the dashboard.
  console.warn('[startup] BSC_RPC_URL is set but not Alchemy /v2/ shape — wallet scan disabled (chain_unconfigured).');
}
if (!process.env.GCP_SERVICE_ACCOUNT_BASE64) {
  console.warn('[startup] GCP_SERVICE_ACCOUNT_BASE64 not set — Firestore-backed routes (/meta) will be unavailable until configured.');
}

export { app };
export default app;
