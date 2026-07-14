/**
 * Pure helpers for the default demo-account (anonymous auth) flow.
 *
 * Kept free of React/Firebase imports so it is unit-testable under
 * `node --test`. The React layer (App/Layout/DemoBanner) wires these in.
 */

export const DEMO_BANNER_KEY = 'demoBannerDismissed';

/** True iff the signed-in Firebase user is an anonymous (demo) user. */
export function isDemoUser(user) {
  return Boolean(user && user.isAnonymous === true);
}

/**
 * Whether to fire the one-shot anonymous sign-in. Called from inside the
 * resolved onAuthStateChanged callback, so `user === null` means "signed out".
 * `attempted` is a latch so a failed sign-in never loops.
 */
export function shouldAttemptAnonSignIn({ firebaseOk, user, attempted }) {
  return Boolean(firebaseOk) && !user && !attempted;
}

/** Read the banner-dismissed flag. Safe against null/blocked storage. */
export function readBannerDismissed(storage) {
  try {
    return storage?.getItem(DEMO_BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the banner-dismissed flag. Safe against null/blocked storage. */
export function dismissBanner(storage) {
  try {
    storage?.setItem(DEMO_BANNER_KEY, '1');
  } catch {
    /* ignore — dismissal is best-effort */
  }
}
