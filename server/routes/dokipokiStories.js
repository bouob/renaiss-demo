import { Router } from 'express';
import { adminDb } from '../services/firebaseAdmin.js';

const router = Router();
const VALID_LOCALES = ['en', 'zh-TW', 'ja', 'ko'];

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

router.get('/dokipoki-stories', async (req, res) => {
  const locale = VALID_LOCALES.includes(req.query?.locale) ? req.query.locale : 'en';

  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'Trend cache unavailable', stories: [] });
    }

    const cache = adminDb.collection('_trendCache');
    const date = todayUtc();
    let snapshot = await cache.doc(`${date}:${locale}`).get();
    // Dokipoki currently generates Korean through its English fallback, so use
    // the canonical English cache when a locale-specific document is absent.
    if (!snapshot.exists && locale !== 'en') snapshot = await cache.doc(`${date}:en`).get();
    if (!snapshot.exists) return res.json({ stories: [] });

    const payload = snapshot.data() || {};
    const generatedAt = timestampToIso(payload.generatedAt);
    const stories = Array.isArray(payload.trends)
      ? payload.trends.map((trend, index) => ({
        id: `market_pulse:${trend.id ?? index}`,
        type: 'market_pulse',
        scope: 'global',
        signal: {
          title: trend.title ?? null,
          summary: trend.summary ?? null,
          sentiment: trend.sentiment ?? 'neutral',
          category: trend.category ?? null,
          matchedCards: Array.isArray(trend.matchedCards) ? trend.matchedCards.slice(0, 4) : [],
        },
        generatedAt,
      }))
      : [];

    return res.json({ stories });
  } catch (err) {
    console.error('[GET /dokipoki-stories] Firestore read failed', err.message);
    return res.status(503).json({ error: 'Trend cache unavailable', stories: [] });
  }
});

export default router;
