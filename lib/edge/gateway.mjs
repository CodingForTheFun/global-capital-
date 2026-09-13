import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isSportsWorkspace, serveWorkspaceAsset } from './workspace-routes.mjs';

const NEXT_PORT = 3004;
const stylesheet = readFileSync(new URL('../../public/edge-theme.css', import.meta.url));
export function createEdgeGateway({ currentAccount, sessions }) {
  const cwd = path.resolve('apps/guest-dashboard');
  const guest = spawn(process.execPath, [path.join(cwd, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(NEXT_PORT)], {
    cwd, env: { ...process.env, PORT: String(NEXT_PORT), NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  let ready = false, stopping = false;
  const stop = signal => { stopping = true; guest.kill(signal); };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  guest.on('error', () => { console.error('[edge] guest process could not start'); if (!stopping) process.exit(1); });
  guest.on('exit', code => { ready = false; if (!stopping) { console.error('[edge] guest process exited', code); process.exit(1); } });
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${NEXT_PORT}/api/guest-health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { ready = true; clearInterval(timer); console.log('[edge] Next.js guest dashboard ready on internal port 3004'); }
    } catch {}
    if (!ready && Date.now() - started > 90000) { clearInterval(timer); console.error('[edge] guest startup timed out'); if (!stopping) process.exit(1); }
  }, 500);
  timer.unref();

  return async function handleEdge(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (serveWorkspaceAsset(req, res)) return true;
    if (url.pathname === '/assets/edge-theme.css' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : stylesheet); return true;
    }
    if (url.pathname === '/api/health' && !ready) {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'GUEST_STARTING' })); return true;
    }
    const publicRoute = isSportsWorkspace(url.pathname) || url.pathname === '/preview' || url.pathname === '/preview/' || url.pathname.startsWith('/_next/') || url.pathname === '/api/ask-prop' || url.pathname === '/api/guest-health';
    let guestHome = false;
    if (url.pathname === '/' && ['GET', 'HEAD'].includes(req.method)) {
      guestHome = true; // The sportsbook is the main application; Auto Scout stays at /apex.
    }
    if (!publicRoute && !guestHome) return false;
    if (!ready) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '3', 'cache-control': 'no-store' });
      res.end('The dashboard is starting. Please refresh shortly.'); return true;
    }
    const requestPath = url.pathname === '/preview/' ? '/preview' + url.search : req.url;
    const upstream = http.request({ hostname: '127.0.0.1', port: NEXT_PORT, path: requestPath, method: req.method,
      headers: { ...req.headers, host: req.headers.host || 'localhost', 'accept-encoding': 'identity' } }, response => {
      const headers = { ...response.headers };
      if (!url.pathname.startsWith('/_next/static/')) headers['cache-control'] = 'private, no-store, max-age=0';
      headers['x-content-type-options'] = 'nosniff';
      res.writeHead(response.statusCode || 502, headers); response.pipe(res);
      response.on('error', () => res.destroy());
    });
    upstream.setTimeout(35000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ code: 'GUEST_UNAVAILABLE', message: 'Guest dashboard temporarily unavailable.' })); });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
    return true;
  };
}
