/**
 * Firebase web app init (Version B Auth only).
 * Uses VITE_FIREBASE_* placeholders — fails open when unset so Version A
 * Dashboard still builds and runs without Auth.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { clearRelatedCache } from './relatedCache.js';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  config.apiKey
  && !String(config.apiKey).startsWith('REPLACE_ME')
  && config.projectId
  && !String(config.projectId).startsWith('REPLACE_ME'),
);

let app = null;
let auth = null;

if (isFirebaseConfigured) {
  app = initializeApp(config);
  auth = getAuth(app);
}

export { auth, onAuthStateChanged };

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase Auth not configured');
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function signInAnonymouslyUser() {
  if (!auth) throw new Error('Firebase Auth not configured');
  return signInAnonymously(auth);
}

export async function signOutUser() {
  // Ownership-gated payloads memoized for this tab must not outlive the session
  // that was allowed to see them — the next account would be served them without
  // /related ever re-running its gate.
  clearRelatedCache();
  if (!auth) return;
  return signOut(auth);
}

export async function getIdToken() {
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}
