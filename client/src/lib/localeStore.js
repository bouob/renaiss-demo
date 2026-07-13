/**
 * Locale preference — cookie `Dokipoki_prefs.locale` when present (shared with
 * main Dokipoki), else merchant-local key. Matches Dokipoki resolution:
 * cookie only, never navigator.language.
 */

const COOKIE = 'Dokipoki_prefs';
const LOCAL_KEY = 'merchant_locale';

function readCookieObject() {
  try {
    const raw = document.cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const val = decodeURIComponent(raw.slice(COOKIE.length + 1));
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function writeCookieLocale(locale) {
  try {
    const existing = readCookieObject() || {};
    const next = { ...existing, locale };
    const encoded = encodeURIComponent(JSON.stringify(next));
    // 400 days — same ballpark as long-lived prefs
    document.cookie = `${COOKIE}=${encoded}; path=/; max-age=${60 * 60 * 24 * 400}; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

const SUPPORTED_LOCALES = new Set(['en', 'zh-TW', 'ja', 'ko']);

/** @returns {'en'|'zh-TW'|'ja'|'ko'|null} */
export function loadLocalePreference() {
  if (typeof document === 'undefined') return null;
  const fromCookie = readCookieObject()?.locale;
  if (SUPPORTED_LOCALES.has(fromCookie)) {
    return fromCookie;
  }
  try {
    const local = localStorage.getItem(LOCAL_KEY);
    if (SUPPORTED_LOCALES.has(local)) return local;
  } catch {
    /* ignore */
  }
  return null;
}

/** @param {'en'|'zh-TW'|'ja'|'ko'} locale */
export function setLocalePreference(locale) {
  if (!SUPPORTED_LOCALES.has(locale)) return;
  try {
    localStorage.setItem(LOCAL_KEY, locale);
  } catch {
    /* ignore */
  }
  writeCookieLocale(locale);
}
