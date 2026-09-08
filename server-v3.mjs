import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  authenticateUser,
  getUserById,
  getUserSessionVersion,
  listUsers,
  registerUser,
  userDataDir,
} from './auth/user-store.mjs';
import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from './scanner/rules.mjs';
import { findLivePlayer, getLiveScores, LIVE_SPORTS } from './providers/live-sports.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const port = Number(process.env.PORT || 3000);
const intervalMinutes = Math.max(0, Number(process.env.AUTO_SCAN_MINUTES || 30));
const maxConcurrentScans = Math.max(1, Math.min(4, Number(process.env.MAX_CONCURRENT_USER_SCANS || 2)));
const sessionSecret = process.env.APP_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || crypto.createHash('sha256').update(`autoprop-v3:${process.env.AUTOPROP_MASTER_KEY || 'local'}`).digest('hex');
const sessionDays = Math.max(1, Math.min(90, Number(process.env.SESSION_DAYS || 30)));

await fs.mkdir(dataDir, { recursive: true });

const runtime = new Map();
let activeScans = 0;

function stateFor(userId) {
  if (!runtime.has(userId)) runtime.set(userId, {
    running: false,
    lastError: null,
    progress: { stage: 'idle', message: 'Ready', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: null, updatedAt: new Date().toISOString() },
  });
  return runtime.get(userId);
}

function stateDir(userId) { return path.join(userDataDir(userId), 'state'); }
function pickFinderDir(userId) { return path.join(userDataDir(userId), 'pickfinder'); }
function stateFile(userId, name) { return path.join(stateDir(userId), name); }

async function ensureUserDirs(userId) {
  await Promise.all([
    fs.mkdir(stateDir(userId), { recursive: true, mode: 0o700 }),
    fs.mkdir(pickFinderDir(userId), { recursive: true, mode: 0o700 }),
  ]);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

async function loadRules(userId) {
  return normalizeRules(await readJson(stateFile(userId, 'rules.json'), DEFAULT_RULES));
}
async function saveRules(userId, value) {
  const rules = normalizeRules(value);
  await atomicJson(stateFile(userId, 'rules.json'), rules);
  return rules;
}

function validPickIdentity(pick) {
  const player = String(pick?.player || '').trim();
  const sport = String(pick?.sport || '').trim().toUpperCase();
  return Boolean(
    player
    && !/^(pickfinder|unknown player|unknown)$/i.test(player)
    && sport
    && sport !== 'UNKNOWN'
    && pick?.prop
    && Number.isFinite(Number(pick?.line))
  );
}

function sanitizeScanResult(result) {
  const sourcePicks = Array.isArray(result?.picks) ? result.picks : [];
  const visible = sourcePicks.filter(validPickIdentity);
  const suppressed = sourcePicks.length - visible.length;
  const qualified = visible.filter((pick) => pick.qualified);
  const rejected = visible.filter((pick) => !pick.qualified);
  const validIds = new Set(visible.map((pick) => pick.id || pick.sourceUrl));
  const card = (result?.diversifiedCard || []).filter((pick) => validIds.has(pick.id || pick.sourceUrl));
  const bestAvailable = (result?.bestAvailable || []).filter(validPickIdentity);
  return {
    ...result,
    picks: visible,
    diversifiedCard: card,
    bestAvailable,
    totalReviewed: visible.length,
    qualifiedCount: qualified.length,
    rejectedCount: rejected.length,
    suppressedMalformedCount: suppressed,
    warnings: [
      ...(result?.warnings || []),
      ...(suppressed ? [`${suppressed} malformed scraper record${suppressed === 1 ? '' : 's'} were hidden automatically.`] : []),
    ],
  };
}

async function saveResult(userId, rawResult) {
  const result = sanitizeScanResult(rawResult);
  await atomicJson(stateFile(userId, 'latest.json'), result);
  const history = await readJson(stateFile(userId, 'history.json'), []);
  history.unshift({
    scannedAt: result.scannedAt,
    mode: result.mode,
    totalReviewed: result.totalReviewed,
    qualifiedCount: result.qualifiedCount,
    rejectedCount: result.rejectedCount,
    bestAvailableCount: result.bestAvailable?.length || 0,
    suppressedMalformedCount: result.suppressedMalformedCount || 0,
    bestConfidence: Math.max(0, ...(result.picks || []).filter((pick) => pick.qualified).map((pick) => Number(pick.confidence) || 0)),
    rulesApplied: result.rulesApplied || null,
  });
  await atomicJson(stateFile(userId, 'history.json'), history.slice(0, 100));
  return result;
}

function friendlyError(error) {
  const message = error?.message || String(error);
  if (/auth form could not be opened|AUTH_FORM_CHANGED/i.test(message)) return 'PickFinder changed its sign-in screen. AutoProp captured a safe diagnostic and stopped before scanning.';
  if (/interactive verification/i.test(message)) return 'PickFinder requires an interactive verification step for this login.';
  if (/invalid credentials|rejected the email|password/i.test(message)) return 'PickFinder rejected the email or password for this account.';
  if (/not unlocked|locked/i.test(message)) return 'This PickFinder account is not exposing unlocked player analytics yet. Reconnect it before scanning.';
  if (/unexpected token/i.test(message)) return 'Saved PickFinder connection data could not be read. Reconnect this account.';
  return message;
}

function runUserWorker(userId, action, payload = {}, onProgress = null, timeoutMs = 12 * 60 * 1000) {
  return new Promise(async (resolve, reject) => {
    await ensureUserDirs(userId);
    const child = spawn(process.execPath, ['scanner/user-worker.mjs', action], {
      cwd: __dirname,
      env: { ...process.env, DATA_DIR: pickFinderDir(userId) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let resultValue;
    let workerError;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const parseLines = () => {
      let index;
      while ((index = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'progress') onProgress?.(event.data || {});
          if (event.type === 'result') resultValue = event.data;
          if (event.type === 'error') workerError = event.data || { message: 'PickFinder worker failed.' };
        } catch {}
      }
    };

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); parseLines(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, 12000); });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      parseLines();
      if (code === 0 && resultValue !== undefined) return finish(resolve, resultValue);
      const error = new Error(workerError?.message || stderr.trim() || `PickFinder worker exited with code ${code}`);
      error.code = workerError?.code || null;
      if (workerError?.stack) error.stack = workerError.stack;
      finish(reject, error);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error('PickFinder scan timed out safely.');
      error.code = 'PICKFINDER_TIMEOUT';
      finish(reject, error);
    }, timeoutMs);

    child.stdin.end(JSON.stringify(payload));
  });
}

async function connectionState(userId) {
  try { return await runUserWorker(userId, 'connection', {}, null, 30_000); }
  catch (error) { return { configured: false, sessionSaved: false, connectionError: friendlyError(error) }; }
}

async function scanNow(userId) {
  const state = stateFor(userId);
  if (state.running) return { ok: false, message: 'A scan is already running for your account.' };
  if (activeScans >= maxConcurrentScans) return { ok: false, message: 'Scanner capacity is busy. Try again in a moment.' };
  state.running = true;
  state.lastError = null;
  activeScans++;
  state.progress = { stage: 'starting', message: 'Starting your private scan', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  try {
    const rules = await loadRules(userId);
    const raw = await runUserWorker(userId, 'scan', { rules }, (next) => {
      state.progress = { ...state.progress, ...next, updatedAt: new Date().toISOString() };
    });
    const result = await saveResult(userId, raw);
    state.progress = { ...state.progress, stage: 'complete', message: result.qualifiedCount ? `Scan complete — ${result.qualifiedCount} qualified` : `Scan complete — ${result.bestAvailable?.length || 0} Best Available`, reviewed: result.totalReviewed, total: result.totalReviewed, qualifiedSoFar: result.qualifiedCount, currentPlayer: null, updatedAt: new Date().toISOString() };
    await fs.rm(stateFile(userId, 'last-error.json'), { force: true }).catch(() => {});
    return { ok: true, result };
  } catch (error) {
    state.lastError = friendlyError(error);
    state.progress = { ...state.progress, stage: 'error', message: state.lastError, currentPlayer: null, updatedAt: new Date().toISOString() };
    await atomicJson(stateFile(userId, 'last-error.json'), { at: new Date().toISOString(), message: state.lastError, code: error?.code || null }).catch(() => {});
    return { ok: false, message: state.lastError, code: error?.code || null };
  } finally {
    state.running = false;
    activeScans = Math.max(0, activeScans - 1);
  }
}

function parseCookies(req) {
  const out = {};
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    out[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return out;
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function signPayload(payload) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}
async function makeSession(userId) {
  const version = await getUserSessionVersion(userId);
  const expires = Date.now() + sessionDays * 86400_000;
  const nonce = crypto.randomBytes(8).toString('base64url');
  const payload = `v1.${userId}.${expires}.${version}.${nonce}`;
  return `${payload}.${signPayload(payload)}`;
}
async function authUser(req) {
  const token = parseCookies(req).aps_user;
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 6 || parts[0] !== 'v1') return null;
  const payload = parts.slice(0, 5).join('.');
  if (!safeEqual(parts[5], signPayload(payload))) return null;
  const userId = parts[1];
  const expires = Number(parts[2]);
  const version = Number(parts[3]);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  if (version !== await getUserSessionVersion(userId)) return null;
  return user;
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
async function readJsonBody(req, limit = 64_000) {
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
function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'content-length': Buffer.byteLength(body), 'x-content-type-options': 'nosniff', ...extraHeaders });
  res.end(body);
}
function cookieHeader(req, token) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `aps_user=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDays * 86400}${secure ? '; Secure' : ''}`;
}
function clearCookieHeader(req) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `aps_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index-v3.html';
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
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    res.end(body);
    return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const user = await authUser(req);
    return json(res, 200, { required: true, authenticated: Boolean(user), user });
  }
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    try {
      const body = await readJsonBody(req, 16_000);
      const user = await registerUser(body);
      const token = await makeSession(user.id);
      return json(res, 201, { ok: true, authenticated: true, user }, { 'set-cookie': cookieHeader(req, token) });
    } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    try {
      const body = await readJsonBody(req, 16_000);
      const user = await authenticateUser(body);
      if (!user) return json(res, 401, { ok: false, message: 'Incorrect AutoProp email or password.' });
      const token = await makeSession(user.id);
      return json(res, 200, { ok: true, authenticated: true, user }, { 'set-cookie': cookieHeader(req, token) });
    } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookieHeader(req) });
  }

  if (url.pathname.startsWith('/api/')) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: 'Sign in to your AutoProp account.', authRequired: true });
    const userId = user.id;
    await ensureUserDirs(userId);
    const state = stateFor(userId);

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const [latest, connection, rules] = await Promise.all([
        readJson(stateFile(userId, 'latest.json'), null),
        connectionState(userId),
        loadRules(userId),
      ]);
      return json(res, 200, { user, running: state.running, lastError: state.lastError, connection, rules, progress: state.progress, demoMode: false, autoScanMinutes: intervalMinutes, liveSports: Object.keys(LIVE_SPORTS), latest });
    }
    if (url.pathname === '/api/history' && req.method === 'GET') return json(res, 200, await readJson(stateFile(userId, 'history.json'), []));
    if (url.pathname === '/api/rules' && req.method === 'GET') return json(res, 200, { rules: await loadRules(userId), presets: RULE_PRESETS, locked: { prizePicksOnly: true, regularLinesOnly: true, todayOnly: true } });
    if (url.pathname === '/api/rules' && req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Wait for your scan to finish before changing rules.' });
      try {
        const body = await readJsonBody(req, 16_000);
        return json(res, 200, { ok: true, rules: await saveRules(userId, body.rules || body), locked: { prizePicksOnly: true, regularLinesOnly: true, todayOnly: true } });
      } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
    }
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Wait for your current scan to finish.' });
      try {
        const body = await readJsonBody(req, 20_000);
        const connection = await runUserWorker(userId, 'connect', { email: body.email, password: body.password }, (next) => { state.progress = { ...state.progress, ...next, updatedAt: new Date().toISOString() }; }, 120_000);
        // Never carry results across a changed PickFinder account.
        await Promise.all([
          fs.rm(stateFile(userId, 'latest.json'), { force: true }),
          fs.rm(stateFile(userId, 'history.json'), { force: true }),
          fs.rm(stateFile(userId, 'last-error.json'), { force: true }),
        ]).catch(() => {});
        state.lastError = null;
        return json(res, 200, { ok: true, connection });
      } catch (error) { return json(res, 400, { ok: false, message: friendlyError(error), code: error?.code || null }); }
    }
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Wait for your current scan to finish.' });
      try {
        const connection = await runUserWorker(userId, 'disconnect', {}, null, 30_000);
        await Promise.all([
          fs.rm(stateFile(userId, 'latest.json'), { force: true }),
          fs.rm(stateFile(userId, 'history.json'), { force: true }),
        ]).catch(() => {});
        return json(res, 200, { ok: true, connection });
      } catch (error) { return json(res, 500, { ok: false, message: friendlyError(error) }); }
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Your scan is already running.' });
      if (activeScans >= maxConcurrentScans) return json(res, 429, { ok: false, message: 'Scanner capacity is busy. Try again shortly.' });
      scanNow(userId).catch((error) => console.error('[user scan uncaught]', userId, error));
      return json(res, 202, { ok: true, message: 'Your private scan started.' });
    }
    if (url.pathname === '/api/live/scores' && req.method === 'GET') {
      const sports = String(url.searchParams.get('sports') || '').split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);
      try { return json(res, 200, await getLiveScores({ sports: sports.length ? sports : undefined })); }
      catch (error) { return json(res, 502, { provider: 'ESPN', games: [], errors: [error?.message || 'Live score provider unavailable'] }); }
    }
    if (url.pathname === '/api/live/player' && req.method === 'GET') {
      const sport = String(url.searchParams.get('sport') || '').toUpperCase();
      const player = String(url.searchParams.get('name') || '').trim().slice(0, 120);
      if (!sport || !player) return json(res, 400, { ok: false, message: 'sport and name are required.' });
      try { return json(res, 200, await findLivePlayer({ sport, player })); }
      catch (error) { return json(res, 502, { supported: Boolean(LIVE_SPORTS[sport]), live: false, player: null, message: error?.message || 'Live player data unavailable' }); }
    }
  }

  if (await serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`AutoProp Scout Pro v3 running on http://localhost:${port}`);
  console.log('Auth: isolated multi-user accounts');
  console.log(`PickFinder: isolated child workers • max concurrent scans ${maxConcurrentScans}`);
  console.log(`Live sports provider: ESPN • ${Object.keys(LIVE_SPORTS).join(', ')}`);
});

if (intervalMinutes > 0) {
  setInterval(async () => {
    if (activeScans >= maxConcurrentScans) return;
    for (const user of await listUsers()) {
      if (activeScans >= maxConcurrentScans) break;
      const state = stateFor(user.id);
      if (state.running) continue;
      const connection = await connectionState(user.id);
      if (!connection?.configured) continue;
      await scanNow(user.id).catch((error) => console.error('[scheduled scan]', user.id, error));
    }
  }, intervalMinutes * 60 * 1000).unref();
}
