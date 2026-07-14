import { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
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
import { shouldAttemptAnonSignIn, isDemoUser } from './lib/demoSession.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [authError, setAuthError] = useState(null);
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

  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      console.warn(err);
      setAuthError(err?.message || 'Sign-in failed');
    }
  }, []);

  const isDemo = isDemoUser(user);

  return (
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
  );
}
