import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function load(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}

const { allowedNewsImage, relayedNewsImage, relayNewsImage, NEWS_IMAGE_MAX_BYTES } = load('../lib/news-image.ts');

const PHOTO = 'https://a.espncdn.com/photo/2026/0922/r1720529_1296x729_16-9.jpg';
const request = (u) => new Request('https://www.obligeprops.com/api/news/image?u=' + encodeURIComponent(u));
const jpeg = (bytes = 1024, headers = {}) =>
  new Response(new Uint8Array(bytes).fill(0xff), { status: 200, headers: { 'content-type': 'image/jpeg', ...headers } });

test('only https URLs on the exact ESPN photo hosts are allowed', () => {
  for (const ok of [PHOTO, 'https://s.secure.espncdn.com/i/x.png', 'https://espnmedia-cdn.akamaized.net/photo/x.jpg']) {
    assert.ok(allowedNewsImage(ok), ok);
  }
  // s.espncdn.com always 301s to s.secure.espncdn.com and the relay never
  // follows redirects, so the feed's name is mapped before fetching.
  assert.equal(allowedNewsImage('https://s.espncdn.com/stitcher/x.png?templateId=1').href, 'https://s.secure.espncdn.com/stitcher/x.png?templateId=1');
  for (const bad of [
    'http://a.espncdn.com/photo/x.jpg',
    'https://a.espncdn.com.evil.test/x.jpg',
    'https://evil-espncdn.com/x.jpg',
    'https://x.a.espncdn.com/x.jpg',
    'https://secure.espncdn.com/x.jpg',
    'https://akamaized.net/x.jpg',
    'https://user:pass@a.espncdn.com/x.jpg',
    'https://a.espncdn.com:8443/x.jpg',
    'javascript:alert(1)',
    'not a url',
    '',
    null,
  ]) {
    assert.equal(allowedNewsImage(bad), null, String(bad));
  }
});

test('the news feed points cards at the same-origin relay, or at nothing', () => {
  assert.equal(relayedNewsImage(PHOTO), '/api/news/image?u=' + encodeURIComponent(PHOTO));
  assert.equal(relayedNewsImage('https://example.com/x.jpg'), null);
  assert.equal(relayedNewsImage(null), null);
});

test('a photo from an allowed host is served from this origin with locked-down headers', async () => {
  let call;
  const response = await relayNewsImage(request(PHOTO), async (url, init) => {
    call = { url, init };
    return jpeg(2048);
  });
  assert.equal(response.status, 200);
  assert.equal(call.url, PHOTO);
  assert.equal(call.init.redirect, 'manual', 'redirects are never followed');
  assert.equal(call.init.credentials, 'omit');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'");
  assert.match(response.headers.get('cache-control'), /public, max-age=86400/);
  assert.equal((await response.arrayBuffer()).byteLength, 2048);
});

test('a URL outside the allowlist is refused before anything is fetched', async () => {
  let fetched = false;
  for (const u of ['https://example.com/x.jpg', 'http://a.espncdn.com/x.jpg', 'https://169.254.169.254/latest']) {
    const response = await relayNewsImage(request(u), async () => {
      fetched = true;
      return jpeg();
    });
    assert.equal(response.status, 400, u);
  }
  assert.equal(fetched, false);
});

test('redirects, non-images, SVG and oversized bodies are refused', async () => {
  const cases = [
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://evil.test/x.jpg' } })],
    ['html', () => new Response('<script>alert(1)</script>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['svg', () => new Response('<svg onload="alert(1)"/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })],
    ['declared too large', () => jpeg(16, { 'content-length': String(NEWS_IMAGE_MAX_BYTES + 1) })],
    ['actually too large', () => jpeg(NEWS_IMAGE_MAX_BYTES + 1)],
    ['upstream 404', () => new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } })],
    ['network error', () => { throw new Error('down'); }],
  ];
  for (const [name, upstream] of cases) {
    const response = await relayNewsImage(request(PHOTO), async () => upstream());
    assert.equal(response.status, 502, name);
    assert.equal((await response.arrayBuffer()).byteLength, 0, name + ' leaks no upstream body');
  }
});

test('the route and the news feed use the relay', () => {
  const route = readFileSync(new URL('../app/api/news/image/route.ts', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../app/api/news/route.ts', import.meta.url), 'utf8');
  assert.match(route, /return relayNewsImage\(request\)/);
  assert.match(feed, /imageUrl: relayedNewsImage\(imageFrom\(row\)\)/);
});
