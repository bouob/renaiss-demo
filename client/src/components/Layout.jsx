import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { linkDokipokiMentions } from '../lib/dokipokiLinks.js';

export default function Layout({ children, user, onSignIn, onSignOut, authReady, firebaseOk }) {
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
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-pulse" />
          </span>
          <div className="brand-text">
            <span className="brand-title">{t('nav.brand')}</span>
            <span className="brand-sub">
              {linkDokipokiMentions(t('nav.brandSub'), 'dokipoki-link brand-sub-link')}
            </span>
          </div>
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('nav.dashboard')}
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('nav.inventory')}
          </NavLink>
          <LanguageSwitcher />
          {authReady && firebaseOk && (
            user ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
                {user.displayName || user.email || t('nav.signOut')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={onSignIn}>
                {t('nav.signIn')}
              </button>
            )
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}
