import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarketplaceUrl } from '../src/lib/renaissMarketplaceUrl.js';

describe('resolveMarketplaceUrl', () => {
  it('prefers an exact /card/{tokenId} deep link when tokenId is present', () => {
    const tokenId = '39468560625473669737299487652232890385753731921834312021449811470109026056283';
    assert.equal(
      resolveMarketplaceUrl({ tokenId, cert: 'PSA104644162' }),
      `https://www.renaiss.xyz/card/${tokenId}`,
    );
  });

  // No ?q= search fallback: a cert the marketplace doesn't carry lands on an
  // EMPTY search page (verified against the site's own collectible.list), so
  // cert / name+set must never produce a URL — callers fall back to the
  // index.renaissos.com pricing page or render no link.
  it('returns null for a cert-only card instead of a ?q= search link', () => {
    assert.equal(resolveMarketplaceUrl({ cert: 'PSA41932666', name: 'Charizard' }), null);
  });

  it('returns null for name+set instead of a ?q= search link', () => {
    assert.equal(resolveMarketplaceUrl({ name: 'Riolu', setName: 'Sv1s Scarlet Ex' }), null);
  });

  it('returns null when nothing identifies the card', () => {
    assert.equal(resolveMarketplaceUrl({}), null);
    assert.equal(resolveMarketplaceUrl({ name: '' }), null);
    assert.equal(resolveMarketplaceUrl(null), null);
  });

  it('rejects non-digit or too-short tokenIds (do not invent a card page)', () => {
    assert.equal(resolveMarketplaceUrl({ tokenId: 'abc', cert: 'PSA1' }), null);
    assert.equal(resolveMarketplaceUrl({ tokenId: '12345', cert: 'PSA1' }), null);
  });

  it('never emits a ?q= URL for any input shape', () => {
    const inputs = [
      { cert: 'PSA161025104' },
      { name: 'Umbreon Ex', setName: 'Sv8a-Terastal Fest Ex' },
      { tokenId: 'abc', cert: 'PSA161025106', name: 'x', setName: 'y' },
    ];
    for (const input of inputs) {
      const url = resolveMarketplaceUrl(input);
      assert.ok(url === null || !url.includes('?q='), `unexpected search URL for ${JSON.stringify(input)}: ${url}`);
    }
  });
});
