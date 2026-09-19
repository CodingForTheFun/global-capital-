import test from 'node:test';
import assert from 'node:assert/strict';
import { APEX, WWW, readPublicRoute, verifyPublicDomains } from '../scripts/verify-public-domain-routing.mjs';

const html = () => new Response('<title>Research Terminal · Oblige Props</title><!-- DO_NOT_LOG_BODY -->', { headers: { 'content-type': 'text/html', 'set-cookie': 'private=DO_NOT_LOG_COOKIE' } });
const redirect = (location, status = 307, extra = {}) => new Response(null, { status, headers: { location, ...extra } });
const query = '/board?filter=a%2Fb&tag=one&tag=two&empty=&space=a+b&plus=a%2Bb';

for (const status of [301,302,307,308]) test(`accept one exact apex-to-www navigation ${status}`, async () => {
  const calls = [];
  const result = await readPublicRoute(APEX, query, { navigation: true, fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.cookie, undefined);
    return calls.length === 1 ? redirect(WWW + query, status) : html();
  }});
  assert.deepEqual(calls, [APEX + query, WWW + query]);
  assert.equal(result.response.status, 200);
});

for (const target of [
  WWW, WWW + '/board', WWW + '/research' + query.slice(query.indexOf('?')),
  WWW + query.replace('a%2Fb','a/b'), WWW + query.replace('tag=one&tag=two','tag=two&tag=one'),
  WWW + query.replace('&empty=',''), WWW + query.replace('space=a+b','space=a%20b'),
  'http://www.obligeprops.com' + query, 'https://www.obligeprops.com.evil.example' + query,
  'https://user:pass@www.obligeprops.com' + query, WWW + query + '#changed',
]) test(`reject changed redirect: ${target}`, async () => {
  let calls = 0;
  await assert.rejects(readPublicRoute(APEX, query, { navigation: true, fetchImpl: async () => {
    calls++; return redirect(target);
  }}), /REDIRECT_PATH_QUERY_OR_ORIGIN_CHANGED/);
  assert.equal(calls, 1, 'must not request an unapproved or rewritten destination');
});

test('reject canonical redirects and loops', async () => {
  await assert.rejects(readPublicRoute(WWW, query, { navigation: true, fetchImpl: async () => redirect(APEX + query) }), /UNEXPECTED_OR_REPEATED_REDIRECT/);
  let calls = 0;
  await assert.rejects(readPublicRoute(APEX, query, { navigation: true, fetchImpl: async () => {
    calls++; return redirect(calls === 1 ? WWW + query : APEX + query);
  }}), /UNEXPECTED_OR_REPEATED_REDIRECT/);
  assert.equal(calls, 2);
});

test('never forward cookies minted by a hostname redirect', async () => {
  await assert.rejects(readPublicRoute(APEX, query, { navigation: true, fetchImpl: async () => redirect(WWW + query, 307, { 'set-cookie': 'sp_oauth=private' }) }), /HOST_BOUND_COOKIES/);
});

test('HEAD uses HEAD at both hops', async () => {
  const methods = [];
  const result = await readPublicRoute(APEX, query, { navigation: true, method: 'HEAD', fetchImpl: async (_url, init) => {
    methods.push(init.method); return methods.length === 1 ? redirect(WWW + query) : new Response(null, { headers: { 'content-type': 'text/html' } });
  }});
  assert.deepEqual(methods, ['HEAD', 'HEAD']);
  assert.equal(result.body.length, 0);
});

for (const path of ['/api/account/me', '/api/propline/webhook', '/app-worker.js', '/sw.js', '/app.webmanifest']) test(`do not follow non-navigation redirect ${path}`, async () => {
  let calls = 0;
  const result = await readPublicRoute(APEX, path, { fetchImpl: async () => { calls++; return redirect(WWW + path); } });
  assert.equal(result.response.status, 307);
  assert.equal(calls, 1);
  await assert.rejects(readPublicRoute(APEX, path, { navigation: true, fetchImpl: async () => { throw new Error('must not fetch'); } }), /NOT_A_NAVIGATION_ROUTE/);
});

test('reject non-read-only methods, foreign hosts and oversized bodies', async () => {
  const never = async () => { throw new Error('must not fetch'); };
  await assert.rejects(readPublicRoute(APEX, '/board', { method: 'POST', fetchImpl: never }), /READ_ONLY_METHOD_REQUIRED/);
  await assert.rejects(readPublicRoute('https://evil.example', '/board', { fetchImpl: never }), /UNAPPROVED_ORIGIN/);
  await assert.rejects(readPublicRoute(APEX, '//evil.example', { fetchImpl: never }), /INVALID_PATH/);
  await assert.rejects(readPublicRoute(APEX, '/board', { fetchImpl: async () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1)) }), /BODY_LIMIT_EXCEEDED/);
});

const json = (value, status = 200, type = 'application/json') => new Response(JSON.stringify(value), { status, headers: { 'content-type': type, 'cache-control': 'no-store' } });
function healthy(url, init = {}) {
  const { pathname } = new URL(url);
  if (init.method === 'HEAD') return new Response(null, { headers: { 'content-type': 'text/html' } });
  if (pathname.endsWith('.webmanifest')) return json({ name: 'Oblige Props', start_url: '/board', scope: '/' }, 200, 'application/manifest+json');
  if (pathname === '/sw.js' || pathname === '/app-worker.js') return new Response('self.addEventListener("fetch", () => {});', { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' } });
  if (pathname === '/api/account/me') return json({ authenticated: false, user: null });
  if (pathname === '/api/account/google/status') return json({ ok: true, available: true });
  if (pathname === '/api/apex/props' || pathname === '/api/oblige-workspace') return json({ ok: false, code: 'AUTH_REQUIRED' }, 401);
  if (pathname === '/api/apex/diagnostics') return json({ ok: false }, 403);
  if (pathname === '/api/health') return json({ ok: true });
  if (pathname === '/login') return redirect('/', 302);
  if (pathname === '/_next/image' || pathname === '/api/apex/player-artwork') return new Response(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(120)]), { headers: { 'content-type': 'image/png' } });
  return html();
}

test('complete direct contract succeeds without claiming authenticated QA or exposing bodies/cookies', async () => {
  const calls = [];
  const report = await verifyPublicDomains({ fetchImpl: async (url, init) => { calls.push(url); return healthy(url, init); } });
  assert.equal(report.status, 'HEALTHY');
  assert.equal(report.checks.length, 44);
  assert.match(report.authenticatedSession, /UNVERIFIABLE/);
  assert.equal(report.deployedCommit, null);
  assert.equal(JSON.stringify(report).includes('DO_NOT_LOG'), false);
  assert.equal(calls.some(url => url.includes('/webhook')), false);
  assert.equal(calls.some(url => url.includes('/google/start') || url.includes('/google/callback')), false);
});

test('all canonical evidence is collected when apex returns pre-service 404', async () => {
  const report = await verifyPublicDomains({ fetchImpl: async (url, init) => url.startsWith(APEX) ? new Response('Not Found', { status: 404 }) : healthy(url, init) });
  assert.equal(report.status, 'FAILING');
  assert.equal(report.board.status, 404);
  assert.ok(report.checks.filter(r => r.origin === WWW).every(r => r.ok));
});

test('blanket API and worker redirects fail even when every page redirect is correct', async () => {
  const report = await verifyPublicDomains({ fetchImpl: async (url, init) => url.startsWith(APEX) ? redirect(url.replace(APEX, WWW)) : healthy(url, init) });
  assert.equal(report.status, 'FAILING');
  assert.ok(report.checks.filter(r => r.kind === 'page').every(r => r.ok));
  assert.ok(report.checks.filter(r => r.origin === APEX && ['protected','worker','me'].includes(r.kind)).every(r => !r.ok && r.status === 307));
});

test('network errors are unverifiable and do not leak error text', async () => {
  const report = await verifyPublicDomains({ fetchImpl: async () => { throw new TypeError('DO_NOT_LOG_SECRET'); } });
  assert.equal(report.status, 'UNVERIFIABLE');
  assert.equal(JSON.stringify(report).includes('DO_NOT_LOG_SECRET'), false);
});

test('only board GET gets the explicitly bounded retry', async () => {
  let boardCalls = 0, sleeps = 0;
  const report = await verifyPublicDomains({ boardAttempts: 2, sleep: async () => { sleeps++; }, fetchImpl: async (url, init) => {
    if (url.startsWith(APEX + '/board?') && init.method === 'GET' && ++boardCalls === 1) return new Response('busy', { status: 503 });
    return healthy(url, init);
  }});
  assert.equal(report.status, 'HEALTHY');
  assert.equal(report.board.attempts, 2);
  assert.equal(sleeps, 1);
  await assert.rejects(verifyPublicDomains({ boardAttempts: 13 }), /INVALID_ATTEMPT_LIMIT/);
});
