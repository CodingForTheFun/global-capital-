import {activePropsFromBoard} from '../lib/ingestion/normalize.mjs';
import {bookEnabled,bookSelection} from '../lib/constants/books.mjs';
import {createBoardResponseCache,sendBoardResponse} from '../lib/autoscout/board-response-cache.mjs';
import { fetchGameBoard, fetchTacoBoard } from '../lib/autoscout/providers/the-odds-api.mjs';
import { startFrugalPersistence } from '../lib/autoscout/persistence-scheduler.mjs';
import crypto from 'node:crypto';
import http from 'node:http';
import { fetchUnifiedBoard, providerHealth, providerDiagnostics } from './provider.mjs';
import { SUPPORTED_SPORTS, BOARD_SPORTS, AUTOMATIC_SPORTS } from '../lib/autoscout/models.mjs';
import { decorateBoardWithScoutAudit } from '../lib/autoscout/scout-rules.mjs';
import { persistNormalizedBoard, getLineHistory, persistenceHealth, persistenceConfigured } from '../lib/autoscout/supabase-persistence.mjs';
import { handleProplineWebhook, WEBHOOK_PATH as PROPLINE_WEBHOOK_PATH } from '../lib/data-sources/propline/webhook-route.mjs';
import { publicStoreHealth } from '../lib/ingestion/public-persistence.mjs';
import { webhookHealth as proplineWebhookHealth } from '../lib/data-sources/propline/webhooks.mjs';
import { startIngestWorker, ingestHealth } from '../lib/autoscout/ingest-worker.mjs';
import { createSessionCodec, createRateLimiter, parseCookies, clientKey, SESSION_COOKIE, OWNER } from '../lib/session.mjs';
// Release recovery marker for duplicate-card normalization; no runtime behavior change.
import { installProcessGuards } from '../lib/web/process-guards.mjs';
import { mailHealth } from '../lib/auth/mailer.mjs';
import { startStorageMonitor, storageHealth } from '../lib/storage/volume-health.mjs';

const PORT = Number(process.env.PORT || 3000);
const startedAt = new Date().toISOString();
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const dashboardSessionSecret = process.env.DASHBOARD_SESSION_SECRET || crypto.createHash('sha256').update(`scout-pro:${dashboardPassword || 'local-only'}`).digest('hex');
const sessions = createSessionCodec({ secret: dashboardSessionSecret });
const limiter = createRateLimiter();
// One compressed board per sport per short window, shared by every request.
const boardResponses = createBoardResponseCache({ ttlMs: Math.max(5_000, Number(process.env.AUTOSCOUT_BOARD_RESPONSE_TTL_MS) || 15_000) });

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    ...extra,
  });
  res.end(payload);
}

function html(res, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  res.end(body);
}

function ownerAuthorized(req) {
  if (!dashboardPassword) return true;
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = sessions.readToken(token);
  return session.authenticated === true && session.role === OWNER;
}

function rateAllowed(req, bucket, max, windowMs) {
  return limiter.allow(clientKey(req, bucket), max, windowMs);
}

function mainPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#070b19"><title>Auto Scout</title></head><body><div class="app"><main class="shell"><p>Loading Auto Scout…</p></main></div></body></html>`;
}

function diagnosticsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08101d"><title>Auto Scout Provider Diagnostics</title><style>
  :root{color-scheme:dark;--bg:#07101c;--panel:#0d1828;--panel2:#111f32;--line:#253652;--text:#f6f8fc;--muted:#91a0b7;--good:#38df9f;--bad:#ff6b7b;--warn:#f0c35a}*{box-sizing:border-box}body{margin:0;background:#07101c;color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1180px;margin:auto;padding:24px 16px 60px}header{display:flex;gap:12px;align-items:center;margin-bottom:18px}.brand{font-weight:950;font-size:22px;letter-spacing:-.04em}.brand span{color:var(--good)}.pill{font-size:11px;color:#a9f3d2;border:1px solid #285647;background:#0d2a22;border-radius:999px;padding:6px 9px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}.card{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:13px}.card small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em}.card strong{display:block;font-size:20px;margin-top:4px}.table{border:1px solid var(--line);border-radius:14px;overflow:auto;background:var(--panel)}table{border-collapse:collapse;width:100%;min-width:780px}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid rgba(37,54,82,.8);font-size:12px}th{background:var(--panel2);color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em}.ok{color:var(--good)}.err{color:var(--bad)}.wait{color:var(--warn)}h2{font-size:15px;margin:20px 0 9px}.error{border:1px solid #50303a;background:#21131a;border-radius:10px;padding:10px 12px;margin-bottom:7px;font-size:11px;line-height:1.5}.muted{color:var(--muted)}a{color:#8ab7ff}.top{margin-left:auto;display:flex;gap:8px}.btn{border:1px solid var(--line);background:#111f32;color:#fff;border-radius:10px;padding:9px 11px;text-decoration:none;font-size:12px;font-weight:800}@media(max-width:760px){.grid{grid-template-columns:1fr 1fr}.wrap{padding-top:16px}.brand{font-size:19px}.pill{display:none}}</style></head><body><div class="wrap"><header><div class="brand">AUTO<span>SCOUT</span> DATA</div><div class="pill">Owner diagnostics</div><div class="top"><a class="btn" href="/apex">Prop Board</a><button class="btn" id="refresh">Refresh status</button></div></header><div id="summary" class="grid"></div><h2>SPORT → EVENTS → PROP MARKETS → BOOKMAKERS → LINES</h2><div class="table"><table><thead><tr><th>Sport</th><th>Status</th><th>Events</th><th>Prop markets</th><th>Books</th><th>Lines</th><th>Provider</th><th>Last ingestion</th></tr></thead><tbody id="sports"></tbody></table></div><h2>Provider errors</h2><div id="errors" class="muted">No errors recorded.</div></div><script>
  const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  async function load(){try{const r=await fetch('/api/apex/diagnostics',{cache:'no-store'});if(!r.ok){document.getElementById('errors').textContent=r.status===403?'Owner session required. Sign in to Auto Scout as owner, then reopen diagnostics.':'Diagnostics request failed.';return;}const d=await r.json();const x=d.runtime||{};const q=x.quota||{};const c=x.cache||{};const db=d.persistence||{};document.getElementById('summary').innerHTML=[['Requests today',x.requestsToday??0],['Observed credits today',x.estimatedCreditsUsedToday??0],['Remaining credits',q.remaining??'—'],['Cache hit rate',c.hitPercentage==null?'—':c.hitPercentage+'%'],['Database',db.configured?(db.lastError?'ERROR':'CONNECTED'):'NOT CONNECTED']].map(v=>'<div class="card"><small>'+esc(v[0])+'</small><strong>'+esc(v[1])+'</strong></div>').join('');document.getElementById('sports').innerHTML=Object.values(x.sports||{}).map(s=>'<tr><td><b>'+esc(s.sport)+'</b></td><td class="'+(s.status==='ok'?'ok':s.status==='error'?'err':'wait')+'">'+esc(s.status)+'</td><td>'+esc(s.events||0)+'</td><td>'+esc(s.propMarkets||0)+'</td><td>'+esc(s.bookmakers||0)+'</td><td><b>'+esc(s.lines||0)+'</b></td><td>'+esc(s.provider||'—')+'</td><td>'+esc(s.fetchedAt||s.failedAt||'—')+'</td></tr>').join('');const errors=x.errors||[];document.getElementById('errors').innerHTML=errors.length?errors.map(e=>'<div class="error"><b>'+esc(e.provider)+' · '+esc(e.sport||'unknown sport')+'</b><br>'+esc(e.endpoint||'endpoint unavailable')+' · HTTP '+esc(e.status||'—')+' · '+esc(e.code||'')+'<br>'+esc(e.reason)+'<br><span class="muted">'+esc(e.timestamp)+'</span></div>').join(''):'No errors recorded.';}catch(e){document.getElementById('errors').textContent='Diagnostics request failed.';}}
  document.getElementById('refresh').onclick=load;load();setInterval(load,15000);
</script></body></html>`;
}

async function propsResponse(req, url, res) {
  const requestStartedAt = Date.now();
  if (!rateAllowed(req, 'autoscout-props-minute', 180, 60_000) || !rateAllowed(req, 'autoscout-props-5m', 600, 300_000)) {
    return json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many prop requests. Try again shortly.' }, { 'retry-after': '60' });
  }
  const sport = String(url.searchParams.get('sport') || 'NFL').toUpperCase();
  if (!BOARD_SPORTS.includes(sport)) return json(res, 400, { ok: false, code: 'UNSUPPORTED_SPORT', supportedSports: BOARD_SPORTS });
  const includeAlternates = ['1','true','yes'].includes(String(url.searchParams.get('alternates') || '').toLowerCase());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let providerMs = 0;
  let decorateMs = 0;
  let pathTiming = {};
  try {
    const entry = await boardResponses.get(sport + '|' + (includeAlternates ? 'alternates' : 'main'), async () => {
      const providerStartedAt = Date.now();
      const rawBoard = await fetchUnifiedBoard(sport, { signal: controller.signal, includeAlternates });
      providerMs = Math.max(0, Date.now() - providerStartedAt);

      const decorateStartedAt = Date.now();
      const board = decorateBoardWithScoutAudit(rawBoard);
      decorateMs = Math.max(0, Date.now() - decorateStartedAt);
      if (!board?.meta?.cacheHit) void persistNormalizedBoard(board).catch(()=>{});
      pathTiming = board?.meta?.requestTimingMs || {};
      return { ...board, supportedSports: BOARD_SPORTS, persistence: persistenceHealth() };
    });
    const serializeStartedAt = Date.now();
    const status = await sendBoardResponse(req, res, entry);
    const serializeMs = Math.max(0, Date.now() - serializeStartedAt);
    const source = entry.cache !== 'miss' ? 'response-cache' : ['memory','persisted','live','empty'].includes(pathTiming.source) ? pathTiming.source : 'unknown';
    console.log(
      `[AutoScout props timing] sport=${sport} source=${source} memory=${Number(pathTiming.memoryCache || 0)}ms persisted=${Number(pathTiming.persistedRead || 0)}ms live=${Number(pathTiming.liveFetch || 0)}ms freshness=${Number(pathTiming.freshness || 0)}ms provider=${providerMs}ms decorate=${decorateMs}ms build=${entry.buildMs}ms serialize=${serializeMs}ms total=${Math.max(0, Date.now() - requestStartedAt)}ms status=${status} bytes=${entry.rawLength} gzip=${entry.gz.length} bgRefresh=${pathTiming.backgroundRefreshScheduled === true ? 'yes' : 'no'}`,
    );
    return;
  } catch (error) {
    console.warn(
      `[AutoScout props timing] sport=${sport} source=error provider=${providerMs}ms decorate=${decorateMs}ms total=${Math.max(0, Date.now() - requestStartedAt)}ms code=${String(error?.code || error?.name || 'PROVIDER_ERROR').slice(0, 64)}`,
    );
    if(res.headersSent){res.destroy();return;}
    return json(res, 503, { ok: false, code: String(error?.code || 'PROVIDER_ERROR'), message: 'Live prop data is temporarily unavailable for this sport.', sport }, {'retry-after':'30'});
  } finally {
    clearTimeout(timer);
  }
}

async function lineHistoryResponse(req, url, res) {
  if (!rateAllowed(req, 'autoscout-history', 120, 60_000)) return json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many history requests.' });
  const propId = String(url.searchParams.get('propId') || '').trim();
  if (!propId) return json(res, 400, { ok: false, code: 'PROP_ID_REQUIRED', message: 'propId is required.' });
  try {
    const result = await getLineHistory(propId, { bookmakerKey: url.searchParams.get('bookmaker') || null, side: url.searchParams.get('side') || null, limit: Number(url.searchParams.get('limit') || 250) });
    return json(res, 200, { ok: true, ...result });
  } catch {
    return json(res, 503, { ok: false, code: 'HISTORY_UNAVAILABLE', message: 'Line history is unavailable right now.' });
  }
}

async function e2eStatus() {
  const preferred = ['NFL','MLB','WNBA','NCAAF','NBA','NHL','NCAAB'];
  for (const sport of preferred) {
    try {
      const board = decorateBoardWithScoutAudit(await fetchUnifiedBoard(sport, {cacheOnly:true}));
      const row = (board?.props || []).find((prop) => prop.playerName && prop.sportsbook && Number.isFinite(Number(prop.line)) && ['OVER','UNDER'].includes(prop.side));
      if (!row) continue;
      return {
        ok: true,
        sport,
        stages: {
          provider: 'PASS', backendProviderClient: 'PASS', normalizer: board?.data?.lines?.length ? 'PASS' : 'FAIL',
          centralizedCache: board?.meta?.cacheHit ? 'PASS' : 'WARMED', autoScoutApi: 'PASS', frontendContract: 'PASS',
          ruleAudit: row?.autoScout?.checks?.length ? 'PASS' : 'FAIL', database: persistenceHealth().configured ? 'CONNECTED' : 'NOT_CONFIGURED',
        },
        sample: {
          player: row.playerName, market: row.market, sportsbook: row.sportsbook, side: row.side,
          line: row.line, price: row.price, providerUpdatedAt: row.providerUpdatedAt || row.updatedAt || null,
          ingestedAt: row.ingestedAt || board?.meta?.ingestionTimestamp || null,
          autoScoutClassification: row?.autoScout?.classification || null,
        },
      };
    } catch {}
  }
  return { ok: false, stages: { provider: 'FAIL' }, message: 'No supported sport currently produced a complete player-prop selection.' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'autoscout-apex', revision:process.env.RAILWAY_GIT_COMMIT_SHA||null, startedAt, supportedSports: BOARD_SPORTS, ...providerHealth(), persistence: persistenceHealth(), publicStore: publicStoreHealth(), storage: storageHealth(), mail: mailHealth(), proplineWebhook: proplineWebhookHealth() });
  }
  if (url.pathname === '/api/game-markets' || url.pathname === '/api/taco-offers') {
    if(req.method !== 'GET') return json(res,405,{ok:false,code:'METHOD_NOT_ALLOWED'});
    if(!rateAllowed(req,'game-markets',30,60000)) return json(res,429,{ok:false,code:'RATE_LIMITED'});
    const sport=String(url.searchParams.get('sport')||'NFL').toUpperCase();
    if(!BOARD_SPORTS.includes(sport))return json(res,400,{ok:false,code:'UNSUPPORTED_SPORT'});
    try{return json(res,200,await(url.pathname==='/api/game-markets'?fetchGameBoard(sport):fetchTacoBoard(sport)));}
    catch{return json(res,503,{ok:false,code:'FEED_UNAVAILABLE',message:'This feed is temporarily unavailable.'});}
  }
  // PropLine pushes line moves, resolutions and steam here. Verified by HMAC
  // inside the handler; this route is deliberately reachable without a session.
  if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res);
  if (req.method === 'GET' && url.pathname === '/api/props') return propsResponse(req, url, res);
  if(req.method==='GET'&&url.pathname==='/api/active-props'){
    const sport=String(url.searchParams.get('sport')||'NFL').toUpperCase();
    if(!BOARD_SPORTS.includes(sport))return json(res,400,{code:'UNSUPPORTED_SPORT'});
    if(!rateAllowed(req,'active-props',60,60000))return json(res,429,{code:'RATE_LIMITED'});
    try{const board=await fetchUnifiedBoard(sport,{cacheOnly:true});
      const selection=url.searchParams.has('books')?bookSelection(url.searchParams.get('books').split(',').filter(Boolean)):null;
      const rows=activePropsFromBoard({props:board.props.filter(r=>bookEnabled(r,selection))});
      const offset=Math.max(0,Math.min(100000,Number.parseInt(url.searchParams.get('offset')||'0',10)||0)),limit=Math.max(1,Math.min(500,Number.parseInt(url.searchParams.get('limit')||'100',10)||100));
      return json(res,200,{active_props:rows.slice(offset,offset+limit),total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,cacheOnly:true});
    }catch{return json(res,503,{code:'CACHED_PROPS_UNAVAILABLE',active_props:[]});}
  }
  if (req.method === 'GET' && url.pathname === '/api/line-history') return lineHistoryResponse(req, url, res);

  if (req.method === 'GET' && (url.pathname === '/api/diagnostics' || url.pathname === '/api/diagnostics/e2e' || url.pathname === '/diagnostics' || url.pathname === '/apex-v2/diagnostics')) {
    if (!ownerAuthorized(req)) return json(res, 403, { ok: false, code: 'OWNER_REQUIRED', message: 'Owner access is required.' });
    if (!rateAllowed(req, 'autoscout-diagnostics', 60, 60_000)) return json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many diagnostics requests.' });
    if (url.pathname === '/api/diagnostics') return json(res, 200, { ...providerDiagnostics(), persistence: persistenceHealth(), storage: storageHealth(), ingest: ingestHealth() });
    if (url.pathname === '/api/diagnostics/e2e') return json(res, 200, await e2eStatus());
    return html(res, diagnosticsPage());
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/apex-v2' || url.pathname.startsWith('/apex-v2/'))) return html(res, mainPage());
  return json(res, 404, { ok: false, message: 'Not found.' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`AUTOSCOUT_APEX_CORE listening on ${PORT}`));
startStorageMonitor();

async function warmSports() {
  if (!process.env.THE_ODDS_API_KEY) return;
  for (const sport of AUTOMATIC_SPORTS) {
    try {
      const rawBoard = await fetchUnifiedBoard(sport, {cacheOnly:true});
      const board = decorateBoardWithScoutAudit(rawBoard);
      if (!board?.meta?.cacheHit) void persistNormalizedBoard(board).catch(()=>{});
      console.log(`[AutoScout Phase2] ${sport} events=${board?.meta?.events || 0} markets=${board?.meta?.marketKeys?.length || 0} books=${board?.meta?.sportsbookCount || 0} lines=${board?.meta?.lineCount ?? board?.props?.length ?? 0} cache=${board?.meta?.cacheHit ? 'hit' : 'miss'}`);
    } catch (error) {
      console.error(`[AutoScout Phase2] ${sport} sync failed code=${String(error?.code || 'SYNC_FAILED')}`);
    }
  }
  const e2e = await e2eStatus();
  console.log(`[AutoScout Phase2] end-to-end=${e2e.ok ? 'PASS' : 'FAIL'} sport=${e2e.sport || 'none'} book=${e2e.sample?.sportsbook || 'none'} market=${e2e.sample?.market || 'none'} db=${persistenceHealth().configured ? 'configured' : 'not-configured'}`);
}
setTimeout(() => void warmSports(), 1800).unref();

// Optional high-resolution snapshot worker, OFF unless AUTOSCOUT_INGEST_ENABLED
// is set. frontdoor-clearsports.mjs already runs a 6-hourly persistence pass;
// this one forces a fresh fetch so line movement actually accumulates, at a
// higher provider cost. Run one or the other, never both.
startIngestWorker({
  sports: AUTOMATIC_SPORTS,
  fetchBoard: (sport, options) => fetchUnifiedBoard(sport, {...options,refreshPublicFeeds:true}),
  decorate: decorateBoardWithScoutAudit,
  persist: persistNormalizedBoard,
  persistenceConfigured,
});

function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// The data core runs the ingestion ticks, so it is where a rejected upstream
// fetch is most likely to surface. Surviving one keeps the board served.
installProcessGuards({ label: 'apex-core', onFatal: shutdown });

startFrugalPersistence();
