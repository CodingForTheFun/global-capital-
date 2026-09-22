import test from 'node:test';
import assert from 'node:assert/strict';
import { serveNewWeb, ownsPath, newWebOrigin, newWebOrigins } from '../lib/web/new-web.mjs';

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

test('embedded frontend is preferred while configured external frontend remains fallback', () => {
  assert.deepEqual(
    newWebOrigins({
      OBLIGE_EMBEDDED_WEB_ORIGIN: 'http://127.0.0.1:3004/',
      OBLIGE_WEB_ORIGIN: 'https://oblige-web-production.up.railway.app/',
    }),
    ['http://127.0.0.1:3004', 'https://oblige-web-production.up.railway.app'],
  );
});

test('unreachable embedded frontend falls back to the configured external frontend', async () => {
  const r = res();
  const seen = [];
  const served = await serveNewWeb(
    { method: 'GET', url: '/board?sport=NFL', headers: { host: 'www.obligeprops.com' } },
    r,
    {
      origins: ['http://127.0.0.1:3004', 'https://fallback.example'],
      fetchImpl: async (url) => {
        seen.push(String(url));
        if (String(url).startsWith('http://127.0.0.1:3004')) throw new Error('ECONNREFUSED');
        return new Response('<html>fallback</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    },
  );
  assert.equal(served, true);
  assert.deepEqual(seen, [
    'http://127.0.0.1:3004/board?sport=NFL',
    'https://fallback.example/board?sport=NFL',
  ]);
  assert.equal(r.status, 200);
  assert.match(String(r.body), /fallback/);
});

test('claims only the pages the new front end implements plus exact legacy customer entries', () => {
  for (const p of ['/', '/board', '/scores', '/news', '/research', '/account', '/api/news', '/apex', '/apex/', '/_next/static/x.js', '/icon.svg']) {
    assert.equal(ownsPath(p), true, p);
  }
  for (const p of ['/terms', '/checkout', '/login', '/api/account/me', '/api/apex/props', '/apex-v2', '/apex/diagnostics']) {
    assert.equal(ownsPath(p), false, p);
  }
});

test('legacy Apex customer entries redirect to the rebuilt board without proxying the old shell', async () => {
  const r = res();
  let fetched = false;
  const served = await serveNewWeb(
    { method: 'GET', url: '/apex?sport=MLB', headers: { host: 'www.obligeprops.com' } },
    r,
    {
      origin: 'https://x',
      fetchImpl: async () => {
        fetched = true;
        throw new Error('legacy redirect must not call the frontend fetch');
      },
    },
  );
  assert.equal(served, true);
  assert.equal(fetched, false);
  assert.equal(r.status, 307);
  assert.equal(r.headers.location, '/board?sport=MLB');
  assert.equal(r.headers['cache-control'], 'no-store, max-age=0');
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


test('stale frontend still gets the Scores tab injected into normal HTML pages', async () => {
  const r = res();
  const served = await serveNewWeb(
    { method: 'GET', url: '/', headers: { host: 'www.obligeprops.com' } },
    r,
    {
      origin: 'https://x',
      fetchImpl: async () => new Response('<html><body><main id="main"></main><nav aria-label="Sections"><a href="/">Home</a><a href="/board">Props</a><a href="/research">Research</a><a href="/account">Profile</a></nav></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    },
  );
  assert.equal(served, true);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-oblige-scores-compat'], 'nav');
  assert.match(String(r.body), /oblige-scores-compat-script/);
  assert.match(String(r.body), /a\[href="\/scores"\]/);
  assert.match(String(r.body), /repeat\(5,minmax\(0,1fr\)\)/);
});

test('/scores falls back to the deployed home shell when the frontend route is stale', async () => {
  const r = res();
  const seen = [];
  const served = await serveNewWeb(
    { method: 'GET', url: '/scores', headers: { host: 'www.obligeprops.com' } },
    r,
    {
      origin: 'https://x',
      fetchImpl: async (u) => {
        seen.push(String(u));
        if (String(u).endsWith('/scores')) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
        return new Response('<html><body><main id="main">home</main><nav aria-label="Sections"></nav></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    },
  );
  assert.equal(served, true);
  assert.deepEqual(seen, ['https://x/scores', 'https://x/']);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-oblige-scores-compat'], 'fallback');
  assert.match(String(r.body), /oblige-scores-compat-style/);
  assert.match(String(r.body), /var fallback=true/);
  assert.match(String(r.body), /\/api\/live\?sports=NFL,NBA,SOCCER,NHL,MLB/);
});

test('frontend binary and non-HTML assets are never modified by Scores compatibility', async () => {
  const r = res();
  const served = await serveNewWeb(
    { method: 'GET', url: '/icon.svg', headers: {} },
    r,
    {
      origin: 'https://x',
      fetchImpl: async () => new Response('<svg>ok</svg>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      }),
    },
  );
  assert.equal(served, true);
  assert.equal(String(r.body), '<svg>ok</svg>');
  assert.equal(r.headers['x-oblige-scores-compat'], undefined);
});
