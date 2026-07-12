import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { provenanceLabel } from '../src/lib/provenance.js';

// Echo the key and its interpolation vars so assertions read as "what was asked
// of i18next", without pulling a real translator into a node --test run.
const t = (key, vars = {}) => `${key}(${JSON.stringify(vars)})`;

describe('provenanceLabel', () => {
  it('abbreviates the source wallet for a scanned row', () => {
    const label = provenanceLabel({
      addedVia: 'scan',
      sourceWallet: '0xabcdef0123456789abcdef0123456789abcdef01',
      createdAt: '2026-07-12T00:00:00.000Z',
    }, t);
    assert.match(label, /^inventory\.provenanceScan\(/);
    assert.match(label, /0xabcd…ef01/);
  });

  it('omits the wallet for cert and csv rows', () => {
    for (const addedVia of ['cert', 'csv']) {
      const label = provenanceLabel({ addedVia, createdAt: '2026-07-12T00:00:00.000Z' }, t);
      assert.match(label, new RegExp(`^inventory\\.provenance${addedVia === 'cert' ? 'Cert' : 'Csv'}\\(`));
      assert.ok(!label.includes('wallet'));
    }
  });

  it('falls back to the unknown label when only a date is known', () => {
    const label = provenanceLabel({ createdAt: '2026-07-12T00:00:00.000Z' }, t);
    assert.match(label, /^inventory\.provenanceUnknown\(/);
  });

  it('returns an empty string for a row with no provenance at all', () => {
    assert.equal(provenanceLabel({}, t), '');
    assert.equal(provenanceLabel(null, t), '');
  });
});
