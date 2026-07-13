/**
 * i18n init — mirrors Dokipoki client/src/i18n/index.js shape:
 * en default, zh-TW, ja, ko; cookie locale preference, no navigator.language.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import { loadLocalePreference } from '../lib/localeStore.js';

const savedLocale = loadLocalePreference();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-TW': { translation: zhTW },
    ja: { translation: ja },
    ko: { translation: ko },
  },
  lng: savedLocale || 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh-TW', 'ja', 'ko'],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
