import { useTranslation } from 'react-i18next';

/**
 * Gate a route behind Firebase sign-in.
 * - No Firebase configured (Version A) → fail open, render children.
 * - Auth not yet resolved → lightweight loading placeholder (no gate flash).
 * - Resolved + signed out → sign-in prompt card.
 * - Signed in → children.
 */
export default function RequireAuth({ user, authReady, firebaseOk, onSignIn, authError, children }) {
  const { t } = useTranslation();

  if (!firebaseOk) return children;

  if (!authReady) {
    return <div className="empty">{t('common.loading')}</div>;
  }

  if (!user) {
    return (
      <main className="stack">
        <section className="glass-card" style={{ textAlign: 'center', maxWidth: '32rem', margin: '3rem auto' }}>
          <p className="label">{t('inventory.label')}</p>
          <h1 className="h1" style={{ marginTop: '0.35rem' }}>{t('inventory.gate.title')}</h1>
          <p className="muted" style={{ marginTop: '0.5rem' }}>{t('inventory.gate.subtitle')}</p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1.25rem' }}
            onClick={onSignIn}
          >
            {t('inventory.gate.signIn')}
          </button>
          {authError && (
            <p className="small" style={{ color: 'var(--clear)', marginTop: '0.75rem' }} role="alert">
              {t('nav.signInFailed')}: {authError}
            </p>
          )}
        </section>
      </main>
    );
  }

  return children;
}
