import test from 'node:test';
import assert from 'node:assert/strict';
import { serveNewWeb, ownsPath, newWebOrigin } from '../lib/web/new-web.mjs';

const res = () => {
  const r = { written: false };
  r.writeHead = (status, headers) => { r.written = true; r.status = status; r.headers = headers; };
  r.end = (body) => { r.body = body; };
  return r;
};

test('serves nothing unless an origin is configured', async () => {
  assert.equal(newWebOrigin({}), '');
  const r = res();
  assert.equal(await serveNewWeb({ method: 'GET', url: '/', headers: {} }, r, { origin: '' }), false);
  assert.equal(r.written, false);
});

test('claims only the pages the new front end implements', () => {
  for (const p of ['/', '/board', '/research', '/account', '/_next/static/x.js', '/icon.svg']) {
    assert.equal(ownsPath(p), true, p);
  }
  for (const p of ['/terms', '/checkout', '/login', '/api/account/me', '/api/apex/props', '/apex-v2']) {
    assert.equal(ownsPath(p), false, p);
  }
});

test('an unreachable front end falls through having written nothing', async () => {
  const r = res();
  const served = await serveNewWeb(
    { method: 'GET', url: '/board', headers: { host: 'www.obligeprops.com' } },
    r,
    { origin: 'https://x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } },
  );
  assert.equal(served, false);
  assert.equal(r.written, false);
});

test('a 5xx from the front end falls through too', async () => {
  const r = res();
  const served = await serveNewWeb({ method: 'GET', url: '/', headers: {} }, r, {
    origin: 'https://x',
    fetchImpl: async () => new Response('boom', { status: 503 }),
  });
  assert.equal(served, false);
  assert.equal(r.written, false);
});

test('a good page is served through, with the real host forwarded', async () => {
  const r = res();
  let seen = null;
  const served = await serveNewWeb(
    { method: 'GET', url: '/board?sport=NFL', headers: { host: 'www.obligeprops.com' } },
    r,
    {
      origin: 'https://x',
      fetchImpl: async (u, init) => {
        seen = { u, host: init.headers.get('x-forwarded-host') };
        return new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      },
    },
  );
  assert.equal(served, true);
  assert.equal(r.status, 200);
  assert.equal(seen.u, 'https://x/board?sport=NFL');
  assert.equal(seen.host, 'www.obligeprops.com');
});

test('mutations are never claimed, so they keep hitting the real handlers', async () => {
  const r = res();
  assert.equal(await serveNewWeb({ method: 'POST', url: '/', headers: {} }, r, { origin: 'https://x' }), false);
});
