import { useEffect, useState, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import {
  auth,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithGoogle,
  signOutUser,
  getIdToken,
} from './lib/firebase.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) setAuthError(null);
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

  return (
    <Layout
      user={user}
      authReady={authReady}
      firebaseOk={isFirebaseConfigured}
      authError={authError}
      onSignIn={handleSignIn}
      onSignOut={() => signOutUser()}
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/inventory"
          element={(
            <Inventory
              user={user}
              getToken={getToken}
              firebaseOk={isFirebaseConfigured}
            />
          )}
        />
      </Routes>
    </Layout>
  );
}
