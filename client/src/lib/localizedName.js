/**
 * Display helpers for localized card / set names.
 *
 * The server attaches `card.i18n = { name: { ja, 'zh-TW' }, setName: {...} }`
 * containing only locales with an official (served) translation. These helpers
 * read that field and fall back to the English value automatically — so they
 * are safe to call before any localization data ships (everything renders EN).
 *
 * @param {object} card  card object from an API response
 * @param {string} lng   active i18n language ('en' | 'ja' | 'zh-TW' | 'ko')
 */
export function localizedCardName(card, lng) {
  if (!card) return '';
  return card.i18n?.name?.[lng] ?? card.name ?? '';
}

export function localizedSetName(card, lng) {
  if (!card) return '';
  return card.i18n?.setName?.[lng] ?? card.set?.name ?? '';
}

/**
 * Localized name for a raw set object (from set search, where the server
 * attaches `set.i18n = { name: {...} }`). Falls back to the English `set.name`.
 *
 * @param {object} set  set object from `/api/sets` search
 * @param {string} lng  active i18n language
 */
export function localizedSetLabel(set, lng) {
  if (!set) return '';
  return set.i18n?.name?.[lng] ?? set.name ?? '';
}
