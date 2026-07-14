import { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import SignInModal from './components/SignInModal.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import {
  auth,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithGoogle,
  signOutUser,
  getIdToken,
  signInAnonymouslyUser,
} from './lib/firebase.js';
import {
  shouldAttemptAnonSignIn,
  isDemoUser,
  upgradeDemoToGoogle,
  stashPendingCleanup,
  readPendingCleanup,
  clearPendingCleanup,
} from './lib/demoSession.js';
import { discardDemoAccount } from './lib/inventoryApi.js';

/** localStorage or null (privacy mode / non-browser). */
function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Popup dismissals aren't real errors — don't surface them to the user.
const POPUP_CANCEL_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [authError, setAuthError] = useState(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const anonAttemptedRef = useRef(false);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    return onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        setAuthReady(true);
        setAuthError(null);
      } else if (shouldAttemptAnonSignIn({
        firebaseOk: isFirebaseConfigured,
        user: u,
        attempted: anonAttemptedRef.current,
      })) {
        anonAttemptedRef.current = true;
        // Keep authReady false while the anonymous sign-in is in flight so
        // RequireAuth shows its lightweight loading placeholder instead of
        // briefly flashing the sign-in gate before the demo user resolves.
        signInAnonymouslyUser().catch((err) => {
          // Provider disabled or offline → stay signed out, fall back to the
          // existing sign-in gate. Never retry (latch above) to avoid loops.
          console.warn('[demo] anonymous sign-in failed:', err?.message ?? err);
          setUser(null);
          setAuthReady(true);
        });
      } else {
        // Not attempting anon sign-in: Firebase not configured, or already
        // attempted (e.g. after an explicit sign-out, the visitor sees the
        // normal signed-out gate until reload — the latch intentionally does
        // not re-arm).
        setUser(u);
        setAuthReady(true);
      }
    });
  }, []);

  const getToken = useCallback(async () => getIdToken(), []);

  // Retry a demo-cleanup that failed after a prior sign-in. Runs once a real
  // (non-anonymous) user is present; the anon token was stashed at the time.
  useEffect(() => {
    if (!authReady || !user || user.isAnonymous) return;
    const storage = getStorage();
    const pending = readPendingCleanup(storage);
    if (!pending) return;
    (async () => {
      try {
        const googleToken = await getIdToken();
        await discardDemoAccount(pending, { authToken: googleToken });
        clearPendingCleanup(storage);
      } catch (err) {
        // Leave it stashed for the next attempt (token may have simply expired).
        console.warn('[demo] deferred cleanup retry failed:', err?.message ?? err);
      }
    })();
  }, [authReady, user]);

  // Plain Google sign-in for the signed-out gate (no demo account to discard).
  const handleGateSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (!POPUP_CANCEL_CODES.has(err?.code)) {
        console.warn(err);
        setAuthError(err?.message || 'Sign-in failed');
      }
    }
  }, []);

  // From the demo CTA: confirm via modal first, then upgrade + discard.
  const handleSignIn = useCallback(() => {
    if (auth?.currentUser?.isAnonymous) {
      setShowSignInModal(true);
    } else {
      handleGateSignIn();
    }
  }, [handleGateSignIn]);

  const confirmSignIn = useCallback(async () => {
    if (signingIn) return; // guard against a double-tap opening a second popup
    setSigningIn(true);
    setAuthError(null);
    try {
      const result = await upgradeDemoToGoogle({
        getAnonToken: () => (auth?.currentUser?.getIdToken() ?? Promise.resolve(null)),
        signInWithGoogle,
        getGoogleToken: getIdToken,
        discardDemoAccount: (anonToken, googleToken) => (
          discardDemoAccount(anonToken, { authToken: googleToken })
        ),
      });
      const storage = getStorage();
      if (result.pendingAnonToken) {
        // Sign-in stuck; keep the token so the load-time effect can retry.
        stashPendingCleanup(storage, result.pendingAnonToken);
        console.warn('[demo] cleanup deferred:', result.cleanupError?.message ?? result.cleanupError);
      } else {
        clearPendingCleanup(storage);
      }
      setShowSignInModal(false);
    } catch (err) {
      // Sign-in itself failed/cancelled → demo left intact, modal stays open.
      if (!POPUP_CANCEL_CODES.has(err?.code)) {
        console.warn(err);
        setAuthError(err?.message || 'Sign-in failed');
      }
      setShowSignInModal(false);
    } finally {
      setSigningIn(false);
    }
  }, [signingIn]);

  const cancelSignIn = useCallback(() => {
    if (signingIn) return;
    setShowSignInModal(false);
  }, [signingIn]);

  const isDemo = isDemoUser(user);

  return (
    <>
      <Layout
        user={user}
        authReady={authReady}
        firebaseOk={isFirebaseConfigured}
        authError={authError}
        isDemo={isDemo}
        onSignIn={handleSignIn}
        onSignOut={() => signOutUser()}
      >
        <Routes>
          <Route path="/" element={<Dashboard user={user} getToken={getToken} />} />
          <Route
            path="/inventory"
            element={(
              <RequireAuth
                user={user}
                authReady={authReady}
                firebaseOk={isFirebaseConfigured}
                onSignIn={handleSignIn}
                authError={authError}
              >
                <Inventory
                  user={user}
                  getToken={getToken}
                  firebaseOk={isFirebaseConfigured}
                />
              </RequireAuth>
            )}
          />
        </Routes>
      </Layout>
      <SignInModal
        open={showSignInModal}
        busy={signingIn}
        onConfirm={confirmSignIn}
        onCancel={cancelSignIn}
      />
    </>
  );
}
