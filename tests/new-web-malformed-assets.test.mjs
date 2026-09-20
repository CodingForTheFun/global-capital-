import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { serveNewWeb } from '../lib/web/new-web.mjs';

const DUPLICATE = '/_next/static/chunks/static/chunks/';
const hosts = [
  'www.obligeprops.com',
  'autoprop-live-production.up.railway.app',
  'autoprop-live-production-5a2d.up.railway.app',
  'autoprop-live.railway.internal:3000',
];
const response = () => ({
  writes: 0,
  writeHead(status, headers) { this.writes++; this.status = status; this.headers = headers; },
  end(body) { this.body = body; this.ended = true; },
});
const malformed = [
  `${DUPLICATE}chunk.js`,
  `${DUPLICATE}static/chunks/chunk.js?probe=1`,
  `${DUPLICATE}chunk.css`,
  `${DUPLICATE}bad%ZZ.js`,
  '/_next/static/chunks/static%2Fchunks/chunk.js',
  '/%5Fnext/static/chunks/static/chunks/chunk.js',
  '/_next/static/chunks/%73tatic/chunks/chunk.js',
  '/_next/static/chunks/%73tatic/chunks/bad%ZZ.js',
  `/${[...DUPLICATE.slice(1)].map(c => `%${c.charCodeAt(0).toString(16)}`).join('')}chunk.js`,
];

for (const host of hosts) {
  for (const method of ['GET', 'HEAD', 'POST']) {
    test(`duplicate assets fail locally for ${method} on ${host}`, async () => {
      for (const url of malformed) {
        let fetches = 0;
        const res = response();
        const handled = await serveNewWeb({ method, url, headers: { host } }, res, {
          origin: 'https://frontend.invalid',
          fetchImpl: async () => { fetches++; throw new Error('must never proxy'); },
        });
        assert.equal(handled, true, url);
        assert.equal(fetches, 0, url);
        assert.equal(res.status, 404);
        assert.equal(res.writes, 1);
        assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
        assert.equal(res.headers['content-length'], 10);
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        assert.equal(res.headers['x-oblige-asset-guard'], 'duplicate-chunk-path');
        assert.equal(res.headers.location, undefined);
        assert.equal(res.headers['set-cookie'], undefined);
        assert.equal(res.body, method === 'HEAD' ? undefined : 'Not found.');
      }
    });
  }
}

test('guard remains local when the frontend origin is unset for recovery', async () => {
  const res = response();
  assert.equal(await serveNewWeb({ method: 'GET', url: `${DUPLICATE}chunk.js`, headers: {} }, res, { origin: '' }), true);
  assert.equal(res.status, 404);
  const page = response();
  assert.equal(await serveNewWeb({ method: 'GET', url: '/board', headers: {} }, page, { origin: '' }), false);
  assert.equal(page.writes, 0);
});

test('closed downstream does not cause writes or proxy fallback', async () => {
  for (const flag of ['destroyed', 'writableEnded']) {
    const res = response(); res[flag] = true;
    assert.equal(await serveNewWeb({ method: 'GET', url: `${DUPLICATE}x.js`, headers: {} }, res, {
      origin: 'https://frontend.invalid', fetchImpl: () => { throw new Error('must not fetch'); },
    }), true);
    assert.equal(res.writes, 0);
  }
});

test('valid assets, dynamic chunk directories, pages, image query, and PWA still proxy unchanged', async () => {
  for (const url of [
    '/_next/static/chunks/valid.js', '/_next/static/css/valid.css', '/_next/static/media/font.woff2',
    '/_next/static/chunks/app/static/chunks/page.js',
    '/_next/static/chunks/static/chunks-not-duplicated.js',
    '/_next/static/chunks/valid.js?source=/_next/static/chunks/static/chunks/x.js',
    '/_next/image?url=%2F_next%2Fstatic%2Fchunks%2Fstatic%2Fchunks%2Fx.js&w=128&q=75',
    '/board?sport=NFL', '/research?next=/_next/static/chunks/static/chunks/x.js',
    '/account', '/app.webmanifest', '/app-worker.js', '/app-icons/192.png', '/icon.svg',
  ]) {
    const res = response(); let fetches = 0;
    assert.equal(await serveNewWeb({ method: 'GET', url, headers: { host: hosts[0] } }, res, {
      origin: 'https://frontend.invalid',
      fetchImpl: async (target, init) => {
        fetches++;
        assert.equal(target, `https://frontend.invalid${url}`);
        assert.equal(init.headers.get('x-forwarded-host'), hosts[0]);
        return new Response('valid', { status: 200 });
      },
    }), true, url);
    assert.equal(fetches, 1);
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-oblige-asset-guard'], undefined);
  }
});

test('auth, recovery, webhook, health, legal and non-asset APIs stay with their existing handlers', async () => {
  for (const [method, url] of [
    ['POST', '/api/propline/webhook'], ['POST', '/api/account/login'],
    ['POST', '/api/account/signup'], ['POST', '/api/account/password-reset'],
    ['GET', '/api/account/google/callback?code=fixture'], ['GET', '/api/account/me'],
    ['GET', '/api/health'], ['GET', '/api/apex/health'], ['GET', '/api/apex/props'],
    ['POST', '/api/owner-recovery/request'], ['GET', '/owner-access'], ['GET', '/owner'],
    ['GET', '/terms'], ['GET', '/manifest.webmanifest'], ['GET', '/sw.js'],
    ['GET', `/api/example?asset=${DUPLICATE}x.js`],
  ]) {
    const res = response(); let fetches = 0;
    assert.equal(await serveNewWeb({ method, url, headers: { host: hosts[1] } }, res, {
      origin: 'https://frontend.invalid', fetchImpl: async () => { fetches++; throw new Error('must not proxy'); },
    }), false, url);
    assert.equal(res.writes, 0, url);
    assert.equal(fetches, 0, url);
  }
});

test('real local HTTP returns a complete 404 without opening an upstream connection', async t => {
  let fetches = 0;
  const server = http.createServer((req, res) => {
    serveNewWeb(req, res, {
      origin: 'https://frontend.invalid',
      fetchImpl: async () => { fetches++; throw new Error('must not proxy'); },
    }).then(handled => { if (!handled) { res.writeHead(500); res.end(); } }).catch(error => res.destroy(error));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const method of ['GET', 'HEAD']) {
    const res = await fetch(`${origin}${DUPLICATE}probe.js`, { method, signal: AbortSignal.timeout(1000) });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-oblige-asset-guard'), 'duplicate-chunk-path');
    assert.equal(await res.text(), method === 'HEAD' ? '' : 'Not found.');
  }
  assert.equal(fetches, 0);
});
