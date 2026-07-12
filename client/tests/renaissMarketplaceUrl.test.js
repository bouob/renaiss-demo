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

  it('falls back to /?q={cert} so a known serial opens marketplace search', () => {
    assert.equal(
      resolveMarketplaceUrl({ cert: 'PSA41932666', name: 'Charizard' }),
      'https://www.renaiss.xyz/?q=PSA41932666',
    );
  });

  it('uses name+set when neither tokenId nor cert is known', () => {
    assert.equal(
      resolveMarketplaceUrl({ name: 'Riolu', setName: 'Sv1s Scarlet Ex' }),
      'https://www.renaiss.xyz/?q=Riolu%20Sv1s%20Scarlet%20Ex',
    );
  });

  it('returns null when nothing identifies the card', () => {
    assert.equal(resolveMarketplaceUrl({}), null);
    assert.equal(resolveMarketplaceUrl({ name: '' }), null);
    assert.equal(resolveMarketplaceUrl(null), null);
  });

  it('rejects non-digit or too-short tokenIds (do not invent a card page)', () => {
    assert.equal(
      resolveMarketplaceUrl({ tokenId: 'abc', cert: 'PSA1' }),
      'https://www.renaiss.xyz/?q=PSA1',
    );
    assert.equal(
      resolveMarketplaceUrl({ tokenId: '12345', cert: 'PSA1' }),
      'https://www.renaiss.xyz/?q=PSA1',
    );
  });
});
