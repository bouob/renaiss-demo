import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION, CERT_SHAPE, sanitizeWallet, sanitizeItem } from '../lib/inventoryItem.js';

describe('inventoryItem shared module', () => {
  it('exposes the inventory collection name', () => assert.equal(COLLECTION, 'hackathonMerchantInventory'));
  it('CERT_SHAPE accepts a PSA cert and rejects junk', () => {
    assert.ok(CERT_SHAPE.test('PSA114662766'));
    assert.ok(!CERT_SHAPE.test('../etc/passwd'));
    assert.ok(!CERT_SHAPE.test('x'.repeat(65)));
  });
  it('sanitizeWallet lowercases a valid address and rejects bad shape', () => {
    assert.equal(sanitizeWallet('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'), '0xabcdef0123456789abcdef0123456789abcdef01');
    assert.equal(sanitizeWallet('not-a-wallet'), null);
  });
  it('sanitizeItem keeps demo fields and stamps updatedAt', () => {
    const patch = sanitizeItem({ wallet: '0xabcdef0123456789abcdef0123456789abcdef01', name: 'Pikachu', setName: 'Crown Zenith', grade: '10 Gem Mint', imageUrl: 'https://example.com/x.jpg', priceUsdCents: 29531, href: '/card/pokemon/x', status: 'active' }, 'PSA114662766');
    assert.equal(patch.cert, 'PSA114662766');
    assert.equal(patch.name, 'Pikachu');
    assert.equal(patch.priceUsdCents, 29531);
    assert.equal(typeof patch.updatedAt, 'string');
  });
});
