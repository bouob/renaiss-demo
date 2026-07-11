import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app.js';

describe('merchant Express app smoke', () => {
  /** @type {import('http').Server|null} */
  let server = null;

  after(() => {
    if (server) server.close();
  });

  it('exports a callable Express app', () => {
    assert.equal(typeof app, 'function');
    assert.equal(typeof app.handle, 'function');
  });

  it('GET /api/health returns ok', async () => {
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');
    assert.equal(json.service, 'merchantApi');
  });

  it('GET /merchant/api/health returns ok (path mount)', async () => {
    if (!server) {
      server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
    }
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/merchant/api/health`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');
  });
});
