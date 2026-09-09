import http from 'node:http';
import { spawn } from 'node:child_process';

const FRONT_PORT = Number(process.env.PORT || 3000);
const SCOUT_PORT = 3002;
const APEX_PORT = 3001;

function child(file, port, label) {
  const proc = spawn(process.execPath, [file], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  proc.on('exit', (code, signal) => {
    console.error(`[frontdoor] ${label} exited`, { code, signal });
    process.exit(code || 1);
  });
  return proc;
}

const scout = child('server-scout.mjs', SCOUT_PORT, 'Scout Pro');
const apex = child('apex-live/server-prod.mjs', APEX_PORT, 'Apex Props');

function target(url = '/') {
  if (url === '/apex' || url.startsWith('/apex/')) return { port: APEX_PORT, path: url };
  if (url === '/api/apex' || url.startsWith('/api/apex/')) return { port: APEX_PORT, path: url };
  return { port: SCOUT_PORT, path: url };
}

const server = http.createServer((req, res) => {
  const dst = target(req.url || '/');
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: dst.port,
    path: dst.path,
    method: req.method,
    headers: { ...req.headers, host: req.headers.host || 'localhost' },
  }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', (error) => {
    console.error('[frontdoor] proxy failure', error?.message || error);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Application upstream unavailable.' }));
  });
  req.pipe(proxy);
});

server.listen(FRONT_PORT, '0.0.0.0', () => {
  console.log(`Production frontdoor listening on 0.0.0.0:${FRONT_PORT}; Scout=${SCOUT_PORT}; Apex=${APEX_PORT}`);
});

function shutdown(signal) {
  scout.kill(signal);
  apex.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
