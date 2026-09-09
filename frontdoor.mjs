import http from 'node:http';
import { spawn } from 'node:child_process';

const FRONT_PORT = Number(process.env.PORT || 3000);
const WORKER_PORT = 3002;
const APEX_PORT = 3001;

function spawnChild(file, port, name) {
  const child = spawn(process.execPath, [file], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code, signal) => { console.error(`${name} exited`, { code, signal }); process.exit(code || 1); });
  return child;
}

const worker = spawnChild('server-v6.mjs', WORKER_PORT, 'Scout worker');
const apex = spawnChild('apex-live/server.mjs', APEX_PORT, 'Apex Props');

function fromApex(req) {
  const ref = String(req.headers.referer || '');
  return ref.includes('/apex') || String(req.headers['x-apex-client'] || '') === '1';
}

function targetFor(req) {
  const url = req.url || '/';
  if (url === '/apex' || url.startsWith('/apex/')) return { port: APEX_PORT, path: url === '/apex' ? '/' : url.slice('/apex'.length) || '/' };
  if (url === '/api/apex' || url.startsWith('/api/apex/')) return { port: APEX_PORT, path: '/api' + (url.slice('/api/apex'.length) || '/') };
  if (fromApex(req) && (url.startsWith('/api/props') || url.startsWith('/manifest.webmanifest'))) return { port: APEX_PORT, path: url };
  return { port: WORKER_PORT, path: url };
}

const server = http.createServer((req, res) => {
  const target = targetFor(req);
  const proxy = http.request({ hostname: '127.0.0.1', port: target.port, method: req.method, path: target.path, headers: { ...req.headers, host: req.headers.host || 'localhost' } }, upstream => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', err => {
    console.error('frontdoor proxy error', err);
    if (!res.headersSent) res.writeHead(502, {'content-type':'application/json'});
    res.end(JSON.stringify({ ok:false, error:'Upstream unavailable' }));
  });
  req.pipe(proxy);
});

server.listen(FRONT_PORT, '0.0.0.0', () => console.log(`Frontdoor listening on 0.0.0.0:${FRONT_PORT}; Scout=${WORKER_PORT}; Apex=${APEX_PORT}`));

function shutdown(signal) {
  worker.kill(signal); apex.kill(signal); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
