import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { fetchWallSummary } from './wall.js';
import { readWallCache } from '../services/wallCache.js';
import {
  generateMarketInsight as realGenerateMarketInsight,
  isGeminiConfigured,
  pickLocaleMarketInsight,
} from '../services/geminiMarketInsightService.js';
import {
  readMarketInsightCache as realReadMarketInsightCache,
  writeMarketInsightCache as realWriteMarketInsightCache,
  HARD_TTL_MS,
  utcDay,
} from '../services/geminiMarketInsightCache.js';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function buildSummaryMeta(summary) {
  return {
    label: summary?.label ?? summary?.game ?? null,
    value: Number.isFinite(summary?.value) ? summary.value : null,
    deltas: summary?.deltas ?? null,
    constituentCount: Number.isFinite(summary?.constituentCount) ? summary.constituentCount : null,
    updatedAt: summary?.updatedAt ?? null,
  };
}

async function realGetSummary() {
  return readWallCache() ?? (await fetchWallSummary());
}

export function createMarketInsightRouter({
  getSummary = realGetSummary,
  readMarketInsightCache = realReadMarketInsightCache,
  writeMarketInsightCache = realWriteMarketInsightCache,
  generateMarketInsight = realGenerateMarketInsight,
  geminiConfigured = isGeminiConfigured,
} = {}) {
  const router = Router();

  router.get('/insight/market', limiter, async (req, res) => {
    try {
      const locale = ['en', 'zh-TW', 'ja', 'ko'].includes(req.query?.locale) ? req.query.locale : 'en';
      const day = utcDay();
      const cached = await readMarketInsightCache(day);
      if (cached.hit === 'fresh' && cached.content) {
        return res.json({
          locale,
          content: pickLocaleMarketInsight(cached.content, locale) || cached.content.en,
          fromCache: true,
          cacheAgeMs: cached.ageMs,
          day,
        });
      }

      const summary = await getSummary();
      if (!summary) {
        if (cached.hit === 'stale' && cached.content) {
          return res.json({
            locale,
            content: pickLocaleMarketInsight(cached.content, locale) || cached.content.en,
            fromCache: true,
            fallbackSource: 'stale_cache_no_summary',
            cacheAgeMs: cached.ageMs,
            hardTtlMs: HARD_TTL_MS,
            day,
          });
        }
        return res.status(503).json({ error: 'market_summary_unavailable' });
      }

      if (!geminiConfigured()) {
        if (cached.hit === 'stale' && cached.content) {
          return res.json({
            locale,
            content: pickLocaleMarketInsight(cached.content, locale) || cached.content.en,
            fromCache: true,
            fallbackSource: 'stale_cache_unconfigured',
            cacheAgeMs: cached.ageMs,
            hardTtlMs: HARD_TTL_MS,
            day,
            summary: buildSummaryMeta(summary),
          });
        }
        return res.status(503).json({ error: 'gemini_unconfigured' });
      }

      try {
        const validated = await generateMarketInsight(summary);
        const summaryMeta = buildSummaryMeta(summary);
        await writeMarketInsightCache(day, validated, { summary: summaryMeta });
        return res.json({
          locale,
          content: pickLocaleMarketInsight(validated, locale) || validated.en,
          fromCache: false,
          day,
          summary: summaryMeta,
        });
      } catch (genErr) {
        console.warn(`[insight:market] generate failed: ${genErr?.message ?? genErr}${genErr?.detail ? ` — ${genErr.detail}` : ''}`);
        if (cached.hit === 'stale' && cached.content) {
          return res.json({
            locale,
            content: pickLocaleMarketInsight(cached.content, locale) || cached.content.en,
            fromCache: true,
            fallbackSource: 'stale_cache_error',
            cacheAgeMs: cached.ageMs,
            hardTtlMs: HARD_TTL_MS,
            day,
            summary: buildSummaryMeta(summary),
          });
        }
        return res.status(502).json({ error: genErr?.code || 'gemini_failed' });
      }
    } catch (err) {
      console.warn(`[insight:market] ${err?.message ?? err}`);
      return res.status(500).json({ error: 'market_insight_failed' });
    }
  });

  return router;
}

export default createMarketInsightRouter();
