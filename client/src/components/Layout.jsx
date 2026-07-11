import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher.jsx';

export default function Layout({ children, user, onSignIn, onSignOut, authReady, firebaseOk }) {
  const { t } = useTranslation();

  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="brand">
          <span>{t('nav.brand')}</span>
          <span className="brand-sub">{t('nav.brandSub')}</span>
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
