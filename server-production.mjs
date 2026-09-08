import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from './scanner/index.mjs';
import { getPickFinderConnectionState } from './scanner/secure-store.mjs';
import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from './scanner/rules.mjs';
import { paypalConfig, createPayPalOrder, capturePayPalOrder } from './payments/paypal.mjs';
import { searchLiveProps, scanLiveProp } from './scanner/focused.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const latestPath = path.join(dataDir, 'latest.json');
const historyPath = path.join(dataDir, 'history.json');
const rulesPath = path.join(dataDir, 'rules.json');
const lastErrorPath = path.join(dataDir, 'last-error.json');
const paymentsPath = path.join(dataDir, 'payments.json');
const port = Number(process.env.PORT || 3000);
const intervalMinutes = Math.max(0, Number(process.env.AUTO_SCAN_MINUTES || 30));
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const dashboardSessionSecret = process.env.DASHBOARD_SESSION_SECRET || crypto.createHash('sha256').update(`autoprop:${dashboardPassword || 'local-only'}`).digest('hex');
const authRequired = Boolean(dashboardPassword);

await fs.mkdir(dataDir, { recursive: true });

let running = false;
let lastError = null;
let scanProgress = { stage: 'idle', message: 'Ready', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: null, updatedAt: new Date().toISOString() };
const focusedSearchCache = new Map();
const rateBuckets = new Map();

async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }
async function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
async function loadRules() {
  const stored = await readJson(rulesPath, null);
  return normalizeRules(stored || DEFAULT_RULES);
}
async function saveRules(value) {
  const normalized = normalizeRules(value);
  await atomicJson(rulesPath, normalized);
  return normalized;
}
async function saveResult(result) {
  await atomicJson(latestPath, result);
  const history = await readJson(historyPath, []);
  history.unshift({
    scannedAt: result.scannedAt,
    mode: result.mode,
    scannerVersion: result.scannerVersion || null,
    totalReviewed: result.totalReviewed,
    qualifiedCount: result.qualifiedCount,
    rejectedCount: result.rejectedCount,
    bestAvailableCount: result.bestAvailable?.length || 0,
    greenGoblinCount: result.greenGoblins?.length || 0,
    redGoblinCount: result.redGoblins?.length || 0,
    appCount: (result.appInventory || []).filter((row) => row.available).length,
    bestConfidence: Math.max(0, ...(result.picks || []).filter((p) => p.qualified).map((p) => Number(p.confidence) || 0)),
    rulesApplied: result.rulesApplied || null,
  });
  await atomicJson(historyPath, history.slice(0, 100));
}
function updateProgress(next) { scanProgress = { ...scanProgress, ...next, updatedAt: new Date().toISOString() }; }
function friendlyScanError(error) {
  const message = error?.message || String(error);
  if (/invalid or unexpected token|unexpected token/i.test(message)) return 'Saved PickFinder connection data could not be read. Reconnect PickFinder and run the scan again.';
  if (/sign in to unlock|locked/i.test(message)) return 'PickFinder is not fully unlocked. Open Manage PickFinder and reconnect the account.';
  return message;
}
async function scanNow() {
  if (running) return { ok: false, message: 'A scan is already running.' };
  running = true;
  lastError = null;
  updateProgress({ stage: 'starting', message: 'Starting live multi-book scan', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: new Date().toISOString() });
  try {
    const rules = await loadRules();
    const result = await runScan({ onProgress: updateProgress, rules });
    await saveResult(result);
    updateProgress({ stage: 'complete', message: result.qualifiedCount ? `Scan complete — ${result.qualifiedCount} qualified` : `Scan complete — ${result.bestAvailable?.length || 0} Best Available`, reviewed: result.totalReviewed, total: result.totalReviewed, currentPlayer: null, qualifiedSoFar: result.qualifiedCount });
    await fs.rm(lastErrorPath, { force: true }).catch(() => {});
    return { ok: true, result };
  } catch (error) {
    lastError = friendlyScanError(error);
    const diagnostic = { at: new Date().toISOString(), message: lastError, rawMessage: error?.message || String(error), code: error?.code || null, stack: error?.stack || null };
    console.error('[AutoProp scan error]', diagnostic.stack || diagnostic.rawMessage);
    await atomicJson(lastErrorPath, diagnostic).catch(() => {});
    updateProgress({ stage: 'error', message: lastError, currentPlayer: null });
    return { ok: false, message: lastError, code: error?.code || null };
  } finally { running = false; }
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'content-length': Buffer.byteLength(body), 'x-content-type-options': 'nosniff', ...extraHeaders });
  res.end(body);
}
function parseCookies(req) {
  const pairs = String(req.headers.cookie || '').split(';'); const cookies = {};
  for (const pair of pairs) { const index = pair.indexOf('='); if (index < 0) continue; cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim()); }
  return cookies;
}
function safeEqual(a, b) { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function makeAuthToken() {
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; const payload = `owner.${expires}`;
  const signature = crypto.createHmac('sha256', dashboardSessionSecret).update(payload).digest('base64url'); return `${payload}.${signature}`;
}
function authTokenValid(token) {
  if (!token) return false; const parts = String(token).split('.'); if (parts.length !== 3 || parts[0] !== 'owner') return false;
  const expires = Number(parts[1]); if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const payload = `${parts[0]}.${parts[1]}`; const expected = crypto.createHmac('sha256', dashboardSessionSecret).update(payload).digest('base64url');
  return safeEqual(parts[2], expected);
}
function isAuthorized(req) { if (!authRequired) return true; return authTokenValid(parseCookies(req).aps_session); }
function sameOrigin(req) {
  const origin = req.headers.origin; if (!origin) return true;
  try { const parsed = new URL(origin); const host = String(req.headers['x-forwarded-host'] || req.headers.host || ''); return parsed.host === host; } catch { return false; }
}
async function readJsonBody(req, limit = 32_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request body is too large.'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON request.'); }
}
function cookieHeader(req, token) { const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'; return `aps_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`; }
function clearCookieHeader(req) { const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'; return `aps_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`; }
function clientKey(req, bucket) { return `${bucket}:${String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()}`; }
function allowRate(req, bucket, max, windowMs) {
  const key = clientKey(req, bucket); const now = Date.now(); const rows = (rateBuckets.get(key) || []).filter((time) => now - time < windowMs);
  if (rows.length >= max) { rateBuckets.set(key, rows); return false; }
  rows.push(now); rateBuckets.set(key, rows); return true;
}
function cacheSearchResults(rows) {
  const now = Date.now();
  for (const [id, entry] of focusedSearchCache) if (now - entry.at > 20 * 60 * 1000) focusedSearchCache.delete(id);
  for (const row of rows) focusedSearchCache.set(row.id, { at: now, selection: row });
}
async function recordPayment(capture) {
  const rows = await readJson(paymentsPath, []);
  const purchase = capture?.purchase_units?.[0]?.payments?.captures?.[0];
  rows.unshift({ orderId: capture?.id || null, status: capture?.status || null, captureId: purchase?.id || null, amount: purchase?.amount || null, payerEmail: capture?.payer?.email_address || null, capturedAt: new Date().toISOString() });
  await atomicJson(paymentsPath, rows.slice(0, 1000));
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; if (pathname === '/') pathname = '/index.html';
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, ''); const file = path.join(publicDir, normalized); if (!file.startsWith(publicDir)) return false;
  try {
    const stat = await fs.stat(file); if (!stat.isFile()) return false; const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'cache-control': pathname.endsWith('.html') ? 'no-store' : 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://www.paypal.com; script-src 'self' https://www.paypal.com https://www.paypalobjects.com; img-src 'self' data: https://www.paypalobjects.com https://www.paypal.com; connect-src 'self' https://www.paypal.com https://api-m.paypal.com https://api-m.sandbox.paypal.com; frame-src https://www.paypal.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://www.paypal.com",
    });
    res.end(body); return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, { required: authRequired, authenticated: isAuthorized(req) });

  if (url.pathname === '/api/payments/config' && req.method === 'GET') {
    const config = paypalConfig();
    return json(res, 200, { enabled: config.enabled, clientId: config.clientId, price: config.price, currency: config.currency, productName: config.productName, environment: config.environment, cardFieldsRequested: config.cardFieldsRequested });
  }
  if (url.pathname === '/api/payments/create-order' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'paypal-create', 20, 10 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many checkout attempts. Try again later.' });
    try { const order = await createPayPalOrder(); return json(res, 200, { id: order.id, status: order.status }); }
    catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }
  if (url.pathname === '/api/payments/capture-order' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'paypal-capture', 30, 10 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many payment attempts. Try again later.' });
    try { const body = await readJsonBody(req, 8_000); const capture = await capturePayPalOrder(body.orderId); if (capture?.status === 'COMPLETED') await recordPayment(capture); return json(res, 200, { ok: capture?.status === 'COMPLETED', order: capture }); }
    catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'dashboard-login', 12, 15 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Too many login attempts. Try again later.' });
    if (!authRequired) return json(res, 200, { ok: true, authenticated: true });
    try { const body = await readJsonBody(req, 8_000); if (!safeEqual(body.password || '', dashboardPassword)) return json(res, 401, { ok: false, message: 'Incorrect dashboard password.' }); return json(res, 200, { ok: true, authenticated: true }, { 'set-cookie': cookieHeader(req, makeAuthToken()) }); }
    catch (error) { return json(res, 400, { ok: false, message: error.message }); }
  }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') { if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' }); return json(res, 200, { ok: true }, { 'set-cookie': clearCookieHeader(req) }); }
  if (url.pathname.startsWith('/api/') && !isAuthorized(req)) return json(res, 401, { ok: false, message: 'Dashboard authentication required.', authRequired: true });

  if (url.pathname === '/api/status' && req.method === 'GET') {
    const latest = await readJson(latestPath, null);
    const connection = await getPickFinderConnectionState();
    const rules = await loadRules();
    const payment = paypalConfig();
    return json(res, 200, { running, lastError, connection, rules, demoMode: false, autoScanMinutes: intervalMinutes, payoutMultiplier: process.env.PAYOUT_MULTIPLIER || null, paymentConfigured: payment.enabled, scannerVersion: 'masterpiece-2', progress: scanProgress, latest });
  }
  if (url.pathname === '/api/history' && req.method === 'GET') return json(res, 200, await readJson(historyPath, []));
  if (url.pathname === '/api/rules' && req.method === 'GET') return json(res, 200, { rules: await loadRules(), presets: RULE_PRESETS, locked: { verifiedSourcesOnly: true, todayOnly: true, lineTypes: ['REGULAR', 'GREEN_GOBLIN', 'RED_GOBLIN'], allPickFinderApps: true } });
  if (url.pathname === '/api/rules' && req.method === 'PUT') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before changing rules.' });
    try { const body = await readJsonBody(req, 16_000); return json(res, 200, { ok: true, rules: await saveRules(body.rules || body), locked: { verifiedSourcesOnly: true, todayOnly: true, lineTypes: ['REGULAR', 'GREEN_GOBLIN', 'RED_GOBLIN'], allPickFinderApps: true } }); }
    catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }
  if (url.pathname === '/api/connect' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before changing the PickFinder connection.' });
    try { const body = await readJsonBody(req, 16_000); const { verifyPickFinderConnection } = await import('./scanner/production.mjs'); const result = await verifyPickFinderConnection({ email: body.email, password: body.password }); return json(res, 200, { ok: true, connection: result }); }
    catch (error) { return json(res, 400, { ok: false, message: friendlyScanError(error), code: error?.code || null }); }
  }
  if (url.pathname === '/api/disconnect' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before disconnecting.' });
    try { const { disconnectPickFinder } = await import('./scanner/production.mjs'); return json(res, 200, { ok: true, connection: await disconnectPickFinder() }); }
    catch (error) { return json(res, 500, { ok: false, message: friendlyScanError(error) }); }
  }
  if (url.pathname === '/api/scan' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'full-scan', 6, 15 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Full scan rate limit reached. Try again shortly.' });
    if (running) return json(res, 409, { ok: false, message: 'A scan is already running.' });
    scanNow().catch((error) => console.error('[scanNow uncaught]', error));
    return json(res, 202, { ok: true, message: 'Masterpiece scan started.' });
  }
  if (url.pathname === '/api/prop-search' && req.method === 'GET') {
    if (!allowRate(req, 'prop-search', 30, 10 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Search rate limit reached. Try again shortly.' });
    try { const result = await searchLiveProps(url.searchParams.get('q') || ''); cacheSearchResults(result.results || []); return json(res, 200, result); }
    catch (error) { return json(res, 400, { ok: false, message: friendlyScanError(error) }); }
  }
  if (url.pathname === '/api/scan-prop' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (!allowRate(req, 'focused-scan', 20, 15 * 60 * 1000)) return json(res, 429, { ok: false, message: 'Focused scan rate limit reached. Try again shortly.' });
    try {
      const body = await readJsonBody(req, 8_000);
      const cached = focusedSearchCache.get(String(body.id || ''));
      if (!cached || Date.now() - cached.at > 20 * 60 * 1000) return json(res, 400, { ok: false, message: 'Search for this prop again before scanning it.' });
      const result = await scanLiveProp(cached.selection);
      return json(res, 200, { ok: true, ...result });
    } catch (error) { return json(res, 400, { ok: false, message: friendlyScanError(error) }); }
  }

  if (await serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found');
});

server.listen(port, () => {
  console.log(`AutoProp Scout Pro production server running on http://localhost:${port}`);
  console.log('Mode: live');
  console.log('Scanner: masterpiece-2');
  console.log(`Dashboard gate: ${authRequired ? 'enabled' : 'disabled'}`);
  console.log(`PayPal checkout: ${paypalConfig().enabled ? 'configured' : 'waiting for merchant credentials/price'}`);
});
if (intervalMinutes > 0) setInterval(() => { if (!running) scanNow().catch((error) => console.error('[auto scan uncaught]', error)); }, intervalMinutes * 60 * 1000).unref();
