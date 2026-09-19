import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const APEX = 'https://obligeprops.com';
export const WWW = 'https://www.obligeprops.com';
const ORIGINS = new Set([APEX, WWW]);
const PAGES = new Set(['/', '/board', '/research', '/account']);
const REDIRECTS = new Set([301, 302, 307, 308]);
const QUERY = '?verify=domain-routing&filter=a%2Fb&tag=one&tag=two&empty=&space=a+b&plus=a%2Bb';
const SAFE_HEADERS = ['server', 'content-type', 'cache-control', 'x-railway-request-id', 'x-railway-edge', 'service-worker-allowed'];
class ProbeError extends Error { constructor(code) { super(code); this.name = 'ProbeError'; } }
const check = (condition, code) => { if (!condition) throw new ProbeError(code); };

/** Read-only and credential-free. Only an exact, one-hop apex page redirect is followed.
 * API, auth, image and worker requests never follow a redirect. No forced DNS or TLS bypass. */
export async function readPublicRoute(origin, path, { method = 'GET', navigation = false, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  check(ORIGINS.has(origin), 'UNAPPROVED_ORIGIN');
  check(method === 'GET' || method === 'HEAD', 'READ_ONLY_METHOD_REQUIRED');
  check(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'INVALID_PATH');
  const initial = new URL(origin + path);
  check(initial.origin === origin && !initial.hash && !initial.username && !initial.password, 'INVALID_URL');
  check(!navigation || PAGES.has(initial.pathname), 'NOT_A_NAVIGATION_ROUTE');
  const chain = [];
  let current = initial.href;
  try {
    for (let hop = 0; hop < 2; hop++) {
      const response = await fetchImpl(current, {
        method, redirect: 'manual', credentials: 'omit', cache: 'no-store',
        headers: { 'user-agent': 'ObligeProps-Issue344-Acceptance', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      chain.push({ origin: new URL(current).origin, status: response.status,
        headers: Object.fromEntries(SAFE_HEADERS.map(k => [k, response.headers.get(k)]).filter(([,v]) => v !== null)) });
      if (navigation && response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        check(REDIRECTS.has(response.status) && hop === 0 && origin === APEX, 'UNEXPECTED_OR_REPEATED_REDIRECT');
        check(!response.headers.has('set-cookie'), 'REDIRECT_MUST_NOT_MINT_HOST_BOUND_COOKIES');
        const location = response.headers.get('location');
        check(Boolean(location), 'REDIRECT_LOCATION_MISSING');
        const target = new URL(location, current);
        check(target.href === WWW + initial.pathname + initial.search, 'REDIRECT_PATH_QUERY_OR_ORIGIN_CHANGED');
        current = target.href;
        continue;
      }
      const chunks = [];
      let size = 0;
      if (method !== 'HEAD' && response.body) {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          check(size <= 2 * 1024 * 1024, 'BODY_LIMIT_EXCEEDED');
          chunks.push(Buffer.from(chunk));
        }
      } else await response.body?.cancel();
      return { response, body: Buffer.concat(chunks), chain, finalOrigin: new URL(current).origin };
    }
    throw new ProbeError('REDIRECT_LIMIT_EXCEEDED');
  } catch (error) {
    error.probeChain = chain;
    throw error;
  }
}

function jsonBody(result) {
  check(/^application\/(?:json|[\w.+-]+\+json)(?:;|$)/i.test(result.response.headers.get('content-type') || ''), 'JSON_CONTENT_TYPE_REQUIRED');
  try { return JSON.parse(result.body.toString('utf8')); } catch { throw new ProbeError('INVALID_JSON'); }
}
function raster(body, type) {
  if (body.length <= 100) return false;
  if (/^image\/png(?:;|$)/i.test(type)) return body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (/^image\/jpeg(?:;|$)/i.test(type)) return body[0] === 255 && body[1] === 216 && body[2] === 255;
  return /^image\/webp(?:;|$)/i.test(type) && body.toString('ascii',0,4) === 'RIFF' && body.toString('ascii',8,12) === 'WEBP';
}
const PHOTO_PATHS = [
  ['same-origin-optimizer', '/_next/image?' + new URLSearchParams({ url: 'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png', w: '128', q: '75' })],
  ['verified-resolver', '/api/apex/player-artwork?' + new URLSearchParams({ sport: 'NFL', name: 'Patrick Mahomes' })],
];

/** Returns all results, including the healthy www baseline when apex fails.
 * HEALTHY describes public route checks, not authenticated login or deployed-SHA proof. */
export async function verifyPublicDomains({ fetchImpl = fetch, boardAttempts = 1, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  check(Number.isInteger(boardAttempts) && boardAttempts >= 1 && boardAttempts <= 12, 'INVALID_ATTEMPT_LIMIT');
  const report = { observedAt: new Date().toISOString(), expectedCommit: process.env.GITHUB_SHA || null,
    deployedCommit: null, authenticatedSession: 'UNVERIFIABLE: no existing QA credentials used',
    webhookVerification: 'Observe real Railway delivery logs; this probe never sends webhook requests',
    status: 'UNVERIFIABLE', board: null, images: [], checks: [] };
  const plans = [];
  for (const origin of ORIGINS) {
    for (const path of PAGES) for (const method of ['GET', 'HEAD']) plans.push({ origin, path: path + QUERY, method, kind: 'page', navigation: true });
    for (const path of ['/site.webmanifest', '/manifest.webmanifest', '/app.webmanifest']) plans.push({ origin, path, kind: 'manifest' });
    for (const path of ['/sw.js', '/app-worker.js']) plans.push({ origin, path, kind: 'worker' });
    plans.push({ origin, path: '/api/account/me', kind: 'me' }, { origin, path: '/api/account/google/status', kind: 'google' });
    for (const [path,status] of [['/api/apex/props',401], ['/api/oblige-workspace',401], ['/api/apex/diagnostics',403]]) plans.push({ origin, path, kind: 'protected', expectedStatus: status });
    plans.push({ origin, path: '/api/health', kind: 'health' }, { origin, path: '/login', kind: 'login' });
    for (const [kind,path] of PHOTO_PATHS) plans.push({ origin, path, kind, image: true });
  }
  async function probe(plan) {
    // The existing public-after-deploy check records resolver delivery but requires the optimizer.
    const row = { origin: plan.origin, path: plan.path, method: plan.method || 'GET', kind: plan.kind, required: plan.kind !== 'verified-resolver', ok: false, status: null, attempts: 0, chain: [] };
    const retries = plan.kind === 'page' && row.method === 'GET' && plan.path.startsWith('/board?') ? boardAttempts : 1;
    for (let attempt = 0; attempt < retries; attempt++) {
      row.attempts++;
      try {
        const result = await readPublicRoute(plan.origin, plan.path, { method: row.method, navigation: Boolean(plan.navigation), fetchImpl, timeoutMs: plan.image ? 20000 : 10000 });
        row.chain = result.chain;
        row.status = result.response.status;
        row.finalOrigin = result.finalOrigin;
        row.contentType = result.response.headers.get('content-type') || '';
        row.bytes = result.body.length;
        check(row.status === (plan.expectedStatus || (plan.kind === 'login' ? 302 : 200)), 'HTTP_' + row.status);
        if (plan.kind === 'page') {
          check(/^text\/html(?:;|$)/i.test(row.contentType), 'HTML_CONTENT_TYPE_REQUIRED');
          if (row.method === 'GET') {
            const html = result.body.toString('utf8');
            check(/<title>[^<]*Oblige Props/i.test(html), 'APPLICATION_TITLE_MISSING');
            if (plan.path.startsWith('/board?')) check(html.includes('<title>Research Terminal'), 'RESTORED_BOARD_TITLE_MISSING');
            row.restoredTitle = html.includes('<title>Research Terminal');
            row.imageCsp = result.response.headers.get('content-security-policy')?.match(/img-src[^;]*/)?.[0] || null;
          }
        } else if (plan.kind === 'manifest') {
          const manifest = jsonBody(result);
          check(String(manifest.name || '').includes('Oblige Props'), 'MANIFEST_BRAND_MISMATCH');
          const start = new URL(manifest.start_url || '/', plan.origin + plan.path);
          const scope = new URL(manifest.scope || './', plan.origin + plan.path);
          check(start.origin === plan.origin && scope.origin === plan.origin && start.pathname.startsWith(scope.pathname), 'MANIFEST_CROSS_ORIGIN_OR_SCOPE_MISMATCH');
          row.manifest = { name: manifest.name, start_url: manifest.start_url, scope: manifest.scope || './' };
        } else if (plan.kind === 'worker') {
          check(/^(?:text|application)\/javascript(?:;|$)/i.test(row.contentType), 'WORKER_JAVASCRIPT_REQUIRED');
          check(result.body.length > 20 && !result.body.toString('utf8').includes('<!DOCTYPE html>'), 'WORKER_BODY_INVALID');
          check(/no-cache|no-store|max-age=0/.test(result.response.headers.get('cache-control') || ''), 'WORKER_MUST_REVALIDATE');
        } else if (plan.kind === 'login') {
          check(result.response.headers.get('location') === '/', 'LOGIN_ROUTE_CHANGED');
        } else if (plan.image) {
          row.raster = raster(result.body, row.contentType);
          check(row.raster, 'REAL_RASTER_REQUIRED');
        } else {
          const value = jsonBody(result);
          check(/no-store/.test(result.response.headers.get('cache-control') || ''), 'AUTH_OR_API_MUST_NOT_BE_CACHED');
          if (plan.kind === 'me') check(value.authenticated === false && !value.user, 'SIGNED_OUT_CONTRACT_CHANGED');
          if (plan.kind === 'google') check(typeof value.available === 'boolean', 'GOOGLE_READINESS_CONTRACT_CHANGED');
          if (plan.kind === 'protected') check(value.ok !== true && !value.user, 'PROTECTED_API_MUST_DENY');
        }
        row.ok = true;
        delete row.error;
        break;
      } catch (error) {
        if (error.probeChain) row.chain = error.probeChain;
        row.status = row.chain.at(-1)?.status ?? null;
        // Only codes created by this module are printable, never arbitrary fetch errors.
        row.error = error instanceof ProbeError ? error.message : ['TypeError','AbortError','TimeoutError'].includes(error.name) ? error.name : 'PROBE_ERROR';
      }
      if (attempt + 1 < retries) await sleep(12000);
    }
    return row;
  }
  // Bounded concurrency and requests. No scheduled polls or provider requests are introduced.
  for (let i = 0; i < plans.length; i += 4) report.checks.push(...await Promise.all(plans.slice(i, i + 4).map(probe)));
  report.board = report.checks.find(r => r.origin === APEX && r.method === 'GET' && r.path.startsWith('/board?'));
  report.images = report.checks.filter(r => PHOTO_PATHS.some(([kind]) => r.kind === kind));
  const required = report.checks.filter(r => r.required);
  report.status = required.every(r => r.ok) ? 'HEALTHY' : required.some(r => !r.ok && r.status !== null) ? 'FAILING' : 'UNVERIFIABLE';
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await verifyPublicDomains({ boardAttempts: Number(process.env.DOMAIN_PROOF_BOARD_ATTEMPTS || 1) });
  await mkdir('artifacts/public-restored-terminal', { recursive: true });
  await writeFile('artifacts/public-restored-terminal/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, observedAt: report.observedAt, authenticatedSession: report.authenticatedSession, checks: report.checks.map(({ origin,path,method,status,ok,error,required,contentType,attempts }) => ({ origin,path,method,status,ok,error,required,contentType,attempts })) }));
  assert.equal(report.status, 'HEALTHY', 'Public apex/www routing contract is not healthy; do not hide the apex failure');
}
