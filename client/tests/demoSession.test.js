import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDemoUser,
  shouldAttemptAnonSignIn,
  readBannerDismissed,
  dismissBanner,
  DEMO_BANNER_KEY,
} from '../src/lib/demoSession.js';

/** Minimal in-memory Storage stand-in. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe('isDemoUser', () => {
  it('is true only for an anonymous user', () => {
    assert.equal(isDemoUser({ isAnonymous: true, uid: 'x' }), true);
    assert.equal(isDemoUser({ isAnonymous: false, uid: 'x' }), false);
    assert.equal(isDemoUser({ uid: 'x' }), false);
    assert.equal(isDemoUser(null), false);
    assert.equal(isDemoUser(undefined), false);
  });
});

describe('shouldAttemptAnonSignIn', () => {
  it('is true only when configured, signed out, and not yet attempted', () => {
    assert.equal(
      shouldAttemptAnonSignIn({ firebaseOk: true, user: null, attempted: false }),
      true,
    );
  });
  it('is false when firebase is not configured', () => {
    assert.equal(
      shouldAttemptAnonSignIn({ firebaseOk: false, user: null, attempted: false }),
      false,
    );
  });
  it('is false when a user is already present', () => {
    assert.equal(
      shouldAttemptAnonSignIn({ firebaseOk: true, user: { uid: 'x' }, attempted: false }),
      false,
    );
  });
  it('is false when already attempted (no retry loop)', () => {
    assert.equal(
      shouldAttemptAnonSignIn({ firebaseOk: true, user: null, attempted: true }),
      false,
    );
  });
});

describe('banner dismissal', () => {
  it('reads false when unset and true after dismiss', () => {
    const s = fakeStorage();
    assert.equal(readBannerDismissed(s), false);
    dismissBanner(s);
    assert.equal(readBannerDismissed(s), true);
    assert.equal(s.getItem(DEMO_BANNER_KEY), '1');
  });
  it('reads true when pre-set', () => {
    assert.equal(readBannerDismissed(fakeStorage({ demoBannerDismissed: '1' })), true);
  });
  it('is safe with null storage', () => {
    assert.equal(readBannerDismissed(null), false);
    assert.doesNotThrow(() => dismissBanner(null));
  });
  it('swallows storage errors', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.equal(readBannerDismissed(throwing), false);
    assert.doesNotThrow(() => dismissBanner(throwing));
  });
});
