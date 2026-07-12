import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCert, adjacentCerts } from '../services/renaissCertAdjacency.js';

describe('parseCert', () => {
  it('splits a cert into grader and serial, keeping the serial as a string', () => {
    assert.deepEqual(parseCert('PSA41932666'), { grader: 'PSA', serialStr: '41932666' });
    assert.deepEqual(parseCert('CGC6106213036'), { grader: 'CGC', serialStr: '6106213036' });
  });

  it('preserves BGS leading zeros instead of coercing to a number', () => {
    // The whole reason the serial is a string: Number('0017724927') would drop
    // the padding and every neighbor computed from it would be a wrong cert.
    assert.deepEqual(parseCert('BGS0017724927'), { grader: 'BGS', serialStr: '0017724927' });
  });

  it('uppercases the grader prefix', () => {
    assert.deepEqual(parseCert('psa41932666'), { grader: 'PSA', serialStr: '41932666' });
  });

  it('rejects unknown graders and malformed certs', () => {
    for (const bad of ['SGC1234', 'PSA', '41932666', 'PSA-123', 'PSAXX123', 'PSA 123', '']) {
      assert.equal(parseCert(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  it('rejects non-string input', () => {
    for (const bad of [null, undefined, 41932666, {}, ['PSA1']]) {
      assert.equal(parseCert(bad), null);
    }
  });
});

describe('adjacentCerts', () => {
  it('returns the -1 and +1 neighbors, ascending by delta', () => {
    assert.deepEqual(adjacentCerts('PSA41932666'), [
      { delta: -1, cert: 'PSA41932665' },
      { delta: 1, cert: 'PSA41932667' },
    ]);
  });

  it('keeps the serial width when the neighbor has leading zeros (BGS regression)', () => {
    // If someone "simplifies" the padStart away, this is the test that fails:
    // 0017724927 - 1 must be BGS0017724926, not BGS17724926 (a different card).
    const neighbors = adjacentCerts('BGS0017724927');
    assert.deepEqual(neighbors, [
      { delta: -1, cert: 'BGS0017724926' },
      { delta: 1, cert: 'BGS0017724928' },
    ]);
    for (const n of neighbors) assert.equal(n.cert.length, 'BGS0017724927'.length);
  });

  it('skips a neighbor that would overflow the serial width', () => {
    // 99999999 + 1 needs a 9th digit — that is not the same 8-digit format, and
    // guessing would query an unrelated real cert.
    assert.deepEqual(adjacentCerts('PSA99999999'), [{ delta: -1, cert: 'PSA99999998' }]);
  });

  it('skips a neighbor that would go negative, and re-pads the survivor', () => {
    assert.deepEqual(adjacentCerts('PSA0'), [{ delta: 1, cert: 'PSA1' }]);
    assert.deepEqual(adjacentCerts('PSA00'), [{ delta: 1, cert: 'PSA01' }]);
  });

  it('refuses a serial too large to increment exactly', () => {
    // The regex allows 20 digits; past MAX_SAFE_INTEGER, serialNum + 1 rounds and
    // would emit a cert that is not the neighbor. Better to return nothing.
    assert.deepEqual(adjacentCerts('PSA9007199254740993'), []);
  });

  it('honors span and rejects a non-positive or non-finite one', () => {
    assert.deepEqual(adjacentCerts('PSA100', 2).map((n) => n.delta), [-2, -1, 1, 2]);
    assert.equal(adjacentCerts('PSA100', 1.9).length, 2); // truncated to 1
    for (const bad of [0, -1, NaN, Infinity]) {
      assert.deepEqual(adjacentCerts('PSA100', bad), []);
    }
  });

  it('returns nothing for an unparseable cert', () => {
    assert.deepEqual(adjacentCerts('SGC1234'), []);
    assert.deepEqual(adjacentCerts(null), []);
  });
});
