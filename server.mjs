import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from './scanner/index.mjs';
import { getPickFinderConnectionState } from './scanner/secure-store.mjs';
import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from './scanner/rules.mjs';
import { handleAuthRequest, requireUser } from './auth/routes.mjs';
import { supabaseConfig } from './db/supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const latestPath = path.join(dataDir, 'latest.json');
const historyPath = path.join(dataDir, 'history.json');
const rulesPath = path.join(dataDir, 'rules.json');
const lastErrorPath = path.join(dataDir, 'last-error.json');
const port = Number(process.env.PORT || 3000);
const intervalMinutes = Math.max(0, Number(process.env.AUTO_SCAN_MINUTES || 30));

await fs.mkdir(dataDir, { recursive: true });

let running = false;
let lastError = null;
let scanProgress = { stage: 'idle', message: 'Ready', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: null, updatedAt: new Date().toISOString() };

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
    totalReviewed: result.totalReviewed,
    qualifiedCount: result.qualifiedCount,
    rejectedCount: result.rejectedCount,
    bestAvailableCount: result.bestAvailable?.length || 0,
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
  updateProgress({ stage: 'starting', message: 'Starting scan', reviewed: 0, total: 0, currentPlayer: null, qualifiedSoFar: 0, startedAt: new Date().toISOString() });
  try {
    const rules = await loadRules();
    const result = await runScan({ onProgress: updateProgress, rules });
    await saveResult(result);
    updateProgress({ stage: 'complete', message: result.qualifiedCount ? `Scan complete — ${result.qualifiedCount} qualified` : `Scan complete — ${result.bestAvailable?.length || 0} Best Available`, reviewed: result.totalReviewed, total: result.totalReviewed, currentPlayer: null, qualifiedSoFar: result.qualifiedCount });
    await fs.rm(lastErrorPath, { force: true }).catch(() => {});
    return { ok: true, result };
  } catch (error) {
    lastError = friendlyScanError(error);
    const diagnostic = {
      at: new Date().toISOString(),
      message: lastError,
      rawMessage: error?.message || String(error),
      code: error?.code || null,
      stack: error?.stack || null,
    };
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
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; if (pathname === '/') pathname = '/index.html';
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, ''); const file = path.join(publicDir, normalized); if (!file.startsWith(publicDir)) return false;
  try {
    const stat = await fs.stat(file); if (!stat.isFile()) return false; const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': pathname.endsWith('.html') ? 'no-store' : 'public, max-age=60', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    res.end(body); return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (await handleAuthRequest(req, res, url)) return;
  if (url.pathname.startsWith('/api/') && !(await requireUser(req, res))) return;

  if (url.pathname === '/api/status' && req.method === 'GET') {
    const latest = await readJson(latestPath, null);
    const connection = await getPickFinderConnectionState();
    const rules = await loadRules();
    return json(res, 200, { running, lastError, connection, rules, demoMode: String(process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true', autoScanMinutes: intervalMinutes, payoutMultiplier: process.env.PAYOUT_MULTIPLIER || null, progress: scanProgress, latest });
  }
  if (url.pathname === '/api/history' && req.method === 'GET') return json(res, 200, await readJson(historyPath, []));
  if (url.pathname === '/api/rules' && req.method === 'GET') return json(res, 200, { rules: await loadRules(), presets: RULE_PRESETS, locked: { prizePicksOnly: true, regularLinesOnly: true, todayOnly: true } });
  if (url.pathname === '/api/rules' && req.method === 'PUT') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before changing rules.' });
    try {
      const body = await readJsonBody(req, 16_000);
      const rules = await saveRules(body.rules || body);
      return json(res, 200, { ok: true, rules, locked: { prizePicksOnly: true, regularLinesOnly: true, todayOnly: true } });
    } catch (error) { return json(res, 400, { ok: false, message: error?.message || String(error) }); }
  }
  if (url.pathname === '/api/connect' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before changing the PickFinder connection.' });
    try {
      const body = await readJsonBody(req, 16_000);
      const { verifyPickFinderConnection } = await import('./scanner/pickfinder-v2.mjs');
      const result = await verifyPickFinderConnection({ email: body.email, password: body.password });
      return json(res, 200, { ok: true, connection: result });
    } catch (error) { return json(res, 400, { ok: false, message: friendlyScanError(error), code: error?.code || null }); }
  }
  if (url.pathname === '/api/disconnect' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'Wait for the current scan to finish before disconnecting.' });
    try { const { disconnectPickFinder } = await import('./scanner/pickfinder-v2.mjs'); return json(res, 200, { ok: true, connection: await disconnectPickFinder() }); }
    catch (error) { return json(res, 500, { ok: false, message: friendlyScanError(error) }); }
  }
  if (url.pathname === '/api/scan' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
    if (running) return json(res, 409, { ok: false, message: 'A scan is already running.' });
    scanNow().catch((error) => console.error('[scanNow uncaught]', error));
    return json(res, 202, { ok: true, message: 'Scan started.' });
  }

  if (await serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found');
});

server.listen(port, () => {
  console.log(`AutoProp Scout Pro running on http://localhost:${port}`);
  console.log(`Mode: ${String(process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true' ? 'demo' : 'live'}`);
  console.log(`Dashboard gate: Supabase accounts (${supabaseConfig().configured ? 'configured' : 'MISSING SUPABASE_URL / SUPABASE_ANON_KEY'})`);
});
if (intervalMinutes > 0) setInterval(() => { if (!running) scanNow().catch((error) => console.error('[auto scan uncaught]', error)); }, intervalMinutes * 60 * 1000).unref();
