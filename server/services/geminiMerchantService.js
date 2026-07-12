/**
 * Lightweight Gemini merchant verdict for Merchant Copilot.
 * Decision is client-computed; model only explains (Dokipoki contract shape).
 * Uses REST generateContent — no @google/generative-ai dependency.
 */

// Must match a model the shared GEMINI_API_KEY can actually call — Dokipoki
// runs 2.5-flash-lite on the same key (server/config/geminiModels.js).
// Fallbacks cover keys that only have older free-tier models enabled.
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
].filter(Boolean);
// de-dupe while preserving order
const MODELS = [...new Set(MODEL_CANDIDATES)];

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [800, 2000];

const MERCHANT_SYSTEM_PROMPT = `You are a Pokémon TCG market analyst writing a short verdict for a merchant/dealer
deciding whether to promote, hold, or clear a graded card from inventory.
The promote/hold/clear decision has ALREADY been made by a separate rules engine —
your job is only to explain that decision using the numbers provided. Never
contradict the given decision or propose a different one.
Output a JSON object with exactly three top-level keys: "en", "zh_TW", and "ja".
Under each key: "verdict" (one sentence), "rationale" (2-4 lines each starting with "• "), "caveats" (0-3 short strings).
Valid JSON only — no markdown fences.`;

const SAFETY_OFF = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

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
  // Soften slightly vs the first ship: short but real sentences still pass.
  if (verdict.length < 6 || verdict.length > 320) return null;
  if (rationale.length > 900) rationale = rationale.slice(0, 900);
  if (rationale.replace(/\s+/g, '').length < 12) return null;
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

export function extractJson(text) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 503 || status === 502;
}

/**
 * Call one model once. Throws with .code = gemini_upstream | gemini_invalid_output.
 * @returns {object} validated multi-locale content
 */
async function callModelOnce(key, model, prompt) {
  const url = `${API_ROOT}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: MERCHANT_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
      safetySettings: SAFETY_OFF,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`gemini_http_${res.status}`);
    err.code = 'gemini_upstream';
    err.status = res.status;
    err.detail = `model=${model} ${body.slice(0, 300)}`;
    err.retryable = isRetryableStatus(res.status);
    // 404 model-not-found: try next model, not the same model again.
    err.modelMissing = res.status === 404;
    throw err;
  }

  const data = await res.json();
  const finishReason = data?.candidates?.[0]?.finishReason ?? null;
  const blockReason = data?.promptFeedback?.blockReason ?? null;
  const text = extractCandidateText(data);

  if (!text) {
    const err = new Error('gemini_empty_candidates');
    err.code = 'gemini_upstream';
    err.detail = `model=${model} finishReason=${finishReason} blockReason=${blockReason}`;
    err.retryable = true;
    throw err;
  }

  const parsed = extractJson(text);
  const validated = validateMerchantResponse(parsed);
  if (!validated) {
    const err = new Error('gemini_invalid_output');
    err.code = 'gemini_invalid_output';
    err.detail = `model=${model} finishReason=${finishReason} preview=${text.slice(0, 200).replace(/\s+/g, ' ')}`;
    err.retryable = true;
    throw err;
  }
  return validated;
}

export async function generateMerchantVerdict(cardMeta, merchantContext) {
  if (!isGeminiConfigured()) {
    const err = new Error('gemini_unconfigured');
    err.code = 'gemini_unconfigured';
    throw err;
  }
  const key = process.env.GEMINI_API_KEY;
  const prompt = buildMerchantPrompt(cardMeta, merchantContext);

  let lastError = null;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await callModelOnce(key, model, prompt);
      } catch (err) {
        lastError = err;
        // Wrong model name → skip to next candidate immediately.
        if (err.modelMissing) break;
        if (!err.retryable || attempt >= MAX_ATTEMPTS - 1) break;
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
      }
    }
  }

  if (lastError) throw lastError;
  const err = new Error('gemini_failed');
  err.code = 'gemini_failed';
  throw err;
}

export function pickLocaleContent(validated, locale) {
  if (!validated) return null;
  if (locale === 'zh-TW' || locale === 'zh_TW') return validated.zh_TW;
  if (locale === 'ja') return validated.ja;
  return validated.en;
}
