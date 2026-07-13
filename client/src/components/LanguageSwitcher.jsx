import { useTranslation } from 'react-i18next';
import { setLocalePreference } from '../lib/localeStore.js';

const LANGS = [
  { code: 'en', labelKey: 'lang.en' },
  { code: 'zh-TW', labelKey: 'lang.zhTW' },
  { code: 'ja', labelKey: 'lang.ja' },
  { code: 'ko', labelKey: 'lang.ko' },
];

/** Compact pill switcher (Dokipoki LanguageSwitcher simplified). */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const active = i18n.resolvedLanguage || i18n.language || 'en';

  const change = (code) => {
    i18n.changeLanguage(code);
    setLocalePreference(code);
  };

  return (
    <div className="lang-switcher" role="group" aria-label={t('lang.switcherAria')}>
      {LANGS.map(({ code, labelKey }) => (
        <button
          key={code}
          type="button"
          className={`lang-pill ${active === code || active.startsWith(code) ? 'active' : ''}`}
          aria-pressed={active === code || active.startsWith(code)}
          onClick={() => change(code)}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
