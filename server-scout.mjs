import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handlePropRoutes } from './lib/props/routes.mjs';
import { handleLiveRoutes } from './lib/live/routes.mjs';
import { bootstrapProviders } from './lib/data-sources/bootstrap.mjs';
import { providerStatus, getProvider } from './lib/data-sources/registry.mjs';
import { sportsDataIoPropBoard } from './lib/data-sources/sportsdataio/prop-board.mjs';
import { createSessionCodec, createRateLimiter, permissionsFor, parseCookies, cookieHeader, clearCookieHeader, clientKey, safeEqual, SESSION_COOKIE, OWNER, MEMBER } from './lib/session.mjs';
import { generateAccessCode, redeemAccessCode, listAccessCodes, revokeAccessCode, isAccessCodeActive } from './access-codes.mjs';
import { getPickFinderConnectionState } from './scanner/secure-store.mjs';
import { internalDetail } from './lib/safe-error.mjs';
import { readSavedProps, updateSavedProps } from './lib/autoscout/saved-props.mjs';
import { createAccountSessions, ACCOUNT_COOKIE } from './lib/auth/session.mjs';
import { accountSecret } from './lib/auth/secret.mjs';
import { resolveSession as resolveAccountSession } from './lib/auth/service.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const latestPath = path.join(dataDir, 'latest.json');
const historyPath = path.join(dataDir, 'history.json');
const port = Number(process.env.PORT || 3000);
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const dashboardSessionSecret = process.env.DASHBOARD_SESSION_SECRET || crypto.createHash('sha256').update(`scout-pro:${dashboardPassword || 'local-only'}`).digest('hex');
const authRequired = Boolean(dashboardPassword);
const verifyProviderOnBoot = ['1', 'true', 'yes'].includes(String(process.env.VERIFY_PROVIDER_ON_BOOT || '').toLowerCase());

await fs.mkdir(dataDir, { recursive: true });
bootstrapProviders();

const sessions = createSessionCodec({ secret: dashboardSessionSecret });
// Email/Google accounts are issued at the frontdoor, which this server never
// sees. Verifying that cookie here is what lets a signed-in account reach its
// own saved props instead of being told to enter an access code it never had.
const accountSessions = createAccountSessions({ secret: accountSecret() });
// The colon is deliberate: encodeSubject() strips it from legacy access-code
// subjects, so no access code can ever collide with an account's saved props.
const ACCOUNT_SUBJECT_PREFIX = 'acct:';

async function accountBridgeSession(req) {
  const token = parseCookies(req)[ACCOUNT_COOKIE];
  if (!token) return null;
  const session = accountSessions.read(token);
  if (!session.valid) return null;
  // Check the stored sessionVersion, so a password change or "sign out
  // everywhere" ends this path at the same instant it ends the others.
  const user = await resolveAccountSession({ userId: session.userId, sessionVersion: session.sessionVersion });
  if (!user) return null;
  // Always MEMBER. An account holder is a customer, never an operator: owner
  // powers stay behind the owner password alone.
  return { authenticated: true, role: MEMBER, subject: `${ACCOUNT_SUBJECT_PREFIX}${user.id}`, reason: null };
}
const rateLimiter = createRateLimiter();
const startedAt = new Date().toISOString();

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

async function authSession(req) {
  if (!authRequired) return { authenticated: true, role: OWNER, subject: OWNER };
  const session = sessions.readToken(parseCookies(req)[SESSION_COOKIE]);
  if (!session.authenticated) return (await accountBridgeSession(req)) || session;
  if (session.role === MEMBER && !(await isAccessCodeActive(session.subject))) {
    return { authenticated: false, role: null, subject: null, reason: 'code-revoked' };
  }
  return session;
}

async function isAuthorized(req) { return (await authSession(req)).authenticated; }
async function isOwner(req) { return (await authSession(req)).role === OWNER; }

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return parsed.host === host;
  } catch { return false; }
}

async function readJsonBody(req, limit = 32_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON request.'); }
}

function allowRate(req, bucket, max, windowMs) {
  return rateLimiter.allow(clientKey(req, bucket), max, windowMs);
}

function basicHealth() {
  const providers = providerStatus();
  const sports = providers.find((row) => row.id === 'sportsdataio') || null;
  return {
    ok: true,
    app: 'scout-pro',
    status: 'healthy',
    startedAt,
    database: { status: 'not-used' },
    cache: { status: 'in-process' },
    worker: { status: 'provider-native' },
    provider: sports ? { id: sports.id, status: sports.status, lastOkAt: sports.lastOkAt } : { id: 'sportsdataio', status: 'unavailable' },
  };
}

async function runtimeProviderVerification() {
  const adapter = getProvider('sportsdataio');
  if (!adapter || !adapter.isConfigured?.()) {
    console.log('[Scout Pro provider-check] SportsDataIO NOT_CONFIGURED');
    return;
  }
  console.log('[Scout Pro provider-check] SPORT | FEED | STATUS | RECORDS | LATENCY | ERROR');
  try {
    const matrix = await adapter.entitlements({ force: true });
    const rows = Array.isArray(matrix?.capabilities) ? matrix.capabilities : [];
    for (const row of rows) {
      console.log(`[Scout Pro provider-check] ${row.sport} | ${row.feed} | ${row.status ?? 0} | ${row.recordCount ?? 0} | ${row.latencyMs ?? 0}ms | ${row.errorType || row.grant || 'UNKNOWN'}`);
    }
    console.log(`[Scout Pro provider-check] configured=${Boolean(matrix?.configured)} keyRejected=${Boolean(matrix?.keyRejected)} discoveredAt=${matrix?.discoveredAt || 'unknown'}`);
  } catch (error) {
    console.log(`[Scout Pro provider-check] entitlement verification failed code=${String(error?.code || 'VERIFY_FAILED')}`);
  }

  try {
    const board = await sportsDataIoPropBoard.fetchBoard({ force: true });
    console.log(`[Scout Pro provider-check] prop-board totalOffers=${Number(board?.offers?.length || 0)} latency=${Number(board?.latencyMs || 0)}ms`);
    for (const row of board?.coverage || []) {
      console.log(`[Scout Pro provider-check] prop-board ${row.sport} | status=${row.status ?? 0} | games=${row.gamesChecked ?? 0} | offers=${row.offerCount ?? 0} | error=${row.errorType || 'OK'}`);
    }
  } catch (error) {
    console.log(`[Scout Pro provider-check] prop-board verification failed code=${String(error?.code || 'VERIFY_FAILED')}`);
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/props' || pathname === '/props/') pathname = '/props.html';
  if (pathname === '/live' || pathname === '/live/') pathname = '/live.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const file = path.join(publicDir, normalized);
  if (!file.startsWith(publicDir)) return false;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'cache-control': pathname.endsWith('.html') ? 'no-store' : 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    res.end(body);
    return true;
  } catch { return false; }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, basicHealth());

  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const session = await authSession(req);
    return json(res, 200, { required: authRequired, authenticated: session.authenticated, ...permissionsFor(session.role) });
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'unlock-burst', 8, 60_000) || !allowRate(req, 'unlock-sustained', 30, 3_600_000)) {
      return json(res, 429, { ok: false, message: 'Too many login attempts. Try again later.' });
    }
    if (!authRequired) return json(res, 200, { ok: true, authenticated: true, ...permissionsFor(OWNER) });
    try {
      const body = await readJsonBody(req, 8_000);
      const credential = String(body.password || body.accessCode || '').trim();
      if (dashboardPassword && safeEqual(credential, dashboardPassword)) {
        return json(res, 200, { ok: true, authenticated: true, ...permissionsFor(OWNER) }, { 'set-cookie': cookieHeader(req, sessions.makeToken(OWNER, OWNER)) });
      }
      const invite = await redeemAccessCode(credential);
      if (!invite) return json(res, 401, { ok: false, message: 'Incorrect owner password or access code.' });
      return json(res, 200, { ok: true, authenticated: true, ...permissionsFor(MEMBER) }, { 'set-cookie': cookieHeader(req, sessions.makeToken(MEMBER, invite.id)) });
    } catch (error) {
      console.error('[Scout Pro auth] login failed', JSON.stringify(internalDetail(error, { stage: 'login' })));
      return json(res, 400, { ok: false, message: 'Could not unlock Scout Pro.' });
    }
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookieHeader(req) });
  }

  if (url.pathname === '/api/saved-props') {
    const session = await authSession(req);
    if (!session.authenticated) return json(res, 401, { ok: false, message: 'Sign in to save props to your access profile.' });
    if (!['GET','POST','DELETE'].includes(req.method)) return json(res, 405, { ok: false, message: 'Method not allowed.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'saved-props', 90, 60_000)) return json(res, 429, { ok: false, message: 'Try again shortly.' });
    try {
      const saved = req.method === 'GET' ? await readSavedProps(session)
        : await updateSavedProps(session, await readJsonBody(req, 50_000), req.method === 'DELETE');
      return json(res, 200, { ok: true, saved, profile: { role: session.role }, persistence: 'access-profile' });
    } catch { return json(res, 400, { ok: false, message: 'Saved props could not be updated. Try again.' }); }
  }

  if (url.pathname.startsWith('/api/') && !(await isAuthorized(req))) {
    return json(res, 401, { ok: false, message: 'Scout Pro authentication required.', authRequired: true });
  }

  if (url.pathname === '/api/health/providers' && req.method === 'GET') {
    if (!(await isOwner(req))) return json(res, 403, { ok: false, message: 'Owner access is required.' });
    const adapter = getProvider('sportsdataio');
    return json(res, 200, {
      ok: true,
      providers: providerStatus(),
      propBoard: typeof adapter?.stats === 'function' ? adapter.stats() : null,
    });
  }

  if (url.pathname === '/api/providers' && url.searchParams.get('force') && !(await isOwner(req))) {
    return json(res, 403, { ok: false, message: 'Owner access is required to run provider verification.' });
  }

  if (await handlePropRoutes(req, res, url, { readLatest: () => readJson(latestPath, null), json })) return;
  if (await handleLiveRoutes(req, res, url, { readLatest: () => readJson(latestPath, null), json })) return;

  if (url.pathname === '/api/status' && req.method === 'GET') {
    const latest = await readJson(latestPath, null);
    const connection = await getPickFinderConnectionState().catch(() => ({ connected: false, sessionSaved: false }));
    return json(res, 200, {
      running: false,
      lastError: null,
      connection: { ...connection, optional: true },
      demoMode: false,
      progress: { stage: 'provider-native', message: 'SportsDataIO prop board is primary.', reviewed: 0, total: 0, qualifiedSoFar: 0 },
      latest: latest && typeof latest === 'object' ? { ...latest, logs: undefined } : null,
    });
  }

  if (url.pathname === '/api/history' && req.method === 'GET') return json(res, 200, await readJson(historyPath, []));

  if (url.pathname === '/api/access-codes' && req.method === 'GET') {
    if (!(await isOwner(req))) return json(res, 403, { ok: false, message: 'Owner access is required.' });
    return json(res, 200, { codes: await listAccessCodes() });
  }

  if (url.pathname === '/api/access-codes/generate' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!(await isOwner(req))) return json(res, 403, { ok: false, message: 'Owner access is required.' });
    if (!allowRate(req, 'generate-code', 20, 3_600_000)) return json(res, 429, { ok: false, message: 'Too many codes generated recently.' });
    try {
      const body = await readJsonBody(req, 8_000);
      const created = await generateAccessCode({ label: body.label, expiresInDays: body.expiresInDays, maxUses: body.maxUses });
      return json(res, 200, { ok: true, ...created });
    } catch (error) {
      console.error('[Scout Pro access] generate failed', JSON.stringify(internalDetail(error, { stage: 'generate-code' })));
      return json(res, 500, { ok: false, message: 'Could not generate an access code.' });
    }
  }

  if (url.pathname === '/api/access-codes/revoke' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!(await isOwner(req))) return json(res, 403, { ok: false, message: 'Owner access is required.' });
    try {
      const body = await readJsonBody(req, 8_000);
      const revoked = await revokeAccessCode(String(body.id || ''));
      if (!revoked) return json(res, 404, { ok: false, message: 'Access code not found.' });
      return json(res, 200, { ok: true, code: revoked });
    } catch {
      return json(res, 400, { ok: false, message: 'Could not revoke that access code.' });
    }
  }

  if (await serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end('Not found');
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('[Scout Pro request] unhandled failure', JSON.stringify(internalDetail(error, { stage: 'request', path: req.url })));
    if (res.headersSent) return res.destroy();
    json(res, 500, { ok: false, message: 'Scout Pro could not complete that request.' });
  });
});

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(port, () => {
  console.log(`SCOUT PRO production server listening on :${port}`);
  console.log('Primary data path: SportsDataIO provider-native prop board');
  console.log('Legacy PickFinder workflow: optional and not used for member prop access');
  if (verifyProviderOnBoot) setTimeout(() => runtimeProviderVerification().catch(() => {}), 750).unref();
});
