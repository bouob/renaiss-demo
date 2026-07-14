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

export const DEMO_CLEANUP_KEY = 'demoCleanupPendingToken';

/** Remember an anon token whose cleanup failed, so a later load can retry it. */
export function stashPendingCleanup(storage, anonToken) {
  try {
    if (anonToken) storage?.setItem(DEMO_CLEANUP_KEY, anonToken);
  } catch {
    /* ignore — retry is best-effort */
  }
}

/** Read a pending-cleanup anon token (or null). Safe against blocked storage. */
export function readPendingCleanup(storage) {
  try {
    return storage?.getItem(DEMO_CLEANUP_KEY) || null;
  } catch {
    return null;
  }
}

/** Clear the pending-cleanup token after a successful (re)try. */
export function clearPendingCleanup(storage) {
  try {
    storage?.removeItem(DEMO_CLEANUP_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Orchestrate the demo → Google upgrade.
 *
 * Ordering is the whole point: capture the anonymous ID token FIRST (once the
 * client swaps users it is unreachable), then sign in with Google, and only
 * AFTER sign-in resolves discard the demo account. A cancelled/failed popup
 * rejects out of `signInWithGoogle` before any cleanup runs, so the demo stays
 * fully intact.
 *
 * Cleanup is best-effort: if it throws, the sign-in still stands and the anon
 * token is returned as `pendingAnonToken` so the caller can stash + retry it.
 *
 * All side effects are injected to keep this unit-testable.
 *
 * @param {object} deps
 * @param {() => Promise<string|null>} deps.getAnonToken   current anon ID token
 * @param {() => Promise<any>}         deps.signInWithGoogle Google popup sign-in
 * @param {() => Promise<string|null>} deps.getGoogleToken  new (real) ID token
 * @param {(anonToken: string, googleToken: string|null) => Promise<any>} deps.discardDemoAccount
 * @returns {Promise<{ signedIn: boolean, cleaned: boolean, pendingAnonToken: string|null, cleanupError?: unknown }>}
 */
export async function upgradeDemoToGoogle({
  getAnonToken,
  signInWithGoogle,
  getGoogleToken,
  discardDemoAccount,
}) {
  const anonToken = await getAnonToken();
  await signInWithGoogle(); // rejects on cancel → cleanup below never runs
  if (!anonToken) {
    return { signedIn: true, cleaned: false, pendingAnonToken: null };
  }
  try {
    const googleToken = await getGoogleToken();
    await discardDemoAccount(anonToken, googleToken);
    return { signedIn: true, cleaned: true, pendingAnonToken: null };
  } catch (cleanupError) {
    return { signedIn: true, cleaned: false, pendingAnonToken: anonToken, cleanupError };
  }
}
