import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readBannerDismissed, dismissBanner } from '../lib/demoSession.js';

/** localStorage or null (privacy mode / non-browser). */
function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Slim banner shown while the visitor is on an anonymous demo account.
 * Dismissal is remembered in localStorage so it stays closed on revisit.
 * The parent only renders this when the user is a demo user.
 */
export default function DemoBanner({ onSignIn }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => readBannerDismissed(getStorage()));

  if (dismissed) return null;

  const handleDismiss = () => {
    dismissBanner(getStorage());
    setDismissed(true);
  };

  return (
    <div className="demo-banner" role="status">
      <div className="demo-banner-text">
        <strong className="demo-banner-title">{t('demo.bannerTitle')}</strong>
        <span className="demo-banner-sub">{t('demo.bannerSubtitle')}</span>
      </div>
      <div className="demo-banner-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onSignIn}>
          {t('demo.signIn')}
        </button>
        <button
          type="button"
          className="demo-banner-close"
          onClick={handleDismiss}
          aria-label={t('demo.dismiss')}
        >
          ×
        </button>
      </div>
    </div>
  );
}
