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
import { generateAccessCode, listAccessCodes, revokeAccessCode } from './access-codes.mjs';
import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from './scanner/rules.mjs';
import { findLivePlayer, getLiveScores, LIVE_SPORTS } from './providers/live-sports.mjs';
import { paypalConfig, createPayPalOrder, capturePayPalOrder } from './payments/paypal.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const paymentsPath = path.join(dataDir, 'payments.json');
const port = Number(process.env.PORT || 3000);
const intervalMinutes = Math.max(0, Number(process.env.AUTO_SCAN_MINUTES || 30));
const maxConcurrentScans = Math.max(1, Math.min(6, Number(process.env.MAX_CONCURRENT_USER_SCANS || 2)));
const sessionDays = Math.max(1, Math.min(90, Number(process.env.SESSION_DAYS || 30)));
const sessionSecret = process.env.APP_SESSION_SECRET
  || process.env.DASHBOARD_SESSION_SECRET
  || crypto.createHash('sha256').update(`autoprop-v6:${process.env.AUTOPROP_MASTER_KEY || 'local'}`).digest('hex');
const ownerUnlockCode = String(process.env.OWNER_UNLOCK_CODE || '').trim();

await fs.mkdir(dataDir, { recursive: true });

const runtime = new Map();
const focusedCache = new Map();
const rateBuckets = new Map();
let activeScans = 0;

function stateFor(userId) {
  if (!runtime.has(userId)) {
    runtime.set(userId, {
      running: false,
      lastError: null,
      progress: {
        stage: 'idle', message: 'Ready', reviewed: 0, total: 0,
        qualifiedSoFar: 0, currentPlayer: null, startedAt: null,
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return runtime.get(userId);
}

function stateDir(id) { return path.join(userDataDir(id), 'state'); }
function pickFinderDir(id) { return path.join(userDataDir(id), 'pickfinder'); }
function stateFile(id, name) { return path.join(stateDir(id), name); }

async function ensureDirs(id) {
  await Promise.all([
    fs.mkdir(stateDir(id), { recursive: true, mode: 0o700 }),
    fs.mkdir(pickFinderDir(id), { recursive: true, mode: 0o700 }),
  ]);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

async function loadRules(id) {
  return normalizeRules(await readJson(stateFile(id, 'rules.json'), DEFAULT_RULES));
}

async function saveRules(id, value) {
  const rules = normalizeRules(value);
  await atomicJson(stateFile(id, 'rules.json'), rules);
  return rules;
}

function validPick(pick) {
  const player = String(pick?.player || '').trim();
  const sport = String(pick?.sport || '').trim().toUpperCase();
  return Boolean(
    player
    && !/^(pickfinder|unknown|unknown player)$/i.test(player)
    && sport
    && sport !== 'UNKNOWN'
    && pick?.prop
    && Number.isFinite(Number(pick?.line))
    && ['OVER', 'UNDER'].includes(String(pick?.pick || '').toUpperCase())
  );
}

function sanitizeResult(raw = {}) {
  const source = Array.isArray(raw.picks) ? raw.picks : [];
  const picks = source.filter(validPick);
  const ids = new Set(picks.map((pick) => pick.id || pick.sourceUrl).filter(Boolean));
  const keep = (pick) => validPick(pick) && (!(pick.id || pick.sourceUrl) || ids.has(pick.id || pick.sourceUrl));
  const qualified = picks.filter((pick) => pick.qualified);
  const suppressed = source.length - picks.length;
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
    suppressedMalformedCount: suppressed,
    warnings: [
      ...(raw.warnings || []),
      ...(suppressed ? [`${suppressed} malformed scraper record${suppressed === 1 ? '' : 's'} hidden automatically.`] : []),
    ],
  };
}

async function saveResult(id, raw) {
  const result = sanitizeResult(raw);
  await atomicJson(stateFile(id, 'latest.json'), result);
  const history = await readJson(stateFile(id, 'history.json'), []);
  history.unshift({
    scannedAt: result.scannedAt,
    scannerVersion: result.scannerVersion || 'friends-v6',
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
  const message = error?.message || String(error);
  if (/captcha|interactive verification|two.factor|2fa/i.test(message)) {
    return 'PickFinder requires an interactive verification step. Complete it on PickFinder, then reconnect.';
  }
  if (/invalid credentials|rejected the email|password/i.test(message)) return 'PickFinder rejected that email or password.';
  if (/reconnect|not unlocked|still locked|sign in to unlock/i.test(message)) {
    return 'PickFinder is not unlocked for this account. Reconnect your own PickFinder account.';
  }
  if (/unexpected token|decrypt|unreadable/i.test(message)) return 'Saved PickFinder session data is unreadable. Reconnect this account.';
  return message.length > 280 ? 'AutoProp could not complete that request. Please retry.' : message;
}

function runWorker(id, action, payload = {}, onProgress = null, timeoutMs = 12 * 60 * 1000) {
  return new Promise(async (resolve, reject) => {
    await ensureDirs(id);
    const child = spawn(process.execPath, ['scanner/user-worker.mjs', action], {
      cwd: __dirname,
      env: { ...process.env, DATA_DIR: pickFinderDir(id) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let value;
    let workerError;
    let done = false;

    const finish = (fn, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(result);
    };

    const parse = () => {
      let index;
      while ((index = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, index).trim();
        out = out.slice(index + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'progress') onProgress?.(event.data || {});
          if (event.type === 'result') value = event.data;
          if (event.type === 'error') workerError = event.data;
        } catch {}
      }
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, Object.assign(new Error('PickFinder worker timed out safely.'), { code: 'PICKFINDER_TIMEOUT' }));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { out += chunk.toString(); parse(); });
    child.stderr.on('data', (chunk) => { err = (err + chunk.toString()).slice(-12000); });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      parse();
      if (code === 0 && value !== undefined) return finish(resolve, value);
      const error = new Error(workerError?.message || err.trim() || `Worker exited ${code}`);
      error.code = workerError?.code || null;
      finish(reject, error);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function connectionState(id) {
  try { return await runWorker(id, 'connection', {}, null, 30_000); }
  catch (error) { return { configured: false, sessionSaved: false, connectionError: friendly(error) }; }
}

async function scanNow(id) {
  const state = stateFor(id);
  if (state.running) return { ok: false, message: 'Your scan is already running.' };
  if (activeScans >= maxConcurrentScans) return { ok: false, message: 'Scanner capacity is busy.' };

  state.running = true;
  state.lastError = null;
  activeScans++;
  state.progress = {
    stage: 'starting', message: 'Starting your private PickFinder scan', reviewed: 0, total: 0,
    qualifiedSoFar: 0, currentPlayer: null, startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const rules = await loadRules(id);
    const raw = await runWorker(id, 'scan', { rules }, (progress) => {
      state.progress = { ...state.progress, ...progress, updatedAt: new Date().toISOString() };
    });
    const result = await saveResult(id, raw);
    state.progress = {
      ...state.progress,
      stage: 'complete',
      message: result.qualifiedCount
        ? `Scan complete — ${result.qualifiedCount} qualified`
        : `Scan complete — ${result.bestAvailable?.length || 0} Best Available`,
      reviewed: result.totalReviewed,
      total: result.totalReviewed,
      qualifiedSoFar: result.qualifiedCount,
      currentPlayer: null,
      updatedAt: new Date().toISOString(),
    };
    await fs.rm(stateFile(id, 'last-error.json'), { force: true }).catch(() => {});
    return { ok: true, result };
  } catch (error) {
    state.lastError = friendly(error);
    state.progress = { ...state.progress, stage: 'error', message: state.lastError, currentPlayer: null, updatedAt: new Date().toISOString() };
    await atomicJson(stateFile(id, 'last-error.json'), {
      at: new Date().toISOString(), message: state.lastError, code: error?.code || null,
    }).catch(() => {});
    return { ok: false, message: state.lastError };
  } finally {
    state.running = false;
    activeScans = Math.max(0, activeScans - 1);
  }
}

function parseCookies(req) {
  const out = {};
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const index = pair.indexOf('=');
    if (index >= 0) out[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

async function makeSession(id) {
  const version = await getUserSessionVersion(id);
  const expires = Date.now() + sessionDays * 86400_000;
  const nonce = crypto.randomBytes(8).toString('base64url');
  const payload = `v1.${id}.${expires}.${version}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

async function authUser(req) {
  const token = parseCookies(req).aps_user;
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 6 || parts[0] !== 'v1') return null;
  const payload = parts.slice(0, 5).join('.');
  if (!safeEqual(parts[5], sign(payload)) || Number(parts[2]) < Date.now()) return null;
  const user = await getUserById(parts[1]);
  if (!user || Number(parts[3]) !== await getUserSessionVersion(parts[1])) return null;
  return user;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || ''); }
  catch { return false; }
}

async function body(req, limit = 64_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON request.'); }
}

function json(res, status, payload, headers = {}) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

function cookie(req, token) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `aps_user=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDays * 86400}${secure ? '; Secure' : ''}`;
}

function clearCookie(req) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `aps_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function allow(req, bucket, max, windowMs, subject = '') {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const key = `${bucket}:${subject || ip}`;
  const now = Date.now();
  const rows = (rateBuckets.get(key) || []).filter((time) => now - time < windowMs);
  if (rows.length >= max) { rateBuckets.set(key, rows); return false; }
  rows.push(now);
  rateBuckets.set(key, rows);
  return true;
}

function cacheFocused(userId, rows) {
  const now = Date.now();
  for (const [key, entry] of focusedCache) {
    if (now - entry.at > 20 * 60 * 1000) focusedCache.delete(key);
  }
  for (const row of rows || []) {
    if (row?.id) focusedCache.set(`${userId}:${row.id}`, { at: now, selection: row });
  }
}

async function recordPayment(user, capture) {
  const rows = await readJson(paymentsPath, []);
  const purchase = capture?.purchase_units?.[0]?.payments?.captures?.[0];
  rows.unshift({
    userId: user?.id || null,
    autoPropEmail: user?.email || null,
    orderId: capture?.id || null,
    status: capture?.status || null,
    captureId: purchase?.id || null,
    amount: purchase?.amount || null,
    payerEmail: capture?.payer?.email_address || null,
    capturedAt: new Date().toISOString(),
  });
  await atomicJson(paymentsPath, rows.slice(0, 2000));
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index-v4.html';
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const file = path.join(publicDir, normalized);
  if (!file.startsWith(publicDir)) return false;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    let data = await fs.readFile(file);
    if (pathname === '/index-v4.html') {
      const text = data.toString('utf8').replace(
        '<script type="module" src="/app-v4.js"></script>',
        '<script src="/owner-tools.js"></script><script type="module" src="/app-v4.js"></script>',
      );
      data = Buffer.from(text);
    }
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'cache-control': pathname.endsWith('.html') ? 'no-store' : 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://www.paypal.com; script-src 'self' https://www.paypal.com https://www.paypalobjects.com; img-src 'self' data: https:; connect-src 'self' https://www.paypal.com https://api-m.paypal.com https://api-m.sandbox.paypal.com; frame-src https://www.paypal.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://www.paypal.com",
    });
    res.end(data);
    return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const user = await authUser(req);
    const users = await listUsers();
    const ownerExists = users.some((entry) => entry.role === 'owner');
    return json(res, 200, {
      required: true,
      authenticated: Boolean(user),
      user,
      role: user?.role || null,
      canGenerateAccessCodes: user?.role === 'owner',
      ownerSetupRequired: !ownerExists,
    });
  }

  if (url.pathname === '/api/payments/config' && req.method === 'GET') {
    const config = paypalConfig();
    return json(res, 200, {
      enabled: config.enabled, clientId: config.clientId, price: config.price,
      currency: config.currency, productName: config.productName,
      environment: config.environment, cardFieldsRequested: config.cardFieldsRequested,
    });
  }

  if (url.pathname === '/api/payments/create-order' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allow(req, 'paypal-create', 20, 10 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many checkout attempts. Try again later.' });
    try {
      const order = await createPayPalOrder();
      return json(res, 200, { id: order.id, status: order.status });
    } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }

  if (url.pathname === '/api/payments/capture-order' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allow(req, 'paypal-capture', 30, 10 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many payment attempts. Try again later.' });
    try {
      const requestBody = await body(req, 8_000);
      const capture = await capturePayPalOrder(requestBody.orderId);
      if (capture?.status === 'COMPLETED') await recordPayment(await authUser(req), capture);
      return json(res, 200, { ok: capture?.status === 'COMPLETED', order: capture });
    } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }

  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allow(req, 'register', 10, 30 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many account attempts. Try again later.' });
    try {
      const requestBody = await body(req, 16_000);
      const users = await listUsers();
      const ownerExists = users.some((entry) => entry.role === 'owner');
      let user;
      if (!ownerExists) {
        if (!ownerUnlockCode) return json(res, 503, { ok: false, message: 'Owner setup is not configured yet.' });
        if (!safeEqual(requestBody.accessCode || '', ownerUnlockCode)) {
          return json(res, 403, { ok: false, message: 'The owner setup code is required for the first AutoProp account.' });
        }
        user = await registerUser({ email: requestBody.email, password: requestBody.password });
      } else {
        user = await registerUser({
          email: requestBody.email,
          password: requestBody.password,
          accessCode: requestBody.accessCode,
        });
      }
      return json(res, 201, { ok: true, authenticated: true, user }, { 'set-cookie': cookie(req, await makeSession(user.id)) });
    } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allow(req, 'login', 15, 15 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many login attempts.' });
    try {
      const requestBody = await body(req, 16_000);
      const user = await authenticateUser(requestBody);
      if (!user) return json(res, 401, { ok: false, message: 'Incorrect AutoProp email or password.' });
      return json(res, 200, { ok: true, authenticated: true, user }, { 'set-cookie': cookie(req, await makeSession(user.id)) });
    } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookie(req) });
  }

  if (url.pathname.startsWith('/api/')) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: 'Sign in to your AutoProp account.', authRequired: true });
    const id = user.id;
    await ensureDirs(id);
    const state = stateFor(id);

    if (url.pathname === '/api/access-codes/generate' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (user.role !== 'owner') return json(res, 403, { ok: false, message: 'Owner access required.' });
      if (!allow(req, 'codes', 30, 60 * 60 * 1000, id)) return json(res, 429, { ok: false, message: 'Code generation limit reached.' });
      try {
        const requestBody = await body(req, 8_000);
        return json(res, 200, { ok: true, ...await generateAccessCode({
          label: requestBody.label,
          expiresInDays: requestBody.expiresInDays,
          maxUses: requestBody.maxUses,
        }) });
      } catch { return json(res, 500, { ok: false, message: 'Could not generate code.' }); }
    }

    if (url.pathname === '/api/access-codes' && req.method === 'GET') {
      if (user.role !== 'owner') return json(res, 403, { ok: false, message: 'Owner access required.' });
      return json(res, 200, { codes: await listAccessCodes() });
    }

    if (url.pathname === '/api/access-codes/revoke' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (user.role !== 'owner') return json(res, 403, { ok: false, message: 'Owner access required.' });
      try {
        const requestBody = await body(req, 8_000);
        const code = await revokeAccessCode(requestBody.id);
        return code ? json(res, 200, { ok: true, code }) : json(res, 404, { ok: false, message: 'Code not found.' });
      } catch { return json(res, 400, { ok: false, message: 'Could not revoke code.' }); }
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const [latest, connection, rules] = await Promise.all([
        readJson(stateFile(id, 'latest.json'), null), connectionState(id), loadRules(id),
      ]);
      return json(res, 200, {
        user,
        running: state.running,
        lastError: state.lastError,
        connection,
        rules,
        progress: state.progress,
        demoMode: false,
        autoScanMinutes: intervalMinutes,
        liveSports: Object.keys(LIVE_SPORTS),
        paymentConfigured: paypalConfig().enabled,
        scannerVersion: 'friends-v6-unified',
        latest,
      });
    }

    if (url.pathname === '/api/history' && req.method === 'GET') {
      return json(res, 200, await readJson(stateFile(id, 'history.json'), []));
    }

    if (url.pathname === '/api/rules' && req.method === 'GET') {
      return json(res, 200, {
        rules: await loadRules(id),
        presets: RULE_PRESETS,
        locked: {
          verifiedSourcesOnly: true,
          todayOnly: true,
          lineTypes: ['REGULAR', 'GREEN_GOBLIN', 'RED_GOBLIN'],
          allPickFinderApps: true,
        },
      });
    }

    if (url.pathname === '/api/rules' && req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Wait for your scan to finish.' });
      try {
        const requestBody = await body(req, 16_000);
        return json(res, 200, { ok: true, rules: await saveRules(id, requestBody.rules || requestBody) });
      } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
    }

    if (url.pathname === '/api/connect' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Wait for your scan to finish.' });
      try {
        const requestBody = await body(req, 20_000);
        const connection = await runWorker(id, 'connect', {
          email: requestBody.email,
          password: requestBody.password,
        }, (progress) => {
          state.progress = { ...state.progress, ...progress, updatedAt: new Date().toISOString() };
        }, 150_000);
        await Promise.all([
          fs.rm(stateFile(id, 'latest.json'), { force: true }),
          fs.rm(stateFile(id, 'history.json'), { force: true }),
          fs.rm(stateFile(id, 'last-error.json'), { force: true }),
        ]).catch(() => {});
        state.lastError = null;
        return json(res, 200, { ok: true, connection });
      } catch (error) { return json(res, 400, { ok: false, message: friendly(error), code: error?.code || null }); }
    }

    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Wait for your scan to finish.' });
      try {
        const connection = await runWorker(id, 'disconnect', {}, null, 30_000);
        await Promise.all([
          fs.rm(stateFile(id, 'latest.json'), { force: true }),
          fs.rm(stateFile(id, 'history.json'), { force: true }),
        ]).catch(() => {});
        return json(res, 200, { ok: true, connection });
      } catch (error) { return json(res, 500, { ok: false, message: friendly(error) }); }
    }

    if (url.pathname === '/api/scan' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (!allow(req, 'scan', 8, 15 * 60 * 1000, id)) return json(res, 429, { ok: false, message: 'Scan rate limit reached.' });
      if (state.running) return json(res, 409, { ok: false, message: 'Your scan is already running.' });
      if (activeScans >= maxConcurrentScans) return json(res, 429, { ok: false, message: 'Scanner capacity is busy.' });
      scanNow(id).catch((error) => console.error('[scan]', error));
      return json(res, 202, { ok: true, message: 'Your private scan started.' });
    }

    if (url.pathname === '/api/prop-search' && req.method === 'GET') {
      if (!allow(req, 'prop-search', 40, 10 * 60 * 1000, id)) return json(res, 429, { ok: false, message: 'Search rate limit reached.' });
      const query = String(url.searchParams.get('q') || '').trim().slice(0, 120);
      try {
        const result = await runWorker(id, 'search', { query }, null, 90_000);
        cacheFocused(id, result?.results || []);
        return json(res, 200, result);
      } catch (error) { return json(res, 400, { ok: false, message: friendly(error), results: [] }); }
    }

    if (url.pathname === '/api/scan-prop' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      if (!allow(req, 'focused-scan', 24, 15 * 60 * 1000, id)) return json(res, 429, { ok: false, message: 'Focused scan rate limit reached.' });
      try {
        const requestBody = await body(req, 8_000);
        const cached = focusedCache.get(`${id}:${requestBody.id}`);
        if (!cached || Date.now() - cached.at > 20 * 60 * 1000) {
          return json(res, 400, { ok: false, message: 'Search for this prop again first.' });
        }
        return json(res, 200, {
          ok: true,
          ...await runWorker(id, 'scan-prop', { selection: cached.selection }, null, 120_000),
        });
      } catch (error) { return json(res, 400, { ok: false, message: friendly(error) }); }
    }

    if (url.pathname === '/api/live/scores' && req.method === 'GET') {
      const sports = String(url.searchParams.get('sports') || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
      try { return json(res, 200, await getLiveScores({ sports: sports.length ? sports : undefined })); }
      catch (error) { return json(res, 502, { provider: 'ESPN', games: [], errors: [error?.message || 'Live scores unavailable'] }); }
    }

    if (url.pathname === '/api/live/player' && req.method === 'GET') {
      const sport = String(url.searchParams.get('sport') || '').toUpperCase();
      const player = String(url.searchParams.get('name') || '').trim().slice(0, 120);
      if (!sport || !player) return json(res, 400, { ok: false, message: 'sport and name are required.' });
      try { return json(res, 200, await findLivePlayer({ sport, player })); }
      catch (error) {
        return json(res, 502, {
          supported: Boolean(LIVE_SPORTS[sport]), live: false, player: null,
          message: error?.message || 'Live player data unavailable',
        });
      }
    }
  }

  if (await serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`AutoProp Scout Pro Friends v6 running on http://localhost:${port}`);
  console.log('Auth: owner bootstrap + invite-gated multi-user accounts');
  console.log('PickFinder: one encrypted session per AutoProp user');
  console.log(`Owner setup code: ${ownerUnlockCode ? 'configured' : 'MISSING'}`);
  console.log(`Live sports: ${Object.keys(LIVE_SPORTS).join(', ')}`);
  console.log(`PayPal: ${paypalConfig().enabled ? 'configured' : 'routes ready; merchant configuration not set'}`);
});

if (intervalMinutes > 0) {
  setInterval(async () => {
    for (const user of await listUsers()) {
      if (activeScans >= maxConcurrentScans) break;
      if (stateFor(user.id).running) continue;
      const connection = await connectionState(user.id);
      if (!connection?.configured || !connection?.sessionSaved) continue;
      scanNow(user.id).catch((error) => console.error('[scheduled scan]', user.id, error));
    }
  }, intervalMinutes * 60_000).unref();
}
