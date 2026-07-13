/**
 * Daily market insight generation for the Renaiss OS Index.
 * Global market only: no user wallet state is part of this payload.
 */

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
].filter(Boolean);
const MODELS = [...new Set(MODEL_CANDIDATES)];

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [800, 2000];

const MARKET_SYSTEM_PROMPT = `You are a trading-card market analyst writing a compact daily market feed.
Use only the numbers provided. Do not invent catalysts, macro news, or causes.
Output a JSON object with exactly four top-level keys: "en", "zh_TW", "ja", and "ko".
Under each locale key, output exactly three keys: "short7d", "mid30d", and "long365d".
Each period object must contain "title" and "body".
"title" must be short (3-10 words). "body" must be 2-4 concise sentences.
Valid JSON only. No markdown fences.`;

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

function validateSection(section) {
  if (!section || typeof section !== 'object') return null;
  const title = normalizeText(section.title);
  const body = normalizeText(section.body);
  if (!title || !body) return null;
  if (title.length < 3 || title.length > 80) return null;
  if (body.length < 24 || body.length > 900) return null;
  return { title, body };
}

export function validateMarketInsightResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const localeVariants = {
    en: ['en'],
    zh_TW: ['zh_TW', 'zh-TW', 'zhTW', 'zh'],
    ja: ['ja', 'jp', 'japanese'],
    ko: ['ko', 'kr', 'korean'],
  };
  const periods = ['short7d', 'mid30d', 'long365d'];
  const out = {};
  for (const [key, aliases] of Object.entries(localeVariants)) {
    const raw = aliases
      .map((alias) => parsed[alias])
      .find((value) => value && typeof value === 'object');
    if (!raw) return null;
    const loc = {};
    for (const period of periods) {
      const valid = validateSection(raw[period]);
      if (!valid) return null;
      loc[period] = valid;
    }
    out[key] = loc;
  }
  return out;
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

function formatPct(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

export function buildMarketInsightPrompt(summary = {}) {
  return [
    'Write the daily market feed from the provided index snapshot only.',
    `Market: ${summary.label || summary.game || 'Unknown'}`,
    `Index level: ${Number.isFinite(summary.value) ? summary.value.toFixed(2) : 'n/a'}`,
    `Past 7 days: ${formatPct(summary.deltas?.d7)}`,
    `Past 30 days: ${formatPct(summary.deltas?.d30)}`,
    `Past 365 days: ${formatPct(summary.deltas?.d365)}`,
    `Constituent count: ${Number.isFinite(summary.constituentCount) ? summary.constituentCount : 'n/a'}`,
    `Updated at: ${summary.updatedAt || 'n/a'}`,
    'Return JSON with locales en, zh_TW, ja, ko. Each locale needs short7d, mid30d, long365d, each with title and body.',
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
  return status === 429 || status === 500 || status === 502 || status === 503;
}

async function callModelOnce(key, model, prompt) {
  const url = `${API_ROOT}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: MARKET_SYSTEM_PROMPT }] },
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
  const validated = validateMarketInsightResponse(parsed);
  if (!validated) {
    const err = new Error('gemini_invalid_output');
    err.code = 'gemini_invalid_output';
    err.detail = `model=${model} finishReason=${finishReason} preview=${text.slice(0, 200).replace(/\s+/g, ' ')}`;
    err.retryable = true;
    throw err;
  }
  return validated;
}

export async function generateMarketInsight(summary) {
  if (!isGeminiConfigured()) {
    const err = new Error('gemini_unconfigured');
    err.code = 'gemini_unconfigured';
    throw err;
  }
  const key = process.env.GEMINI_API_KEY;
  const prompt = buildMarketInsightPrompt(summary);

  let lastError = null;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await callModelOnce(key, model, prompt);
      } catch (err) {
        lastError = err;
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

export function pickLocaleMarketInsight(validated, locale) {
  if (!validated) return null;
  if (locale === 'zh-TW' || locale === 'zh_TW') return validated.zh_TW;
  if (locale === 'ja') return validated.ja;
  if (locale === 'ko') return validated.ko;
  return validated.en;
}
