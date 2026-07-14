import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adjacentNotice } from '../src/lib/adjacent.js';

describe('adjacentNotice', () => {
  it('renders the list (no notice) when neighbors came back', () => {
    const related = { gated: false, reason: null, neighbors: [{ cert: 'PSA1', delta: -1 }] };
    assert.equal(adjacentNotice(related), null);
  });

  it('shows nothing before the user has asked for neighbors', () => {
    assert.equal(adjacentNotice(null), null);
    assert.equal(adjacentNotice(undefined), null);
  });

  it('maps each reason the route can emit', () => {
    const cases = [
      ['not_held', 'detail.gated', true],
      ['invalid_cert', 'detail.adjacentInvalidCert', false],
      ['service_unconfigured', 'detail.adjacentUnavailable', false],
      ['rate_limited', 'detail.adjacentRateLimited', true],
      ['error', 'detail.adjacentFailed', true],
    ];
    for (const [reason, key, retryable] of cases) {
      const notice = adjacentNotice({ gated: true, reason, neighbors: [] });
      assert.deepEqual(notice, { key, retryable }, `reason=${reason}`);
    }
  });

  it('treats a gated response with NO reason as a failure, not an empty list', () => {
    // server/routes/related.js's catch-all returns `empty`, which has gated:true
    // and no `reason` key. Rendering that as "no neighbors" would blame the card
    // for a server error — and rendering nothing at all (the old behavior) left
    // the button looking dead.
    const notice = adjacentNotice({ gated: true, neighbors: [], cert: 'PSA1', card: null });
    assert.deepEqual(notice, { key: 'detail.adjacentFailed', retryable: true });
  });

  it('blames the marketplace lookup, not the card, when the enrich degraded', () => {
    // An empty list with degraded set means the tRPC enrich failed,
    // so every neighbor lost its tokenId and got filtered out. Saying "this
    // market has no adjacent cards" would be a lie the user cannot act on.
    const notice = adjacentNotice({ gated: false, reason: null, neighbors: [], degraded: true });
    assert.deepEqual(notice, { key: 'detail.adjacentFailed', retryable: true });
  });

  it('ignores degraded once at least one neighbor survived', () => {
    const notice = adjacentNotice({
      gated: false,
      reason: null,
      degraded: true,
      neighbors: [{ cert: 'PSA1', delta: -1 }],
    });
    assert.equal(notice, null, 'a partial list is still worth rendering');
  });

  it('reports a genuinely empty (ungated) result as retryable', () => {
    // Retryable because the service only caches an empty result when every
    // neighbor got a definitive answer — so a retry either hits that cache for
    // free, or re-queries an upstream that had failed transiently.
    const notice = adjacentNotice({ gated: false, reason: null, neighbors: [] });
    assert.deepEqual(notice, { key: 'detail.noNeighbors', retryable: true });
  });

  it('tolerates a missing neighbors array', () => {
    const notice = adjacentNotice({ gated: false, reason: null });
    assert.deepEqual(notice, { key: 'detail.noNeighbors', retryable: true });
  });
});
