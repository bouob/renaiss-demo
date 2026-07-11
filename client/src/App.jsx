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

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  const getToken = useCallback(async () => getIdToken(), []);

  return (
    <Layout
      user={user}
      authReady={authReady}
      firebaseOk={isFirebaseConfigured}
      onSignIn={() => signInWithGoogle().catch((err) => console.warn(err))}
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
