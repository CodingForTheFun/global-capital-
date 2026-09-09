import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from './scanner/index.mjs';
import { getPickFinderConnectionState } from './scanner/secure-store.mjs';
import { verifyAndSavePickFinderConnection } from './scanner/auth-preflight.mjs';
import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from './scanner/rules.mjs';
import { safeError, publicError, publicMessageFor, internalDetail, publicErrorFromRecord, PUBLIC_MESSAGES, GENERIC_MESSAGE } from './lib/safe-error.mjs';
import { handlePropRoutes } from './lib/props/routes.mjs';
import { bootstrapProviders } from './lib/data-sources/bootstrap.mjs';
import { createRateLimiter, clientKey, permissionsFor, OWNER } from './lib/session.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const latestPath = path.join(dataDir, 'latest.json');
const historyPath = path.join(dataDir, 'history.json');
const rulesPath = path.join(dataDir, 'rules.json');
const lastErrorPath = path.join(dataDir, 'last-error.json');
const quarantineDir = path.join(dataDir, 'quarantine');
const port = Number(process.env.PORT || 3000);
const intervalMinutes = Math.max(0, Number(process.env.AUTO_SCAN_MINUTES || 30));
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const dashboardSessionSecret = process.env.DASHBOARD_SESSION_SECRET || crypto.createHash('sha256').update(`autoprop:${dashboardPassword || 'local-only'}`).digest('hex');
const authRequired = Boolean(dashboardPassword);

await fs.mkdir(dataDir, { recursive: true });

// Register data providers once. Never throws; an unconfigured provider simply
// reports as not connected and props run un-enriched.
bootstrapProviders();

let running = false;
let lastError = null;
let scanProgress = { stage: 'idle', message: 'Ready', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: null, updatedAt: new Date().toISOString() };

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function validDate(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : 0;
}

function scanOutputIssues(result) {
  const issues = [];
  if (!result || typeof result !== 'object') return ['Scanner returned no result object'];
  if (result.mode !== 'live') issues.push('Result mode is not live');
  if (!/full-detail browser scan v2/i.test(String(result.source || ''))) issues.push('Result is not from the calibrated v2 full-detail scanner');
  if (!Array.isArray(result.picks)) issues.push('Result picks are missing');
  if (!Number.isFinite(Number(result.totalReviewed))) issues.push('Reviewed count is invalid');

  for (const pick of Array.isArray(result.picks) ? result.picks : []) {
    const player = String(pick?.player || '').trim();
    const sport = String(pick?.sport || '').trim().toUpperCase();
    if (!player || /^(pickfinder|unknown player)$/i.test(player)) issues.push(`Placeholder player name: ${player || 'blank'}`);
    if (!sport || sport === 'UNKNOWN') issues.push(`Unknown sport for ${player || 'candidate'}`);
    if (!/\/players\//i.test(String(pick?.sourceUrl || ''))) issues.push(`Missing detail URL for ${player || 'candidate'}`);
    if (pick?.qualified) {
      if (pick.detailPageVerified !== true) issues.push(`Qualified pick without verified detail page: ${player}`);
      if (pick.prizePicksConfirmed !== true) issues.push(`Qualified pick without PrizePicks confirmation: ${player}`);
      if (pick.regularLine !== true) issues.push(`Qualified non-regular line: ${player}`);
      if (pick.isToday !== true) issues.push(`Qualified pick outside today: ${player}`);
      if (!['OVER', 'UNDER'].includes(String(pick.pick || '').toUpperCase())) issues.push(`Qualified pick without direction: ${player}`);
      if (!Number.isFinite(Number(pick.line))) issues.push(`Qualified pick without numeric line: ${player}`);
    }
  }
  return [...new Set(issues)].slice(0, 30);
}

function scanOutputValid(result) {
  return scanOutputIssues(result).length === 0;
}

async function quarantineFile(file, label) {
  try {
    await fs.access(file);
    await fs.mkdir(quarantineDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.rename(file, path.join(quarantineDir, `${stamp}-${label}`));
  } catch {}
}

async function quarantineLegacyBadData() {
  const legacy = await readJson(latestPath, null);
  if (legacy && !scanOutputValid(legacy)) {
    console.warn('[AutoProp] Quarantining legacy invalid scan output');
    await quarantineFile(latestPath, 'latest-invalid.json');
    await quarantineFile(historyPath, 'history-pre-v2.json');
  }
}

await quarantineLegacyBadData();

async function loadRules() {
  return normalizeRules((await readJson(rulesPath, null)) || DEFAULT_RULES);
}

async function saveRules(value) {
  const normalized = normalizeRules(value);
  await atomicJson(rulesPath, normalized);
  return normalized;
}

async function saveResult(result) {
  const issues = scanOutputIssues(result);
  if (issues.length) {
    console.error('[AutoProp] scan output rejected by quality gate', JSON.stringify(issues.slice(0, 30)));
    throw safeError('SCAN_OUTPUT_INVALID', PUBLIC_MESSAGES.SCAN_OUTPUT_INVALID, { issues });
  }
  await atomicJson(latestPath, result);
  const history = await readJson(historyPath, []);
  history.unshift({
    scannedAt: result.scannedAt,
    mode: result.mode,
    source: result.source,
    totalReviewed: result.totalReviewed,
    qualifiedCount: result.qualifiedCount,
    rejectedCount: result.rejectedCount,
    bestAvailableCount: result.bestAvailable?.length || 0,
    bestConfidence: Math.max(0, ...(result.picks || []).filter((p) => p.qualified).map((p) => Number(p.confidence) || 0)),
    rulesApplied: result.rulesApplied || null,
  });
  await atomicJson(historyPath, history.slice(0, 100));
}

function updateProgress(next) {
  scanProgress = { ...scanProgress, ...next, updatedAt: new Date().toISOString() };
}

// Allowlist gate: only AutoProp-authored copy reaches the dashboard.
function friendlyScanError(error) {
  return publicMessageFor(error, GENERIC_MESSAGE);
}

// Scanner logs name selectors and page state; drop them at the API boundary.
function publicScanResult(result) {
  if (!result || typeof result !== 'object') return result;
  const { logs, ...rest } = result;
  return rest;
}

const rateLimiter = createRateLimiter();
const allowRate = (req, bucket, max, windowMs) => rateLimiter.allow(clientKey(req, bucket), max, windowMs);

async function scanNow() {
  if (running) return { ok: false, message: 'A scan is already running.' };
  running = true;
  lastError = null;
  updateProgress({ stage: 'starting', message: 'Starting authenticated scan', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: new Date().toISOString() });
  try {
    const rules = await loadRules();
    const result = await runScan({ onProgress: updateProgress, rules });
    await saveResult(result);
    await fs.rm(lastErrorPath, { force: true }).catch(() => {});
    updateProgress({
      stage: 'complete',
      message: result.qualifiedCount ? `Scan complete — ${result.qualifiedCount} qualified` : `Scan complete — ${result.bestAvailable?.length || 0} Best Available`,
      reviewed: result.totalReviewed,
      total: result.totalReviewed,
      currentPlayer: null,
      qualifiedSoFar: result.qualifiedCount,
    });
    return { ok: true, result };
  } catch (error) {
    const surfaced = publicError(error, GENERIC_MESSAGE);
    lastError = surfaced.message;
    const diagnostic = { ...internalDetail(error, { stage: 'scan' }), publicMessage: surfaced.message };
    console.error('[AutoProp scan error]', diagnostic.stack || diagnostic.rawMessage);
    await atomicJson(lastErrorPath, diagnostic).catch(() => {});
    updateProgress({ stage: 'error', message: lastError, reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0 });
    return { ok: false, message: lastError, code: surfaced.code };
  } finally {
    running = false;
  }
}

function safeFailureLatest(errorInfo) {
  if (!errorInfo) return null;
  return {
    mode: 'live',
    scannedAt: errorInfo.at || new Date().toISOString(),
    source: 'AutoProp safety gate',
    totalReviewed: 0,
    qualifiedCount: 0,
    rejectedCount: 0,
    picks: [],
    bestAvailable: [],
    diversifiedCard: [],
    warnings: [publicErrorFromRecord(errorInfo, GENERIC_MESSAGE).message || GENERIC_MESSAGE],
    dataSuppressed: true,
  };
}

async function publicStatusPayload() {
  const storedLatest = await readJson(latestPath, null);
  const errorInfo = await readJson(lastErrorPath, null);
  const connection = await getPickFinderConnectionState();
  const rules = await loadRules();
  const errorIsNewer = Boolean(errorInfo && validDate(errorInfo.at) >= validDate(storedLatest?.scannedAt));
  const latestIsValid = storedLatest ? scanOutputValid(storedLatest) : false;
  const suppress = errorIsNewer || (storedLatest && !latestIsValid);
  const surfaced = errorInfo ? publicErrorFromRecord(errorInfo, GENERIC_MESSAGE).message : lastError;
  const authFailure = Boolean(errorInfo && /^PICKFINDER_/.test(String(errorInfo.code || '')));
  const publicConnection = authFailure ? { ...connection, sessionSaved: false, connectionError: surfaced } : connection;

  return {
    running,
    lastError: surfaced,
    lastErrorCode: errorInfo?.code || null,
    connection: publicConnection,
    rules,
    dataQuality: {
      ok: !suppress && Boolean(storedLatest),
      staleSuppressed: suppress,
      reason: suppress ? (surfaced || PUBLIC_MESSAGES.SCAN_OUTPUT_INVALID) : null,
    },
    demoMode: false,
    autoScanMinutes: intervalMinutes,
    payoutMultiplier: process.env.PAYOUT_MULTIPLIER || null,
    progress: scanProgress,
    latest: suppress ? safeFailureLatest(errorInfo || { code: 'SCAN_OUTPUT_INVALID', at: new Date().toISOString() }) : publicScanResult(storedLatest),
  };
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

function parseCookies(req) {
  const pairs = String(req.headers.cookie || '').split(';');
  const cookies = {};
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function makeAuthToken() {
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = `owner.${expires}`;
  const signature = crypto.createHmac('sha256', dashboardSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function authTokenValid(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'owner') return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', dashboardSessionSecret).update(payload).digest('base64url');
  return safeEqual(parts[2], expected);
}

function isAuthorized(req) {
  return !authRequired || authTokenValid(parseCookies(req).aps_session);
}

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

function cookieHeader(req, token) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `aps_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`;
}

function clearCookieHeader(req) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `aps_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index.html';
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

  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const authenticated = isAuthorized(req);
    // This server models a single owner identity; say so explicitly so the
    // dashboard renders owner controls instead of guessing from a bare flag.
    return json(res, 200, { required: authRequired, authenticated, ...permissionsFor(authenticated ? OWNER : null) });
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'unlock-burst', 8, 60 * 1000) || !allowRate(req, 'unlock-sustained', 30, 60 * 60 * 1000)) return json(res, 429, { ok: false, message: PUBLIC_MESSAGES.RATE_LIMITED });
    if (!authRequired) return json(res, 200, { ok: true, authenticated: true });
    try {
      const body = await readJsonBody(req, 8_000);
      if (!safeEqual(body.password || '', dashboardPassword)) return json(res, 401, { ok: false, message: 'Incorrect dashboard password.' });
      return json(res, 200, { ok: true, authenticated: true }, { 'set-cookie': cookieHeader(req, makeAuthToken()) });
    } catch (error) {
      console.error('[AutoProp auth] unlock failed', JSON.stringify(internalDetail(error, { stage: 'login' })));
      return json(res, 400, { ok: false, message: PUBLIC_MESSAGES.REQUEST_INVALID });
    }
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookieHeader(req) });
  }

  if (url.pathname.startsWith('/api/') && !isAuthorized(req)) {
    return json(res, 401, { ok: false, message: 'Dashboard authentication required.', authRequired: true });
  }

  // ALL PROPS / Auto Prop Finder / prop detail / provider status.
  // Behind the auth gate above, so provider-backed data is never public.
  if (await handlePropRoutes(req, res, url, { readLatest: () => readJson(latestPath, null), json })) return;

  if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, await publicStatusPayload());
  if (url.pathname === '/api/history' && req.method === 'GET') return json(res, 200, await readJson(historyPath, []));

  if (url.pathname === '/api/rules' && req.method === 'GET') {
    return json(res, 200, { rules: await loadRules(), presets: RULE_PRESETS, locked: { prizePicksOnly: true, regularLinesOnly: true, todayOnly: true } });
  }

  if (url.pathname === '/api/rules' && req.method === 'PUT') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before changing rules.' });
    try {
      const body = await readJsonBody(req, 16_000);
      return json(res, 200, { ok: true, rules: await saveRules(body.rules || body), locked: { prizePicksOnly: true, regularLinesOnly: true, todayOnly: true } });
    } catch (error) {
      console.error('[AutoProp rules] save failed', JSON.stringify(internalDetail(error, { stage: 'save-rules' })));
      return json(res, 400, { ok: false, message: PUBLIC_MESSAGES.REQUEST_INVALID });
    }
  }

  if (url.pathname === '/api/connect' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'pickfinder-connect', 6, 10 * 60 * 1000)) return json(res, 429, { ok: false, message: PUBLIC_MESSAGES.RATE_LIMITED });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before changing the PickFinder connection.' });
    try {
      const body = await readJsonBody(req, 16_000);
      const result = await verifyAndSavePickFinderConnection({ email: body.email, password: body.password });
      await fs.rm(lastErrorPath, { force: true }).catch(() => {});
      lastError = null;
      return json(res, 200, { ok: true, connection: result });
    } catch (error) {
      return json(res, 400, { ok: false, message: friendlyScanError(error), code: error?.code || null });
    }
  }

  if (url.pathname === '/api/disconnect' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before disconnecting.' });
    try {
      const { disconnectPickFinder } = await import('./scanner/pickfinder-v2.mjs');
      await quarantineFile(latestPath, 'latest-on-disconnect.json');
      return json(res, 200, { ok: true, connection: await disconnectPickFinder() });
    } catch (error) {
      return json(res, 500, { ok: false, message: friendlyScanError(error) });
    }
  }

  if (url.pathname === '/api/scan' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'scan', 12, 10 * 60 * 1000)) return json(res, 429, { ok: false, message: PUBLIC_MESSAGES.RATE_LIMITED });
    if (running) return json(res, 409, { ok: false, message: 'A scan is already running.' });
    scanNow().catch((error) => console.error('[scanNow uncaught]', error));
    return json(res, 202, { ok: true, message: 'Scan started.' });
  }

  if (await serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

// Any unhandled throw returns generic copy; the detail stays in the server log.
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('[AutoProp request] unhandled failure', JSON.stringify(internalDetail(error, { stage: 'request', path: req.url })));
    if (res.headersSent) return res.destroy();
    json(res, 500, { ok: false, message: GENERIC_MESSAGE });
  });
});
server.on('clientError', (error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });

server.listen(port, () => {
  console.log(`AutoProp Scout Pro stable server running on http://localhost:${port}`);
  console.log('Mode: live');
  console.log('Scanner: PickFinder v2 + auth preflight + output quality gate');
  console.log(`Dashboard gate: ${authRequired ? 'enabled' : 'disabled'}`);
  console.log(`Auto scan: ${intervalMinutes > 0 ? `every ${intervalMinutes} minutes` : 'disabled'}`);
});

if (intervalMinutes > 0) {
  setInterval(() => {
    if (!running) scanNow().catch((error) => console.error('[auto scan uncaught]', error));
  }, intervalMinutes * 60 * 1000).unref();
}
