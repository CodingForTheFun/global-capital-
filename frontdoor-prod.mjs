import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { playerArtworkResponse } from './lib/autoscout/providers/thesportsdb-artwork.mjs';
import { researchPlayerProp, researchHealth } from './lib/autoscout/research-service.mjs';
import { sanitizePublicPayload } from './lib/public-sanitize.mjs';
import { projectPlayerProp, projectionsConfigured } from './lib/projections/service.mjs';

const FRONT_PORT = Number(process.env.PORT || 3000);
const SCOUT_PORT = 3002;
const APEX_PORT = 3001;
const APEX_NEXT_PORT = 3003;
const APEX_SHELL = readFileSync('./apex-v2/scout-ui-v5.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const ARTWORK_SPORTS = new Set(['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB']);
const researchLimits = new Map();
// One board load hydrates at most this many cards, resolved this many at a time.
const MAX_BATCH_PROPS = 60;
const BATCH_CONCURRENCY = 8;
// Every projection call costs money, so this route gets its own much
// tighter budget than the research routes rather than sharing theirs.
const projectionLimits = new Map();
const PROJECTION_RATE_PER_MINUTE = 12;
const CLIENT_MODULES = new Map([
  'lib/analytics/research.mjs', 'lib/analytics/rolling.mjs', 'lib/props/model.mjs',
  'lib/filters/index.mjs', 'lib/data-sources/contract.mjs',
].map(file => ['/assets/' + file, file]));
CLIENT_MODULES.set('/assets/autoscout-research.css', 'apex-v2/research-ui.css');

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

const scout = child('server-scout.mjs', SCOUT_PORT, 'Scout Pro legacy');
const apex = child('apex-v2/server-core.mjs', APEX_PORT, 'Auto Scout data core');
const apexNext = child('apex-v3/server.mjs', APEX_NEXT_PORT, 'Apex Market Lab v3');

function target(rawUrl = '/') {
  const url = new URL(rawUrl, 'http://localhost');

  if (url.pathname === '/api/health') return { port: APEX_PORT, path: '/api/health' + url.search, injectShell: false, sanitizeJson: true };

  if (url.pathname === '/api/apex/diagnostics/e2e') {
    return { port: APEX_PORT, path: '/api/diagnostics/e2e' + url.search, injectShell: false };
  }
  if (url.pathname === '/api/apex/diagnostics') {
    return { port: APEX_PORT, path: '/api/diagnostics' + url.search, injectShell: false };
  }
  if (url.pathname === '/api/apex/health') return { port: APEX_PORT, path: '/api/health' + url.search, injectShell: false, sanitizeJson: true };
  if (url.pathname === '/api/apex/props') return { port: APEX_PORT, path: '/api/props' + url.search, injectShell: false, sanitizeJson: true };
  if (url.pathname === '/api/apex/line-history') return { port: APEX_PORT, path: '/api/line-history' + url.search, injectShell: false };

  if (url.pathname === '/apex/diagnostics' || url.pathname === '/apex/diagnostics/') {
    return { port: APEX_PORT, path: '/diagnostics' + url.search, injectShell: false };
  }
  if (url.pathname === '/' || url.pathname === '/apex' || url.pathname === '/apex/' || url.pathname.startsWith('/apex/')) {
    return { port: APEX_PORT, path: '/apex-v2' + url.search, injectShell: true };
  }

  if (url.pathname === '/apex-next' || url.pathname.startsWith('/apex-next/')) {
    return { port: APEX_NEXT_PORT, path: url.pathname + url.search, injectShell: false };
  }
  if (url.pathname === '/api/apex-next/health') return { port: APEX_NEXT_PORT, path: '/api/health' + url.search, injectShell: false, sanitizeJson: true };
  if (url.pathname === '/api/apex-next/props') return { port: APEX_NEXT_PORT, path: '/api/props' + url.search, injectShell: false, sanitizeJson: true };

  return { port: SCOUT_PORT, path: rawUrl, injectShell: false };
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

function directJson(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(payload);
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 80);
}

function researchRateAllowed(req) {
  const now = Date.now();
  const key = requestIp(req);
  const current = researchLimits.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    researchLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (researchLimits.size > 2000) {
    for (const [ip, row] of researchLimits) if (now - row.startedAt > 120_000) researchLimits.delete(ip);
  }
  return current.count <= 180;
}

function projectionRateAllowed(req) {
  const now = Date.now();
  const key = requestIp(req);
  const current = projectionLimits.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    projectionLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (projectionLimits.size > 2000) {
    for (const [ip, row] of projectionLimits) if (now - row.startedAt > 120_000) projectionLimits.delete(ip);
  }
  return current.count <= PROJECTION_RATE_PER_MINUTE;
}

function safeParam(url, name, max = 100) {
  return String(url.searchParams.get(name) || '').trim().slice(0, max);
}

async function maybeServeResearch(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/api/apex/research' && url.pathname !== '/api/apex/research-health') return false;
  if (req.method !== 'GET') {
    directJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'GET' });
    return true;
  }
  if (url.pathname === '/api/apex/research-health') {
    const health = researchHealth() || {};
    // Readiness only. Which provider serves it, and what it costs, is owner detail.
    directJson(res, 200, {
      ok: true,
      research: { available: Boolean(health.configured ?? health.available ?? health.ok) },
    });
    return true;
  }
  if (!researchRateAllowed(req)) {
    directJson(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many research requests. Try again shortly.' }, { 'retry-after': '60' });
    return true;
  }
  const sport = safeParam(url, 'sport', 12).toUpperCase();
  const playerName = safeParam(url, 'playerName', 90);
  const market = safeParam(url, 'market', 100);
  const lineRaw = safeParam(url, 'line', 24);
  const line = lineRaw === '' ? null : Number(lineRaw);
  const side = safeParam(url, 'side', 10).toUpperCase() || 'OVER';
  if (!ARTWORK_SPORTS.has(sport) || !playerName || !market || (line !== null && !Number.isFinite(line)) || !['OVER','UNDER'].includes(side)) {
    directJson(res, 400, { ok: false, code: 'INVALID_RESEARCH_REQUEST', message: 'Valid sport, player, market, line and side are required.' });
    return true;
  }
  try {
    const result = await researchPlayerProp({
      sport,
      playerName,
      providerPlayerId: safeParam(url, 'providerPlayerId', 48) || null,
      team: safeParam(url, 'team', 40) || null,
      homeTeam: safeParam(url, 'homeTeam', 60) || null,
      awayTeam: safeParam(url, 'awayTeam', 60) || null,
      opponent: safeParam(url, 'opponent', 60) || null,
      market,
      providerMarketKey: safeParam(url, 'marketId', 64) || null,
      line,
      side,
      games: Math.min(40, Math.max(5, Number(url.searchParams.get('games')) || 20)),
    });
    directJson(res, result?.ok === false ? 400 : 200, sanitizePublicPayload(result || { ok: true, available: false, message: 'Historical research is unavailable.' }, { statsContext: true }));
  } catch (error) {
    console.error('[frontdoor] research request failed', String(error?.code || error?.message || 'RESEARCH_ERROR').slice(0, 120));
    directJson(res, 502, { ok: false, available: false, code: 'RESEARCH_PROVIDER_ERROR', message: 'Historical player research is temporarily unavailable.' });
  }
  return true;
}

function readJsonBody(req, limit = 96 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); resolve(null); return; }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function batchEntry(raw) {
  const text = (value, max) => String(value ?? '').trim().slice(0, max);
  const sport = text(raw?.sport, 12).toUpperCase();
  const playerName = text(raw?.playerName, 90);
  const market = text(raw?.market, 100);
  const key = text(raw?.key, 200);
  const line = raw?.line === null || raw?.line === undefined || raw?.line === '' ? null : Number(raw.line);
  const side = text(raw?.side, 10).toUpperCase() || 'OVER';
  if (!key || !ARTWORK_SPORTS.has(sport) || !playerName || !market) return null;
  if (line !== null && !Number.isFinite(line)) return null;
  if (!['OVER', 'UNDER'].includes(side)) return null;
  return {
    key,
    params: {
      sport, playerName, market, line, side,
      providerPlayerId: text(raw?.providerPlayerId, 48) || null,
      team: text(raw?.team, 40) || null,
      homeTeam: text(raw?.homeTeam, 60) || null,
      awayTeam: text(raw?.awayTeam, 60) || null,
      opponent: text(raw?.opponent, 60) || null,
      providerMarketKey: text(raw?.marketId, 64) || null,
      games: Math.min(40, Math.max(5, Number(raw?.games) || 40)),
    },
  };
}

/**
 * Hydrate a whole slate in one request.
 *
 * Every card used to wait on its own click, so an opening board was a grid of
 * dashes. The work per prop is unchanged — this runs the same
 * `researchPlayerProp` — but resolving the slate together lets the athlete-id
 * and game-log caches serve the second prop for a player from the first one's
 * fetch, and returns the finished hit rates with the list.
 */
async function maybeServeResearchBatch(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/api/apex/research-batch') return false;
  if (req.method !== 'POST') {
    directJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'POST' });
    return true;
  }
  if (!researchRateAllowed(req)) {
    directJson(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many research requests. Try again shortly.' }, { 'retry-after': '60' });
    return true;
  }
  const body = await readJsonBody(req);
  const requested = Array.isArray(body?.props) ? body.props.slice(0, MAX_BATCH_PROPS) : null;
  if (!requested?.length) {
    directJson(res, 400, { ok: false, code: 'INVALID_BATCH_REQUEST', message: 'A list of props is required.' });
    return true;
  }
  const entries = requested.map(batchEntry).filter(Boolean);
  if (!entries.length) {
    directJson(res, 400, { ok: false, code: 'INVALID_BATCH_REQUEST', message: 'Valid sport, player, market, line and side are required.' });
    return true;
  }
  const results = {};
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      try {
        const result = await researchPlayerProp(entry.params);
        results[entry.key] = sanitizePublicPayload(result || { ok: true, available: false, message: 'Historical research is unavailable.' }, { statsContext: true });
      } catch (error) {
        console.error('[frontdoor] batch research entry failed', String(error?.code || error?.message || 'RESEARCH_ERROR').slice(0, 120));
        results[entry.key] = { ok: false, available: false, code: 'RESEARCH_PROVIDER_ERROR', message: 'Historical player research is temporarily unavailable.' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, entries.length) }, worker));
  directJson(res, 200, { ok: true, requested: entries.length, results });
  return true;
}

/**
 * POST /api/props/project — a modelled projection for one prop.
 *
 * Separate from /api/apex/research on purpose. Research reports what was
 * measured; this reports what a model estimated, and the response says so in
 * `modelled` and `source` so the two can never be mistaken for each other.
 */
async function maybeServeProjection(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  // Both names serve the same handler: /predict is what the client calls,
  // /project is kept so anything already pointed at it keeps working.
  if (url.pathname !== '/api/props/predict' && url.pathname !== '/api/props/project') return false;
  if (req.method !== 'POST') {
    directJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'POST' });
    return true;
  }
  if (!projectionsConfigured()) {
    directJson(res, 200, { ok: true, available: false, code: 'PROJECTION_NOT_CONFIGURED', message: 'Modelled projections are not enabled.' });
    return true;
  }
  if (!projectionRateAllowed(req)) {
    directJson(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many projection requests. Try again shortly.' }, { 'retry-after': '60' });
    return true;
  }
  const body = await readJsonBody(req, 64 * 1024);
  const sport = String(body?.sport || '').trim().toUpperCase();
  const playerName = String(body?.playerName || '').trim().slice(0, 90);
  const market = String(body?.market || '').trim().slice(0, 100);
  const line = body?.line === null || body?.line === undefined || body?.line === '' ? null : Number(body.line);
  if (!ARTWORK_SPORTS.has(sport) || !playerName || !market || line === null || !Number.isFinite(line)) {
    directJson(res, 400, { ok: false, code: 'INVALID_PROJECTION_REQUEST', message: 'Valid sport, player, market and line are required.' });
    return true;
  }
  try {
    const result = await projectPlayerProp({ ...body, sport, playerName, market, line });
    directJson(res, 200, sanitizePublicPayload(result, { statsContext: true }));
  } catch (error) {
    console.error('[frontdoor] projection request failed', String(error?.code || error?.message || 'PROJECTION_ERROR').slice(0, 120));
    directJson(res, 502, { ok: false, available: false, code: 'PROJECTION_PROVIDER_ERROR', message: 'Modelled projections are temporarily unavailable.' });
  }
  return true;
}

async function maybeServeArtwork(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/api/apex/player-artwork') return false;
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' });
    res.end(JSON.stringify({ ok: false, message: 'Method not allowed.' }));
    return true;
  }
  const sport = String(url.searchParams.get('sport') || '').toUpperCase();
  const name = String(url.searchParams.get('name') || '').trim().slice(0, 90);
  if (!ARTWORK_SPORTS.has(sport) || !name) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, message: 'Valid sport and player name are required.' }));
    return true;
  }
  try {
    const image = await playerArtworkResponse(sport, name);
    res.writeHead(image.status || 200, {
      'content-type': image.contentType || 'image/svg+xml',
      'content-length': Buffer.byteLength(image.body),
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    });
    res.end(image.body);
  } catch {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, message: 'Player artwork is temporarily unavailable.' }));
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const asset = CLIENT_MODULES.get(new URL(req.url || '/', 'http://localhost').pathname);
  if (asset && req.method === 'GET') {
    res.writeHead(200, { 'content-type': asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(readFileSync(asset, 'utf8'));
    return;
  }
  if (await maybeServeResearch(req, res)) return;
  if (await maybeServeResearchBatch(req, res)) return;
  if (await maybeServeProjection(req, res)) return;
  if (await maybeServeArtwork(req, res)) return;

  const dst = target(req.url || '/');
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: dst.port,
    path: dst.path,
    method: req.method,
    headers: { ...req.headers, host: req.headers.host || 'localhost', 'accept-encoding': 'identity' },
  }, (upstream) => {
    const type = String(upstream.headers['content-type'] || '');
    const injectApexShell = dst.injectShell === true && dst.port === APEX_PORT && type.includes('text/html');
    const scrubJson = dst.sanitizeJson === true && type.includes('application/json');

    if (scrubJson) {
      // Buffer so vendor names, plan limits and credit balances can be removed
      // before anything customer-facing leaves the frontdoor.
      const jsonChunks = [];
      upstream.on('data', (chunk) => jsonChunks.push(Buffer.from(chunk)));
      upstream.on('end', () => {
        const raw = Buffer.concat(jsonChunks).toString('utf8');
        let body = raw;
        try { body = JSON.stringify(sanitizePublicPayload(JSON.parse(raw))); }
        catch { /* not parseable: pass the original through untouched */ }
        res.writeHead(upstream.statusCode || 200, proxyHeaders(upstream.headers, true));
        res.end(body);
      });
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Application upstream unavailable.' }));
      });
      return;
    }

    if (!injectApexShell) {
      res.writeHead(upstream.statusCode || 502, proxyHeaders(upstream.headers));
      upstream.pipe(res);
      return;
    }

    const chunks = [];
    upstream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    upstream.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      const injection = `<script>${APEX_SHELL}</script>`;
      body = body.includes('</body>') ? body.replace('</body>', `${injection}</body>`) : `${body}${injection}`;
      res.writeHead(upstream.statusCode || 200, proxyHeaders(upstream.headers, true));
      res.end(body);
    });
    upstream.on('error', (error) => {
      console.error('[frontdoor] Auto Scout HTML transform failed', error?.message || error);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Auto Scout interface unavailable.' }));
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
  console.log(`Production frontdoor listening on 0.0.0.0:${FRONT_PORT}; ScoutLegacy=${SCOUT_PORT}; AutoScoutCore=${APEX_PORT}; ApexNext=${APEX_NEXT_PORT}; AutoScoutShell=prop-research-v5`);
});

setTimeout(async () => {
  try {
    const health = await fetch(`http://127.0.0.1:${APEX_PORT}/api/health`);
    const healthBody = await health.json();
    console.log(`[AutoScout self-check] health=${health.status} theOddsApi=${Boolean(healthBody?.theOddsApiConfigured)} provider=${healthBody?.preferredProvider || 'none'} database=${healthBody?.persistence?.configured ? 'connected' : 'not-connected'} research=${researchHealth().configured ? 'configured' : 'not-configured'}`);

    const props = await fetch(`http://127.0.0.1:${APEX_PORT}/api/props?sport=NFL`);
    const propsBody = await props.json();
    console.log(`[AutoScout self-check] nflStatus=${props.status} lines=${Number(propsBody?.meta?.lineCount ?? propsBody?.props?.length ?? 0)} events=${Number(propsBody?.meta?.events || 0)} books=${Number(propsBody?.meta?.sportsbookCount || 0)} provider=${propsBody?.meta?.provider || 'none'} cache=${propsBody?.meta?.cacheHit ? 'hit' : 'miss'} ruleAudit=${propsBody?.props?.[0]?.autoScout?.checks?.length ? 'yes' : 'no'}`);

    const nextHealth = await fetch(`http://127.0.0.1:${APEX_NEXT_PORT}/api/health`);
    console.log(`[Apex next self-check] health=${nextHealth.status}`);
  } catch (error) {
    console.error('[AutoScout self-check] failed', error?.message || error);
  }
}, 2200).unref();

function shutdown(signal) {
  scout.kill(signal);
  apex.kill(signal);
  apexNext.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
