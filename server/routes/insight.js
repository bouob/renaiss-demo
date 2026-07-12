/**
 * POST /insight/merchant — Gemini merchant verdict (cache-first + daily quota).
 * Ownership-gated: cert must exist in caller's inventory.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { userOwnsCert } from './meta.js';
import {
  generateMerchantVerdict,
  isGeminiConfigured,
  pickLocaleContent,
} from '../services/geminiMerchantService.js';
import {
  readMerchantCache,
  writeMerchantCache,
  checkAndIncrementUsage,
  peekUsage,
  HARD_TTL_MS,
} from '../services/geminiMerchantCache.js';

const router = Router();
const CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/;
const DECISIONS = new Set(['promote', 'hold', 'clear']);

const insightLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.uid || req.ip,
  message: { error: 'rate_limited' },
});

function parseMerchantContext(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const decision = typeof raw.decision === 'string' && DECISIONS.has(raw.decision)
    ? raw.decision
    : 'hold';
  let alphaPct30d = raw.alphaPct30d;
  if (alphaPct30d != null) {
    alphaPct30d = Number(alphaPct30d);
    if (!Number.isFinite(alphaPct30d)) alphaPct30d = null;
    else alphaPct30d = Math.max(-1, Math.min(10, alphaPct30d));
  } else {
    alphaPct30d = null;
  }
  const thinMarketData = Boolean(raw.thinMarketData);
  const fmv = raw.renaissFmv && typeof raw.renaissFmv === 'object' ? raw.renaissFmv : {};
  let priceUsdCents = fmv.priceUsdCents != null ? Number(fmv.priceUsdCents) : null;
  if (!Number.isFinite(priceUsdCents) || priceUsdCents < 0 || priceUsdCents > 1e9) {
    priceUsdCents = null;
  } else {
    priceUsdCents = Math.round(priceUsdCents);
  }
  const confidence = typeof fmv.confidence === 'string' ? fmv.confidence.slice(0, 16) : null;
  return {
    decision,
    alphaPct30d,
    thinMarketData,
    liquidityScore: Number.isFinite(Number(raw.liquidityScore))
      ? Math.max(0, Math.min(100, Number(raw.liquidityScore)))
      : null,
    renaissFmv: { priceUsdCents, confidence },
  };
}

router.get('/insight/merchant-usage', requireAuth, async (req, res) => {
  try {
    const usage = await peekUsage(req.uid);
    return res.json(usage);
  } catch (err) {
    console.warn(`[insight:usage] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'usage_read_failed' });
  }
});

router.post('/insight/merchant', requireAuth, insightLimiter, async (req, res) => {
  try {
    const cert = String(req.body?.cert ?? '').trim();
    if (!CERT_SHAPE.test(cert)) {
      return res.status(400).json({ error: 'invalid_cert' });
    }
    const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet : null;
    const owned = await userOwnsCert(req.uid, cert, wallet);
    if (!owned) {
      return res.status(403).json({ error: 'not_owned', cert });
    }

    const locale = ['en', 'zh-TW', 'ja'].includes(req.body?.locale) ? req.body.locale : 'en';
    const merchantContext = parseMerchantContext(req.body?.merchantContext) || {
      decision: 'hold',
      alphaPct30d: null,
      thinMarketData: true,
      renaissFmv: {},
    };
    const cardMeta = {
      cardName: typeof req.body?.name === 'string' ? req.body.name.slice(0, 120) : null,
      setName: typeof req.body?.setName === 'string' ? req.body.setName.slice(0, 120) : null,
      grade: typeof req.body?.grade === 'string' ? req.body.grade.slice(0, 40) : null,
    };

    const cached = await readMerchantCache(req.uid, cert);
    if (cached.hit === 'fresh' && cached.content) {
      const content = pickLocaleContent(cached.content, locale) || cached.content.en;
      return res.json({
        locale,
        content,
        fromCache: true,
        cacheAgeMs: cached.ageMs,
      });
    }

    if (!isGeminiConfigured()) {
      if (cached.hit === 'stale' && cached.content) {
        const content = pickLocaleContent(cached.content, locale) || cached.content.en;
        return res.json({
          locale,
          content,
          fromCache: true,
          fallbackSource: 'stale_cache',
          cacheAgeMs: cached.ageMs,
          hardTtlMs: HARD_TTL_MS,
        });
      }
      return res.status(503).json({ error: 'gemini_unconfigured' });
    }

    // Gate on peek only — charge the daily quota AFTER a successful generate.
    // Charging first burned a slot on every gemini_upstream / invalid_output
    // failure, which made retries feel worse and hid the real error as quota.
    const usagePeek = await peekUsage(req.uid);
    if (usagePeek.count >= usagePeek.limit) {
      if (cached.hit === 'stale' && cached.content) {
        const content = pickLocaleContent(cached.content, locale) || cached.content.en;
        return res.json({
          locale,
          content,
          fromCache: true,
          fallbackSource: 'stale_cache_quota',
          cacheAgeMs: cached.ageMs,
          hardTtlMs: HARD_TTL_MS,
          usage: usagePeek,
        });
      }
      return res.status(429).json({
        error: 'quota_exceeded',
        mode: 'daily',
        limit: usagePeek.limit,
        count: usagePeek.count,
        day: usagePeek.day,
      });
    }

    try {
      const validated = await generateMerchantVerdict(cardMeta, merchantContext);
      const usage = await checkAndIncrementUsage(req.uid);
      // Race under concurrency can still refuse here; keep the verdict (cache it)
      // so the user isn't charged for a lost response.
      await writeMerchantCache(req.uid, cert, validated, {
        decision: merchantContext.decision,
        locale,
      });
      const content = pickLocaleContent(validated, locale) || validated.en;
      return res.json({
        locale,
        content,
        fromCache: false,
        usage: usage.allowed
          ? usage
          : { ...usagePeek, count: usagePeek.count + 1 },
      });
    } catch (genErr) {
      // genErr.detail carries the upstream response body (truncated) — without
      // it the log only says gemini_http_<status>, which is not diagnosable.
      console.warn(`[insight:merchant] generate failed: ${genErr?.message ?? genErr}${genErr?.detail ? ` — ${genErr.detail}` : ''}`);
      if (cached.hit === 'stale' && cached.content) {
        const content = pickLocaleContent(cached.content, locale) || cached.content.en;
        return res.json({
          locale,
          content,
          fromCache: true,
          fallbackSource: 'stale_cache_error',
          cacheAgeMs: cached.ageMs,
          hardTtlMs: HARD_TTL_MS,
        });
      }
      return res.status(502).json({ error: genErr?.code || 'gemini_failed' });
    }
  } catch (err) {
    console.warn(`[insight:merchant] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'insight_failed' });
  }
});

export default router;
