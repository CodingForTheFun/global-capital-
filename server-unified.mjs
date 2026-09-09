import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { userDataDir } from './auth/user-store.mjs';
import { bootstrapProviders } from './lib/data-sources/bootstrap.mjs';
import { handlePropRoutes } from './lib/props/routes.mjs';

// Keep friends-v6 as the source of truth for authentication, PickFinder sessions,
// full-board loading and all existing UI/API behavior. This gateway adds the
// normalized/enriched prop APIs without replacing or weakening that server.
const publicPort = Number(process.env.PORT || 3000);
const internalPort = Number(process.env.AUTOPROP_INTERNAL_PORT || (publicPort + 137));
const internalHost = '127.0.0.1';
const upstream = `http://${internalHost}:${internalPort}`;

bootstrapProviders();

const child = spawn(process.execPath, ['server-v6.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(internalPort), AUTOPROP_UNIFIED_CHILD: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

child.on('error', (error) => {
  console.error('[AutoProp unified] friends-v6 child failed to start', error?.message || error);
});
child.on('exit', (code, signal) => {
  console.error('[AutoProp unified] friends-v6 child exited', JSON.stringify({ code, signal }));
  if (!server.listening) process.exitCode = code || 1;
});

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function forwardedHeaders(req) {
  const headers = { ...req.headers };
  const originalHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  headers.host = `${internalHost}:${internalPort}`;
  if (originalHost) headers['x-forwarded-host'] = originalHost;
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'https';
  return headers;
}

async function authenticatedUser(req) {
  try {
    const response = await fetch(`${upstream}/api/auth/status`, {
      method: 'GET',
      headers: forwardedHeaders(req),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.authenticated && data?.user?.id ? data.user : null;
  } catch {
    return null;
  }
}

async function latestPropPopulation(userId) {
  const dir = path.join(userDataDir(userId), 'state');
  // The full PickFinder board is the primary universe. This is what makes
  // /api/props genuinely ALL PROPS rather than only the rules-qualified scan.
  const board = await readJson(path.join(dir, 'board-live.json'), null);
  if (board && Array.isArray(board.picks)) return board;
  // Graceful first-load fallback while the private board cache is warming.
  return await readJson(path.join(dir, 'latest.json'), { scannedAt: null, picks: [] });
}

function proxyToFriends(req, res) {
  const options = {
    hostname: internalHost,
    port: internalPort,
    method: req.method,
    path: req.url,
    headers: forwardedHeaders(req),
  };
  const upstreamReq = http.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstreamReq.on('error', () => {
    if (!res.headersSent) json(res, 503, { ok: false, message: 'Scout Pro is starting. Please retry in a moment.' });
    else res.end();
  });
  req.pipe(upstreamReq);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const isPropApi = url.pathname.startsWith('/api/props') || url.pathname === '/api/providers';

  if (!isPropApi) {
    proxyToFriends(req, res);
    return;
  }

  // All enriched prop/provider endpoints are private and inherit friends-v6 auth.
  const user = await authenticatedUser(req);
  if (!user) {
    json(res, 401, { ok: false, message: 'Sign in to your AutoProp account first.' });
    return;
  }

  const handled = await handlePropRoutes(req, res, url, {
    readLatest: () => latestPropPopulation(user.id),
    json,
    log: console,
  });
  if (!handled) json(res, 404, { ok: false, message: 'Not found.' });
});

server.listen(publicPort, '0.0.0.0', () => {
  console.log(`[AutoProp unified] listening on :${publicPort}; friends-v6 internal :${internalPort}`);
});

function shutdown(signal) {
  try { child.kill(signal); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
