import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { sportsDataIoPropBoard } from './lib/data-sources/sportsdataio/prop-board.mjs';

const FRONT_PORT = Number(process.env.PORT || 3000);
const SCOUT_PORT = 3002;
const APEX_PORT = 3001;
const APEX_NEXT_PORT = 3003;
const APEX_SHELL = readFileSync('./apex-v2/scout-ui-v2.js', 'utf8').replace(/<\/script/gi, '<\\/script');

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
const apex = child('apex-v2/server.mjs', APEX_PORT, 'Apex Market v2');
const apexNext = child('apex-v3/server.mjs', APEX_NEXT_PORT, 'Apex Market Lab v3');

function target(rawUrl = '/') {
  const url = new URL(rawUrl, 'http://localhost');
  if (url.pathname === '/apex-next' || url.pathname.startsWith('/apex-next/')) {
    return { port: APEX_NEXT_PORT, path: url.pathname + url.search };
  }
  if (url.pathname === '/api/apex-next/health') return { port: APEX_NEXT_PORT, path: '/api/health' + url.search };
  if (url.pathname === '/api/apex-next/props') return { port: APEX_NEXT_PORT, path: '/api/props' + url.search };

  if (url.pathname === '/apex' || url.pathname === '/apex/' || url.pathname.startsWith('/apex/')) {
    return { port: APEX_PORT, path: '/apex-v2' + url.search };
  }
  if (url.pathname === '/api/apex/health') return { port: APEX_PORT, path: '/api/health' + url.search };
  if (url.pathname === '/api/apex/props') return { port: APEX_PORT, path: '/api/props' + url.search };
  return { port: SCOUT_PORT, path: rawUrl };
}

function proxyHeaders(upstreamHeaders, transformed = false) {
  const headers = { ...upstreamHeaders };
  if (transformed) {
    delete headers['content-length'];
    delete headers['content-encoding'];
    headers['cache-control'] = 'no-store';
  }
  return headers;
}

const server = http.createServer((req, res) => {
  const dst = target(req.url || '/');
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: dst.port,
    path: dst.path,
    method: req.method,
    headers: { ...req.headers, host: req.headers.host || 'localhost', 'accept-encoding': 'identity' },
  }, (upstream) => {
    const type = String(upstream.headers['content-type'] || '');
    const injectApexShell = dst.port === APEX_PORT && type.includes('text/html');
    if (!injectApexShell) {
      res.writeHead(upstream.statusCode || 502, proxyHeaders(upstream.headers));
      upstream.pipe(res);
      return;
    }

    const chunks = [];
    upstream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    upstream.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      body = body.replace("var state={sport:'NBA'", "var state={sport:'NFL'");
      const injection = `<script>${APEX_SHELL}</script>`;
      body = body.includes('</head>') ? body.replace('</head>', `${injection}</head>`) : `${injection}${body}`;
      res.writeHead(upstream.statusCode || 200, proxyHeaders(upstream.headers, true));
      res.end(body);
    });
    upstream.on('error', (error) => {
      console.error('[frontdoor] Apex HTML transform failed', error?.message || error);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Apex interface unavailable.' }));
    });
  });
  proxy.on('error', (error) => {
    console.error('[frontdoor] proxy failure', error?.message || error);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Application upstream unavailable.' }));
  });
  req.pipe(proxy);
});

server.listen(FRONT_PORT, '0.0.0.0', () => {
  console.log(`Production frontdoor listening on 0.0.0.0:${FRONT_PORT}; Scout=${SCOUT_PORT}; ApexV2=${APEX_PORT}; ApexNext=${APEX_NEXT_PORT}; ApexShell=reference-card-v2`);
});

setTimeout(async () => {
  try {
    const health = await fetch(`http://127.0.0.1:${APEX_PORT}/api/health`);
    const healthBody = await health.json();
    console.log(`[Apex v2 self-check] health=${health.status} theOddsApi=${Boolean(healthBody?.theOddsApiConfigured)} sportsGameOdds=${Boolean(healthBody?.sportsGameOddsConfigured)} sportsDataIo=${Boolean(healthBody?.sportsDataIoConfigured)}`);

    const props = await fetch(`http://127.0.0.1:${APEX_PORT}/api/props?sport=NFL`);
    const propsBody = await props.json();
    console.log(`[Apex v2 self-check] nflStatus=${props.status} props=${Number(propsBody?.props?.length || 0)} events=${Number(propsBody?.meta?.events || 0)} books=${Number(propsBody?.meta?.sportsbookCount || 0)} provider=${propsBody?.meta?.provider || 'none'} warning=${propsBody?.meta?.warning || 'none'}`);

    const nextHealth = await fetch(`http://127.0.0.1:${APEX_NEXT_PORT}/api/health`);
    console.log(`[Apex next self-check] health=${nextHealth.status}`);

    const mlb = await sportsDataIoPropBoard.fetchBoard({ sports: ['MLB'], force: true });
    const coverage = Array.isArray(mlb?.coverage) ? mlb.coverage[0] : null;
    console.log(`[Apex shape-check] MLB games=${Number(coverage?.gamesChecked || 0)} offers=${Number(coverage?.offerCount || 0)} status=${Number(coverage?.status || 0)} error=${coverage?.errorType || 'OK'} shape=${JSON.stringify(coverage?.shape || {})}`);
  } catch (error) {
    console.error('[Apex self-check] failed', error?.message || error);
  }
}, 1500).unref();

function shutdown(signal) {
  scout.kill(signal);
  apex.kill(signal);
  apexNext.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
