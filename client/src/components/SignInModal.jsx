import { useTranslation } from 'react-i18next';

/**
 * Confirmation shown when a demo (anonymous) visitor taps "Sign in with
 * Google". Makes the Google hand-off explicit and warns that the demo cards
 * won't carry over. While the upgrade runs (`busy`), Continue is disabled so a
 * double-tap can't open a second popup or fire a duplicate cleanup request.
 */
export default function SignInModal({ open, busy, onConfirm, onCancel }) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="signin-modal-title" className="modal-title">{t('demo.signInModal.title')}</h2>
        <p className="modal-body">{t('demo.signInModal.body')}</p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            disabled={busy}
          >
            {t('demo.signInModal.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t('demo.signInModal.working') : t('demo.signInModal.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
