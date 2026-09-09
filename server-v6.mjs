import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authenticateUser, getUserById, getUserSessionVersion, listUsers, registerUser, userDataDir } from './auth/user-store.mjs';
import { generateAccessCode, redeemAccessCode, listAccessCodes, revokeAccessCode } from './access-codes-v4.mjs';
import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from './scanner/rules.mjs';
import { findLivePlayer, getLiveScores, LIVE_SPORTS } from './providers/live-sports.mjs';
import { paypalConfig } from './payments/paypal.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const port = Number(process.env.PORT || 3000);
const intervalMinutes = Math.max(0, Number(process.env.AUTO_SCAN_MINUTES || 30));
const boardRefreshSeconds = Math.max(30, Number(process.env.BOARD_REFRESH_SECONDS || 60));
const boardFreshMs = boardRefreshSeconds * 1000;
const boardActiveWindowMs = Math.max(2 * 60_000, Number(process.env.BOARD_ACTIVE_WINDOW_MS || 10 * 60_000));
const maxConcurrentScans = Math.max(1, Math.min(6, Number(process.env.MAX_CONCURRENT_USER_SCANS || 2)));
const maxConcurrentBoardPulls = Math.max(1, Math.min(3, Number(process.env.MAX_CONCURRENT_BOARD_PULLS || 1)));
const sessionDays = Math.max(1, Math.min(90, Number(process.env.SESSION_DAYS || 30)));
const sessionSecret = process.env.APP_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || crypto.createHash('sha256').update(`autoprop-v6:${process.env.AUTOPROP_MASTER_KEY || 'local'}`).digest('hex');
const ownerUnlockCode = String(process.env.OWNER_UNLOCK_CODE || '').trim();

await fs.mkdir(dataDir, { recursive: true });
const runtime = new Map();
const boardRuntime = new Map();
const focusedCache = new Map();
const rateBuckets = new Map();
const connectionCache = new Map();
let activeScans = 0;
let activeBoardPulls = 0;

function stateFor(userId) {
  if (!runtime.has(userId)) runtime.set(userId, {
    running: false,
    lastError: null,
    progress: { stage: 'idle', message: 'Ready', reviewed: 0, total: 0, qualifiedSoFar: 0, currentPlayer: null, startedAt: null, updatedAt: new Date().toISOString() },
  });
  return runtime.get(userId);
}
function boardStateFor(userId) {
  if (!boardRuntime.has(userId)) boardRuntime.set(userId, { refreshing: false, error: null, progress: null, lastRequestedAt: 0 });
  return boardRuntime.get(userId);
}
function stateDir(id) { return path.join(userDataDir(id), 'state'); }
function pickFinderDir(id) { return path.join(userDataDir(id), 'pickfinder'); }
function stateFile(id, name) { return path.join(stateDir(id), name); }
function boardFile(id) { return stateFile(id, 'board-live.json'); }
async function ensureDirs(id) {
  await Promise.all([
    fs.mkdir(stateDir(id), { recursive: true, mode: 0o700 }),
    fs.mkdir(pickFinderDir(id), { recursive: true, mode: 0o700 }),
  ]);
}
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
async function loadRules(id) { return normalizeRules(await readJson(stateFile(id, 'rules.json'), DEFAULT_RULES)); }
async function saveRules(id, value) { const rules = normalizeRules(value); await atomicJson(stateFile(id, 'rules.json'), rules); return rules; }

function validPick(p) {
  const player = String(p?.player || '').trim();
  const sport = String(p?.sport || '').trim().toUpperCase();
  return Boolean(player && !/^(pickfinder|unknown|unknown player)$/i.test(player) && sport && sport !== 'UNKNOWN' && p?.prop && Number.isFinite(Number(p?.line)) && ['OVER', 'UNDER'].includes(String(p?.pick || '').toUpperCase()));
}
function sanitizeResult(raw = {}) {
  const picks = (Array.isArray(raw.picks) ? raw.picks : []).filter(validPick);
  const ids = new Set(picks.map((p) => p.id || p.sourceUrl).filter(Boolean));
  const keep = (p) => validPick(p) && (!(p.id || p.sourceUrl) || ids.has(p.id || p.sourceUrl));
  const qualified = picks.filter((p) => p.qualified);
  return {
    ...raw,
    picks,
    diversifiedCard: (raw.diversifiedCard || []).filter(keep),
    bestAvailable: (raw.bestAvailable || []).filter(validPick),
    greenGoblins: (raw.greenGoblins || []).filter(validPick),
    redGoblins: (raw.redGoblins || []).filter(validPick),
    totalReviewed: picks.length,
    qualifiedCount: qualified.length,
    rejectedCount: picks.length - qualified.length,
    suppressedMalformedCount: (raw.picks?.length || 0) - picks.length,
  };
}
async function saveResult(id, raw) {
  const result = sanitizeResult(raw);
  await atomicJson(stateFile(id, 'latest.json'), result);
  const history = await readJson(stateFile(id, 'history.json'), []);
  history.unshift({
    scannedAt: result.scannedAt,
    scannerVersion: result.scannerVersion,
    totalReviewed: result.totalReviewed,
    qualifiedCount: result.qualifiedCount,
    rejectedCount: result.rejectedCount,
    bestAvailableCount: result.bestAvailable?.length || 0,
    greenGoblinCount: result.greenGoblins?.length || 0,
    redGoblinCount: result.redGoblins?.length || 0,
    suppressedMalformedCount: result.suppressedMalformedCount || 0,
  });
  await atomicJson(stateFile(id, 'history.json'), history.slice(0, 100));
  return result;
}
function friendly(error) {
  const m = error?.message || String(error);
  if (/captcha|interactive verification|two.factor|2fa/i.test(m)) return 'PickFinder requires an interactive verification step. Complete it on PickFinder, then reconnect.';
  if (/invalid credentials|rejected the email|password/i.test(m)) return 'PickFinder rejected that email or password.';
  if (/reconnect|not unlocked|still locked|sign in to unlock/i.test(m)) return 'PickFinder is not unlocked for this account. Reconnect your own PickFinder account.';
  if (/unexpected token|decrypt|unreadable/i.test(m)) return 'Saved PickFinder session data is unreadable. Reconnect this account.';
  return m.length > 280 ? 'AutoProp could not complete that request. Please retry.' : m;
}

function runWorker(id, action, payload = {}, onProgress = null, timeoutMs = 12 * 60 * 1000) {
  return new Promise(async (resolve, reject) => {
    await ensureDirs(id);
    const child = spawn(process.execPath, ['scanner/user-worker.mjs', action], {
      cwd: __dirname,
      env: { ...process.env, DATA_DIR: pickFinderDir(id) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '', value, workerError, done = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, Object.assign(new Error('PickFinder worker timed out safely.'), { code: 'PICKFINDER_TIMEOUT' }));
    }, timeoutMs);
    function finish(fn, v) { if (done) return; done = true; clearTimeout(timer); fn(v); }
    function parse() {
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i).trim(); out = out.slice(i + 1);
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (e.type === 'progress') onProgress?.(e.data || {});
          if (e.type === 'result') value = e.data;
          if (e.type === 'error') workerError = e.data;
        } catch {}
      }
    }
    child.stdout.on('data', (c) => { out += c.toString(); parse(); });
    child.stderr.on('data', (c) => { err = (err + c.toString()).slice(-12000); });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      parse();
      if (code === 0 && value !== undefined) return finish(resolve, value);
      const e = new Error(workerError?.message || err.trim() || `Worker exited ${code}`);
      e.code = workerError?.code;
      finish(reject, e);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
async function connectionState(id, force = false) {
  const cached = connectionCache.get(id);
  if (!force && cached && Date.now() - cached.at < 15_000) return cached.value;
  try {
    const value = await runWorker(id, 'connection', {}, null, 30_000);
    connectionCache.set(id, { at: Date.now(), value });
    return value;
  } catch (e) {
    const value = { configured: false, sessionSaved: false, connectionError: friendly(e) };
    connectionCache.set(id, { at: Date.now(), value });
    return value;
  }
}

function compactBoardRow(p = {}) {
  return {
    id: p.id || null,
    player: p.player || 'Player',
    sport: p.sport || 'OTHER',
    prop: p.prop || 'Prop',
    line: Number.isFinite(Number(p.line)) ? Number(p.line) : null,
    pick: p.pick || 'N/A',
    opponent: p.opponent || '',
    matchId: p.matchId || '',
    eventDate: p.eventDate || null,
    sourceApp: p.sourceApp || 'PickFinder',
    sourceAppConfirmed: Boolean(p.sourceAppConfirmed),
    prizePicksConfirmed: Boolean(p.prizePicksConfirmed),
    lineType: p.lineType || 'REGULAR',
    modifierLabel: p.modifierLabel || 'All',
    sourceUrl: p.sourceUrl || '',
    dateScope: p.dateScope || 'All',
    boardLoaded: true,
  };
}
function compactBoardRows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const raw of rows) {
    const row = compactBoardRow(raw);
    const key = String(row.id || `${row.sourceApp}|${row.sourceUrl}|${row.lineType}|${row.line}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
function boardAgeMs(cache) {
  const stamp = Date.parse(cache?.refreshedAt || cache?.scannedAt || '');
  return Number.isFinite(stamp) ? Date.now() - stamp : Infinity;
}
async function writeBoardCache(id, raw, source = 'live-pull') {
  const rows = compactBoardRows(raw?.picks || raw?.allBoard || raw?.boardProps || []);
  const refreshedAt = new Date().toISOString();
  const cache = {
    version: `${Date.now().toString(36)}-${rows.length}`,
    refreshedAt,
    scannedAt: raw?.scannedAt || refreshedAt,
    source,
    scannerVersion: raw?.scannerVersion || 'board-v6',
    total: rows.length,
    picks: rows,
    appInventory: raw?.appInventory || [],
    warnings: raw?.warnings || [],
  };
  await atomicJson(boardFile(id), cache);
  return cache;
}
async function refreshBoard(id, { force = false } = {}) {
  const bs = boardStateFor(id);
  const existing = await readJson(boardFile(id), null);
  if (!force && existing && boardAgeMs(existing) < boardFreshMs) return { ok: true, cache: existing, started: false };
  if (bs.refreshing) return { ok: true, cache: existing, started: false, refreshing: true };
  if (stateFor(id).running) return { ok: true, cache: existing, started: false, waitingForScan: true };
  if (activeBoardPulls >= maxConcurrentBoardPulls) return { ok: true, cache: existing, started: false, capacityBusy: true };

  bs.refreshing = true;
  bs.error = null;
  bs.progress = { message: 'Opening PickFinder board…', reviewed: 0 };
  activeBoardPulls++;
  try {
    const raw = await runWorker(id, 'board', {}, (p) => { bs.progress = p; }, 4 * 60_000);
    const cache = await writeBoardCache(id, raw, 'PickFinder background live pull');
    return { ok: true, cache, started: true };
  } catch (e) {
    bs.error = friendly(e);
    return { ok: false, cache: existing, message: bs.error };
  } finally {
    bs.refreshing = false;
    bs.progress = null;
    activeBoardPulls = Math.max(0, activeBoardPulls - 1);
  }
}
function researchKey(p = {}) { return String(p.id || `${p.sourceUrl}|${p.lineType || 'REGULAR'}`).toLowerCase(); }
async function boardApiPayload(id, since = '') {
  const bs = boardStateFor(id);
  bs.lastRequestedAt = Date.now();
  const cache = await readJson(boardFile(id), null);
  const stale = !cache || boardAgeMs(cache) >= boardFreshMs;
  if (stale && !bs.refreshing) refreshBoard(id).catch((e) => { bs.error = friendly(e); });

  const meta = {
    ok: true,
    refreshing: bs.refreshing,
    stale,
    error: bs.error,
    progress: bs.progress,
    refreshSeconds: boardRefreshSeconds,
    version: cache?.version || null,
    refreshedAt: cache?.refreshedAt || null,
    total: cache?.total || 0,
  };
  if (!cache) return { ...meta, picks: [] };
  if (since && since === cache.version) return { ...meta, unchanged: true };

  const latest = await readJson(stateFile(id, 'latest.json'), null);
  const research = new Map((latest?.picks || []).map((p) => [researchKey(p), p]));
  const picks = cache.picks.map((board) => {
    const match = research.get(researchKey(board));
    if (!match) return { ...board, researchStatus: 'BOARD_ONLY', ruleStatus: 'PENDING', qualified: null, confidence: null };
    return {
      ...board,
      researchStatus: match.researchStatus || (match.detailPageVerified ? 'RESEARCHED' : 'BOARD_ONLY'),
      ruleStatus: match.ruleStatus || (match.qualified === true ? 'PASSED' : match.qualified === false ? 'FAILED' : 'PENDING'),
      qualified: match.qualified ?? null,
      confidence: match.confidence ?? null,
    };
  });
  return { ...meta, picks, appInventory: cache.appInventory || [], warnings: cache.warnings || [] };
}

async function scanNow(id) {
  const s = stateFor(id);
  if (s.running) return { ok: false, message: 'Your scan is already running.' };
  if (activeScans >= maxConcurrentScans) return { ok: false, message: 'Scanner capacity is busy.' };
  s.running = true; s.lastError = null; activeScans++;
  s.progress = { stage: 'starting', message: 'Starting your private PickFinder scan', reviewed: 0, total: 0, qualifiedSoFar: 0, currentPlayer: null, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  try {
    const rules = await loadRules(id);
    const raw = await runWorker(id, 'scan', { rules }, (p) => { s.progress = { ...s.progress, ...p, updatedAt: new Date().toISOString() }; });
    const boardRows = raw?.allBoard || raw?.boardProps || raw?.picks || [];
    if (boardRows.length) await writeBoardCache(id, { ...raw, picks: boardRows }, 'full scan board snapshot').catch(() => {});
    const result = await saveResult(id, raw);
    s.progress = { ...s.progress, stage: 'complete', message: result.qualifiedCount ? `Scan complete — ${result.qualifiedCount} qualified` : `Scan complete — ${result.bestAvailable?.length || 0} Best Available`, reviewed: result.totalReviewed, total: result.totalReviewed, qualifiedSoFar: result.qualifiedCount, currentPlayer: null, updatedAt: new Date().toISOString() };
    return { ok: true, result };
  } catch (e) {
    s.lastError = friendly(e);
    s.progress = { ...s.progress, stage: 'error', message: s.lastError, currentPlayer: null, updatedAt: new Date().toISOString() };
    await atomicJson(stateFile(id, 'last-error.json'), { at: new Date().toISOString(), message: s.lastError, code: e?.code || null }).catch(() => {});
    return { ok: false, message: s.lastError };
  } finally { s.running = false; activeScans = Math.max(0, activeScans - 1); }
}

function parseCookies(req) { const out = {}; for (const pair of String(req.headers.cookie || '').split(';')) { const i = pair.indexOf('='); if (i >= 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim()); } return out; }
function safeEqual(a, b) { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function sign(payload) { return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url'); }
async function makeSession(id) { const version = await getUserSessionVersion(id); const expires = Date.now() + sessionDays * 86400_000; const nonce = crypto.randomBytes(8).toString('base64url'); const payload = `v1.${id}.${expires}.${version}.${nonce}`; return `${payload}.${sign(payload)}`; }
async function authUser(req) {
  const token = parseCookies(req).aps_user; if (!token) return null;
  const p = String(token).split('.'); if (p.length !== 6 || p[0] !== 'v1') return null;
  const payload = p.slice(0, 5).join('.');
  if (!safeEqual(p[5], sign(payload)) || Number(p[2]) < Date.now()) return null;
  const user = await getUserById(p[1]);
  if (!user || Number(p[3]) !== await getUserSessionVersion(p[1])) return null;
  return user;
}
function sameOrigin(req) { const origin = req.headers.origin; if (!origin) return true; try { return new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || ''); } catch { return false; } }
async function body(req, limit = 64000) { let n = 0, chunks = []; for await (const c of req) { n += c.length; if (n > limit) throw new Error('Request body too large.'); chunks.push(c); } if (!chunks.length) return {}; return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
function json(res, status, payload, headers = {}) { const text = JSON.stringify(payload); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text), 'x-content-type-options': 'nosniff', ...headers }); res.end(text); }
function cookie(req, token) { const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'; return `aps_user=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDays * 86400}${secure ? '; Secure' : ''}`; }
function clearCookie(req) { const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'; return `aps_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`; }
function allow(req, bucket, max, windowMs, subject = '') { const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(); const key = `${bucket}:${subject || ip}`, now = Date.now(), rows = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs); if (rows.length >= max) { rateBuckets.set(key, rows); return false; } rows.push(now); rateBuckets.set(key, rows); return true; }

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index-v4.html';
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const file = path.join(publicDir, normalized);
  if (!file.startsWith(publicDir)) return false;
  try {
    const stat = await fs.stat(file); if (!stat.isFile()) return false;
    let data = await fs.readFile(file);
    if (pathname === '/index-v4.html') {
      let text = data.toString('utf8');
      text = text.replace('<script type="module" src="/app-v4.js"></script>', '<script src="/owner-tools.js"></script><script src="/live-board.js"></script><script type="module" src="/app-v4.js"></script>');
      data = Buffer.from(text);
    }
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'cache-control': pathname.endsWith('.html') ? 'no-store' : 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://www.paypal.com; script-src 'self' https://www.paypal.com https://www.paypalobjects.com; img-src 'self' data: https:; connect-src 'self' https://www.paypal.com https://api-m.paypal.com https://api-m.sandbox.paypal.com; frame-src https://www.paypal.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    res.end(data); return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const user = await authUser(req);
    return json(res, 200, { required: true, authenticated: Boolean(user), user, role: user?.role || null, canGenerateAccessCodes: user?.role === 'owner' });
  }
  if (url.pathname === '/api/payments/config' && req.method === 'GET') {
    const p = paypalConfig();
    return json(res, 200, { enabled: p.enabled, clientId: p.clientId, price: p.price, currency: p.currency, productName: p.productName, environment: p.environment });
  }
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allow(req, 'register', 10, 30 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many account attempts. Try again later.' });
    try {
      const b = await body(req, 16000); const code = String(b.accessCode || '').trim(); const users = await listUsers(); let role = 'member';
      if (ownerUnlockCode && safeEqual(code, ownerUnlockCode) && !users.some((u) => u.role === 'owner')) role = 'owner';
      else { const invite = await redeemAccessCode(code); if (!invite) return json(res, 403, { ok: false, message: 'A valid owner or friend access code is required to create an account.' }); }
      const user = await registerUser({ email: b.email, password: b.password, role });
      return json(res, 201, { ok: true, authenticated: true, user }, { 'set-cookie': cookie(req, await makeSession(user.id)) });
    } catch (e) { return json(res, 400, { ok: false, message: e?.message || String(e) }); }
  }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allow(req, 'login', 15, 15 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many login attempts.' });
    try {
      const b = await body(req, 16000); const user = await authenticateUser(b);
      if (!user) return json(res, 401, { ok: false, message: 'Incorrect AutoProp email or password.' });
      return json(res, 200, { ok: true, authenticated: true, user }, { 'set-cookie': cookie(req, await makeSession(user.id)) });
    } catch (e) { return json(res, 400, { ok: false, message: e?.message || String(e) }); }
  }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') return json(res, 200, { ok: true }, { 'set-cookie': clearCookie(req) });

  if (url.pathname.startsWith('/api/')) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: 'Sign in to your AutoProp account.', authRequired: true });
    const id = user.id; await ensureDirs(id); const s = stateFor(id);

    if (url.pathname === '/api/access-codes/generate' && req.method === 'POST') {
      if (user.role !== 'owner') return json(res, 403, { ok: false, message: 'Owner access required.' });
      if (!allow(req, 'codes', 30, 3600000, id)) return json(res, 429, { ok: false, message: 'Code generation limit reached.' });
      try { const b = await body(req, 8000); return json(res, 200, { ok: true, ...await generateAccessCode({ label: b.label, expiresInDays: b.expiresInDays, maxUses: b.maxUses }) }); }
      catch { return json(res, 500, { ok: false, message: 'Could not generate code.' }); }
    }
    if (url.pathname === '/api/access-codes' && req.method === 'GET') {
      if (user.role !== 'owner') return json(res, 403, { ok: false, message: 'Owner access required.' });
      return json(res, 200, { codes: await listAccessCodes() });
    }
    if (url.pathname === '/api/access-codes/revoke' && req.method === 'POST') {
      if (user.role !== 'owner') return json(res, 403, { ok: false, message: 'Owner access required.' });
      try { const b = await body(req, 8000); const code = await revokeAccessCode(b.id); return code ? json(res, 200, { ok: true, code }) : json(res, 404, { ok: false, message: 'Code not found.' }); }
      catch { return json(res, 400, { ok: false, message: 'Could not revoke code.' }); }
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const [latest, connection, rules, board] = await Promise.all([
        readJson(stateFile(id, 'latest.json'), null),
        connectionState(id),
        loadRules(id),
        readJson(boardFile(id), null),
      ]);
      return json(res, 200, {
        user, running: s.running, lastError: s.lastError, connection, rules, progress: s.progress, demoMode: false,
        autoScanMinutes: intervalMinutes, liveSports: Object.keys(LIVE_SPORTS), paymentConfigured: paypalConfig().enabled,
        scannerVersion: 'friends-v6-live-board', latest,
        liveBoard: { total: board?.total || 0, refreshedAt: board?.refreshedAt || null, refreshing: boardStateFor(id).refreshing },
      });
    }
    if (url.pathname === '/api/board' && req.method === 'GET') {
      return json(res, 200, await boardApiPayload(id, String(url.searchParams.get('since') || '')));
    }
    if (url.pathname === '/api/board/refresh' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (!allow(req, 'board-refresh', 12, 10 * 60 * 1000, id)) return json(res, 429, { ok: false, message: 'Live board refresh limit reached. It refreshes automatically.' });
      const bs = boardStateFor(id);
      if (!bs.refreshing) refreshBoard(id, { force: true }).catch((e) => { bs.error = friendly(e); });
      return json(res, 202, { ok: true, refreshing: true, message: 'PickFinder live board refresh started.' });
    }
    if (url.pathname === '/api/history' && req.method === 'GET') return json(res, 200, await readJson(stateFile(id, 'history.json'), []));
    if (url.pathname === '/api/rules' && req.method === 'GET') return json(res, 200, { rules: await loadRules(id), presets: RULE_PRESETS, locked: { verifiedSourcesOnly: true, todayOnly: true, lineTypes: ['REGULAR', 'GREEN_GOBLIN', 'RED_GOBLIN'], allPickFinderApps: true } });
    if (url.pathname === '/api/rules' && req.method === 'PUT') {
      if (s.running) return json(res, 409, { ok: false, message: 'Wait for your scan to finish.' });
      try { const b = await body(req, 16000); return json(res, 200, { ok: true, rules: await saveRules(id, b.rules || b) }); }
      catch (e) { return json(res, 400, { ok: false, message: e?.message || String(e) }); }
    }
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      if (s.running) return json(res, 409, { ok: false, message: 'Wait for your scan to finish.' });
      try {
        const b = await body(req, 20000);
        const connection = await runWorker(id, 'connect', { email: b.email, password: b.password }, (p) => { s.progress = { ...s.progress, ...p, updatedAt: new Date().toISOString() }; }, 150000);
        connectionCache.delete(id);
        await Promise.all([
          fs.rm(stateFile(id, 'latest.json'), { force: true }),
          fs.rm(stateFile(id, 'history.json'), { force: true }),
          fs.rm(boardFile(id), { force: true }),
        ]).catch(() => {});
        s.lastError = null;
        boardStateFor(id).lastRequestedAt = Date.now();
        refreshBoard(id, { force: true }).catch(() => {});
        return json(res, 200, { ok: true, connection });
      } catch (e) { return json(res, 400, { ok: false, message: friendly(e), code: e?.code || null }); }
    }
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      try {
        const connection = await runWorker(id, 'disconnect', {}, null, 30000);
        connectionCache.delete(id);
        await fs.rm(boardFile(id), { force: true }).catch(() => {});
        return json(res, 200, { ok: true, connection });
      } catch (e) { return json(res, 500, { ok: false, message: friendly(e) }); }
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') {
      if (!allow(req, 'scan', 8, 15 * 60 * 1000, id)) return json(res, 429, { ok: false, message: 'Scan rate limit reached.' });
      if (s.running) return json(res, 409, { ok: false, message: 'Your scan is already running.' });
      scanNow(id).catch(console.error);
      return json(res, 202, { ok: true, message: 'Your private scan started. All Props Live remains available while research runs.' });
    }
    if (url.pathname === '/api/prop-search' && req.method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
      try {
        const result = await runWorker(id, 'search', { query: q }, null, 90000); const now = Date.now();
        for (const row of result?.results || []) if (row?.id) focusedCache.set(`${id}:${row.id}`, { at: now, selection: row });
        return json(res, 200, result);
      } catch (e) { return json(res, 400, { ok: false, message: friendly(e), results: [] }); }
    }
    if (url.pathname === '/api/scan-prop' && req.method === 'POST') {
      try {
        const b = await body(req, 8000); const cached = focusedCache.get(`${id}:${b.id}`);
        if (!cached || Date.now() - cached.at > 20 * 60 * 1000) return json(res, 400, { ok: false, message: 'Search for this prop again first.' });
        return json(res, 200, { ok: true, ...await runWorker(id, 'scan-prop', { selection: cached.selection }, null, 120000) });
      } catch (e) { return json(res, 400, { ok: false, message: friendly(e) }); }
    }
    if (url.pathname === '/api/live/scores' && req.method === 'GET') {
      const sports = String(url.searchParams.get('sports') || '').split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);
      try { return json(res, 200, await getLiveScores({ sports: sports.length ? sports : undefined })); }
      catch (e) { return json(res, 502, { provider: 'ESPN', games: [], errors: [e?.message || 'Live scores unavailable'] }); }
    }
    if (url.pathname === '/api/live/player' && req.method === 'GET') {
      const sport = String(url.searchParams.get('sport') || '').toUpperCase(), player = String(url.searchParams.get('name') || '').trim().slice(0, 120);
      try { return json(res, 200, await findLivePlayer({ sport, player })); }
      catch (e) { return json(res, 502, { supported: Boolean(LIVE_SPORTS[sport]), live: false, player: null, message: e?.message || 'Live player data unavailable' }); }
    }
  }
  if (await serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
});

server.listen(port, () => {
  console.log(`AutoProp Scout Pro Friends v6 running on http://localhost:${port}`);
  console.log('Auth: owner + invite-gated multi-user accounts');
  console.log('PickFinder: one encrypted session per user');
  console.log(`All Props Live: cached board refresh every ~${boardRefreshSeconds}s while user is active`);
  console.log(`Owner setup code: ${ownerUnlockCode ? 'configured' : 'MISSING'}`);
  console.log(`Live sports: ${Object.keys(LIVE_SPORTS).join(', ')}`);
});

if (intervalMinutes > 0) setInterval(async () => {
  for (const user of await listUsers()) {
    if (activeScans >= maxConcurrentScans) break;
    const c = await connectionState(user.id);
    if (c?.configured && c?.sessionSaved && !stateFor(user.id).running) scanNow(user.id).catch(console.error);
  }
}, intervalMinutes * 60000).unref();

setInterval(async () => {
  const now = Date.now();
  for (const user of await listUsers()) {
    const bs = boardStateFor(user.id);
    if (!bs.lastRequestedAt || now - bs.lastRequestedAt > boardActiveWindowMs) continue;
    if (bs.refreshing || stateFor(user.id).running || activeBoardPulls >= maxConcurrentBoardPulls) continue;
    const cache = await readJson(boardFile(user.id), null);
    if (!cache || boardAgeMs(cache) >= boardFreshMs) refreshBoard(user.id).catch(() => {});
  }
}, Math.max(10_000, Math.floor(boardFreshMs / 3))).unref();
