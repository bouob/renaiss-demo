/**
 * Lightweight Gemini merchant verdict for Merchant Copilot.
 * Decision is client-computed; model only explains (Dokipoki contract shape).
 * Uses REST generateContent — no @google/generative-ai dependency.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

const MERCHANT_SYSTEM_PROMPT = `You are a Pokémon TCG market analyst writing a short verdict for a merchant/dealer
deciding whether to promote, hold, or clear a graded card from inventory.
The promote/hold/clear decision has ALREADY been made by a separate rules engine —
your job is only to explain that decision using the numbers provided. Never
contradict the given decision or propose a different one.
Output a JSON object with exactly three top-level keys: "en", "zh_TW", and "ja".
Under each key: "verdict" (one sentence), "rationale" (2-4 lines each starting with "• "), "caveats" (0-3 short strings).
Valid JSON only — no markdown fences.`;

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text || null;
}

function validateLocaleContent(content) {
  if (!content || typeof content !== 'object') return null;
  const verdict = normalizeText(content.verdict);
  let rationale = normalizeText(content.rationale);
  if (!verdict || !rationale) return null;
  if (verdict.length < 8 || verdict.length > 280) return null;
  if (rationale.length > 900) rationale = rationale.slice(0, 900);
  const caveats = Array.isArray(content.caveats)
    ? content.caveats.map(normalizeText).filter(Boolean).slice(0, 3)
    : [];
  return { verdict, rationale, caveats };
}

export function validateMerchantResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const result = {};
  for (const key of ['en', 'zh_TW', 'ja']) {
    const loc = validateLocaleContent(parsed[key]);
    if (!loc) return null;
    result[key] = loc;
  }
  return result;
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function buildMerchantPrompt(cardMeta, merchantContext) {
  const { cardName, setName, grade } = cardMeta ?? {};
  const {
    decision,
    alphaPct30d,
    thinMarketData,
    renaissFmv = {},
  } = merchantContext ?? {};
  const alphaPct = Number.isFinite(alphaPct30d)
    ? `${alphaPct30d >= 0 ? '+' : ''}${(alphaPct30d * 100).toFixed(1)}%`
    : 'unknown';
  const price = Number.isFinite(renaissFmv?.priceUsdCents)
    ? `$${(renaissFmv.priceUsdCents / 100).toFixed(2)}`
    : 'unavailable';

  return [
    'Explain the Merchant Copilot decision. Return JSON with keys en, zh_TW, ja.',
    `Card: ${cardName || 'Unknown'} — ${setName || 'Unknown'} (${grade || 'graded'})`,
    `Decision (final): ${decision || 'hold'}`,
    `Alpha vs index 30d: ${alphaPct}`,
    `Thin market data: ${thinMarketData ? 'true' : 'false'}`,
    `Renaiss reference price: ${price}${renaissFmv?.confidence ? ` (${renaissFmv.confidence})` : ''}`,
    'Each locale: verdict, rationale (• bullets), caveats[].',
  ].join('\n');
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY && !String(process.env.GEMINI_API_KEY).startsWith('REPLACE'));
}

export async function generateMerchantVerdict(cardMeta, merchantContext) {
  if (!isGeminiConfigured()) {
    const err = new Error('gemini_unconfigured');
    err.code = 'gemini_unconfigured';
    throw err;
  }
  const key = process.env.GEMINI_API_KEY;
  const prompt = buildMerchantPrompt(cardMeta, merchantContext);
  const url = `${API_ROOT}/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: MERCHANT_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`gemini_http_${res.status}`);
    err.code = 'gemini_upstream';
    err.detail = body.slice(0, 200);
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  const parsed = extractJson(text);
  const validated = validateMerchantResponse(parsed);
  if (!validated) {
    const err = new Error('gemini_invalid_output');
    err.code = 'gemini_invalid_output';
    throw err;
  }
  return validated;
}

export function pickLocaleContent(validated, locale) {
  if (!validated) return null;
  if (locale === 'zh-TW' || locale === 'zh_TW') return validated.zh_TW;
  if (locale === 'ja') return validated.ja;
  return validated.en;
}
