import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  upgradeDemoToGoogle,
  stashPendingCleanup,
  readPendingCleanup,
  clearPendingCleanup,
  DEMO_CLEANUP_KEY,
} from '../src/lib/demoSession.js';

/** Minimal in-memory Storage stand-in (with removeItem). */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

describe('upgradeDemoToGoogle — Continue path', () => {
  it('captures the anon token, signs in, then cleans up with the Google token', async () => {
    const events = [];
    let discardArgs = null;

    const result = await upgradeDemoToGoogle({
      getAnonToken: async () => { events.push('getAnon'); return 'anon-token'; },
      signInWithGoogle: async () => { events.push('signIn'); },
      getGoogleToken: async () => { events.push('getGoogle'); return 'google-token'; },
      discardDemoAccount: async (anonToken, googleToken) => {
        events.push('discard');
        discardArgs = { anonToken, googleToken };
      },
    });

    // Ordering is the contract: anon token captured BEFORE sign-in, cleanup AFTER.
    assert.deepEqual(events, ['getAnon', 'signIn', 'getGoogle', 'discard']);
    assert.deepEqual(discardArgs, { anonToken: 'anon-token', googleToken: 'google-token' });
    assert.deepEqual(result, { signedIn: true, cleaned: true, pendingAnonToken: null });
  });
});

describe('upgradeDemoToGoogle — Cancel path (demo preserved)', () => {
  it('never cleans up when the Google popup is cancelled', async () => {
    let discardCalled = false;
    const cancel = Object.assign(new Error('popup closed'), { code: 'auth/popup-closed-by-user' });

    await assert.rejects(
      upgradeDemoToGoogle({
        getAnonToken: async () => 'anon-token',
        signInWithGoogle: async () => { throw cancel; },
        getGoogleToken: async () => 'google-token',
        discardDemoAccount: async () => { discardCalled = true; },
      }),
      /popup closed/,
    );

    // Sign-in rejected → the anonymous demo account is left fully intact.
    assert.equal(discardCalled, false);
  });
});

describe('upgradeDemoToGoogle — cleanup failure', () => {
  it('keeps the sign-in and surfaces the anon token for retry', async () => {
    const result = await upgradeDemoToGoogle({
      getAnonToken: async () => 'anon-token',
      signInWithGoogle: async () => {},
      getGoogleToken: async () => 'google-token',
      discardDemoAccount: async () => { throw new Error('network'); },
    });

    assert.equal(result.signedIn, true);
    assert.equal(result.cleaned, false);
    assert.equal(result.pendingAnonToken, 'anon-token');
  });

  it('skips cleanup entirely when no anon token was available', async () => {
    let discardCalled = false;
    const result = await upgradeDemoToGoogle({
      getAnonToken: async () => null,
      signInWithGoogle: async () => {},
      getGoogleToken: async () => 'google-token',
      discardDemoAccount: async () => { discardCalled = true; },
    });
    assert.equal(discardCalled, false);
    assert.deepEqual(result, { signedIn: true, cleaned: false, pendingAnonToken: null });
  });
});

describe('pending-cleanup retry helpers', () => {
  it('round-trips a stashed anon token and clears it', () => {
    const storage = fakeStorage();
    assert.equal(readPendingCleanup(storage), null);

    stashPendingCleanup(storage, 'anon-token');
    assert.equal(storage._map.get(DEMO_CLEANUP_KEY), 'anon-token');
    assert.equal(readPendingCleanup(storage), 'anon-token');

    clearPendingCleanup(storage);
    assert.equal(readPendingCleanup(storage), null);
  });

  it('ignores empty tokens and blocked storage', () => {
    const storage = fakeStorage();
    stashPendingCleanup(storage, '');
    assert.equal(readPendingCleanup(storage), null);
    assert.doesNotThrow(() => stashPendingCleanup(null, 'x'));
    assert.equal(readPendingCleanup(null), null);
  });
});
