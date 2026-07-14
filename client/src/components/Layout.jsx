import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import DemoBanner from './DemoBanner.jsx';
import { linkDokipokiMentions } from '../lib/dokipokiLinks.js';
import brandLogo from '../../Assets/Dokipoki.png';

export default function Layout({ children, user, onSignIn, onSignOut, authReady, firebaseOk, authError, isDemo }) {
  const { t } = useTranslation();

  return (
    <div className="app-shell">
      <div className="cyber-frame" aria-hidden="true">
        <span className="cyber-corner tl" />
        <span className="cyber-corner tr" />
        <span className="cyber-corner bl" />
        <span className="cyber-corner br" />
      </div>

      <header className="topnav">
        <div className="brand">
          <img className="brand-mark" src={brandLogo} alt={t('nav.brand')} />
          <div className="brand-text">
            <span className="brand-title">{t('nav.brand')}</span>
            <span className="brand-sub">
              {linkDokipokiMentions(t('nav.brandSub'), 'dokipoki-link brand-sub-link')}
            </span>
          </div>
        </div>
        <nav className="topnav-menu" aria-label="Primary navigation">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('nav.dashboard')}
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('nav.inventory')}
          </NavLink>
          <span className="nav-disabled-item" data-tooltip={t('nav.campaignComingSoon')}>
            <button type="button" className="nav-disabled" disabled aria-label={t('nav.campaignComingSoon')}>
              {t('nav.campaign')}
            </button>
          </span>
        </nav>
        <div className="topnav-actions">
          <LanguageSwitcher />
          {authReady && firebaseOk && (
            (user && !isDemo) ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
                {user.displayName || user.email || t('nav.signOut')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={onSignIn}>
                {isDemo ? t('demo.signIn') : t('nav.signIn')}
              </button>
            )
          )}
        </div>
      </header>
      {isDemo && <DemoBanner onSignIn={onSignIn} />}
      {authError && (
        <div className="empty" style={{ color: 'var(--clear)', marginBottom: '0.75rem' }} role="alert">
          {t('nav.signInFailed')}: {authError}
        </div>
      )}
      {children}
    </div>
  );
}
