import test from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeGateway } from '../lib/edge/gateway.mjs';

const CANONICAL = 'https://www.obligeprops.com';

function response() {
  return {
    statusCode: null,
    headers: null,
    ended: false,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; return this; },
    end() { this.ended = true; return this; },
  };
}

async function run({ host = 'autoprop-live-production.up.railway.app', forwardedHost, url = '/', method = 'GET' }) {
  const previous = process.env.PUBLIC_SITE_ORIGIN;
  process.env.PUBLIC_SITE_ORIGIN = CANONICAL;
  try {
    const headers = { host };
    if (forwardedHost !== undefined) headers['x-forwarded-host'] = forwardedHost;
    const req = { method, url, headers, socket: { remoteAddress: '127.0.0.1' } };
    const res = response();
    const handled = await createEdgeGateway({})(req, res);
    return { handled, res };
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_SITE_ORIGIN;
    else process.env.PUBLIC_SITE_ORIGIN = previous;
  }
}

test('retired public host in x-forwarded-host canonicalizes even when proxy rewrites Host', async () => {
  const { handled, res } = await run({
    forwardedHost: 'www.obligepay.com',
    url: '/board?sport=NFL',
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, `${CANONICAL}/board?sport=NFL`);
});

test('retired Host canonicalizes when proxy supplies an internal x-forwarded-host', async () => {
  const { handled, res } = await run({
    host: 'www.obligepay.com',
    forwardedHost: 'autoprop-live-production.up.railway.app',
    url: '/?source=retired',
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, `${CANONICAL}/?source=retired`);
});

test('bare Oblige Props Host canonicalizes when proxy supplies an internal x-forwarded-host', async () => {
  const { handled, res } = await run({
    host: 'obligeprops.com',
    forwardedHost: 'autoprop-live-production.up.railway.app',
    url: '/research?probe=1',
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, `${CANONICAL}/research?probe=1`);
});

test('retired-host API remains same-origin for cached/PWA clients behind a proxy', async () => {
  const { handled, res } = await run({
    forwardedHost: 'www.obligepay.com',
    url: '/api/account/login',
    method: 'POST',
  });
  assert.notEqual(handled, true);
  assert.equal(res.statusCode, null);
});

test('retired Host API remains same-origin when forwarded host is internal', async () => {
  const { handled, res } = await run({
    host: 'www.obligepay.com',
    forwardedHost: 'autoprop-live-production.up.railway.app',
    url: '/api/account/login',
    method: 'POST',
  });
  assert.notEqual(handled, true);
  assert.equal(res.statusCode, null);
});

test('canonical forwarded host is never redirected', async () => {
  const { handled, res } = await run({ forwardedHost: 'www.obligeprops.com', url: '/board' });
  assert.notEqual(handled, true);
  assert.equal(res.statusCode, null);
});

test('first forwarded host wins when a proxy appends a chain', async () => {
  const { handled, res } = await run({
    forwardedHost: 'obligeprops.com, autoprop-live-production.up.railway.app',
    url: '/research',
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, `${CANONICAL}/research`);
});
