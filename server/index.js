import './env.js'; // MUST be first — loads dotenv before any other module reads process.env
import express from 'express';
import cors from 'cors';
import { onRequest } from 'firebase-functions/v2/https';

// Route modules (Version A market + Version B inventory)
import wallRouter from './routes/wall.js';
import moversRouter from './routes/movers.js';
import cardRouter from './routes/card.js';
import relatedRouter from './routes/related.js';
import scanRouter from './routes/scan.js';
import metaRouter from './routes/meta.js';
import tickerRouter from './routes/ticker.js';
import insightRouter from './routes/insight.js';

// Renaiss Merchant Copilot API — thin, synchronous Express app (no Cloud
// Tasks / webhook / Privy / subscriptions; see PLAN.md §鎖定決策 + §架構).

const app = express();
app.disable('x-powered-by');

const PORT = process.env.PORT || 3101;
const HOST = process.env.HOST || '0.0.0.0';

// CORS: exact list when CORS_ORIGIN is set; reflect request origin when
// CORS_ORIGIN=* (preview channels have unpredictable hostnames). Local
// default is the Vite dev origin.
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

// Routes under /merchant/api/** (path mount on dokipoki-dev) and /api/**
// (root multi-site merchant.dokipoki.app). Same router, two prefixes.
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Version A — unauthenticated market routes
router.use(wallRouter);
router.use(moversRouter);
router.use(tickerRouter);

// Version B — card lookup is public (IP-gated related/scan handle abuse)
router.use(cardRouter);
router.use(relatedRouter);
router.use(scanRouter);
// uid-scoped meta (requireAuth inside the router)
router.use(metaRouter);
// Gemini merchant verdict (requireAuth + ownership + cache)
router.use(insightRouter);

app.use('/merchant/api', router);
app.use('/api', router);

if (!process.env.RENAISS_INDEX_API_KEY || !process.env.RENAISS_INDEX_API_SECRET) {
  console.warn('[startup] RENAISS_INDEX_API_KEY / RENAISS_INDEX_API_SECRET not set — Renaiss index/FMV lookups will fail-open to null/empty.');
}
if (!process.env.BSC_RPC_URL) {
  console.warn('[startup] BSC_RPC_URL not set — wallet scan (fetchHoldings) will fail-open to an empty result.');
}
if (!process.env.GCP_SERVICE_ACCOUNT_BASE64) {
  console.warn('[startup] GCP_SERVICE_ACCOUNT_BASE64 not set — Firestore-backed routes (/meta) will be unavailable until configured.');
}

export const merchantApi = onRequest({ region: 'asia-east1', maxInstances: 1 }, app);

function startLocalServer(port, preferredHost) {
  const fallbackHost = '127.0.0.1';

  const listenOnHost = (host, allowFallback) => {
    const server = app.listen(port, host, () => {
      console.log(`Renaiss Merchant server running locally on http://${host}:${port}`);
    });

    server.on('error', (err) => {
      if (allowFallback && host !== fallbackHost && err.code === 'EPERM') {
        console.warn(`[server] Failed to bind ${host}:${port} (${err.code}). Retrying on ${fallbackHost}:${port}.`);
        return listenOnHost(fallbackHost, false);
      }

      console.error('[server] Local startup failed:', {
        message: err.message,
        code: err.code,
        address: err.address,
        port: err.port,
        host,
      });
      process.exit(1);
    });
  };

  listenOnHost(preferredHost, true);
}

if (process.env.IS_LOCAL_DEV === 'true') {
  startLocalServer(PORT, HOST);
}

export default app;
