const CORE_REALTIME_IMPORT = "import { handleProplineRealtimeEvent, proplineRealtimeSnapshot, proplineRealtimeHealth, startProplineRealtime } from '../lib/data-sources/propline/realtime.mjs';";
const CORE_MARKET_IMPORT = "import { publishMarketEnvelope, handleMarketCoreRequest, marketCoreHealth } from '../lib/market-core/live.mjs';";
const CORE_WEBHOOK_WITH_OVERLAY = "if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res, { onEvent: async (event) => { recordProplineLiveBoardEvent(event); return handleProplineRealtimeEvent(event); } });";
const CORE_WEBHOOK_WITH_MARKET = "if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res, { onEvent: async (event) => { recordProplineLiveBoardEvent(event); const result = await handleProplineRealtimeEvent(event); publishMarketEnvelope(event, { provider: 'propline' }); return result; } });";
const CORE_LIVE_ROUTE = "if (req.method === 'GET' && url.pathname === '/api/propline/live') {";
const CORE_HEALTH = 'proplineDeliveries: proplineDeliveryHealth()';

export function patchMarketCore(source) {
  let out = String(source || '');
  if (!out.includes(CORE_MARKET_IMPORT)) {
    if (!out.includes(CORE_REALTIME_IMPORT)) throw new Error('Market core patch could not locate PropLine realtime import.');
    out = out.replace(CORE_REALTIME_IMPORT, `${CORE_REALTIME_IMPORT}\n${CORE_MARKET_IMPORT}`);
  }
  if (!out.includes(CORE_WEBHOOK_WITH_MARKET)) {
    if (!out.includes(CORE_WEBHOOK_WITH_OVERLAY)) throw new Error('Market core patch could not locate composed PropLine webhook handler.');
    out = out.replace(CORE_WEBHOOK_WITH_OVERLAY, CORE_WEBHOOK_WITH_MARKET);
  }
  if (!out.includes("url.pathname.startsWith('/api/market/')")) {
    if (!out.includes(CORE_LIVE_ROUTE)) throw new Error('Market core patch could not locate PropLine live route.');
    out = out.replace(CORE_LIVE_ROUTE, `if (url.pathname.startsWith('/api/market/')) return handleMarketCoreRequest(req, res, url);\n  ${CORE_LIVE_ROUTE}`);
  }
  if (!out.includes('marketCore: marketCoreHealth()')) {
    if (!out.includes(CORE_HEALTH)) throw new Error('Market core patch could not locate delivery health payload.');
    out = out.replace(CORE_HEALTH, `${CORE_HEALTH}, marketCore: marketCoreHealth()`);
  }
  return out;
}

const FRONT_LIVE_MOVES = "if (url.pathname === '/api/apex/live-moves') return { port: APEX_PORT, path: '/api/propline/live' + url.search, injectShell: false };";

export function patchMarketCoreFrontdoor(source) {
  let out = String(source || '');
  if (!out.includes("url.pathname === '/api/apex/stream'")) {
    if (!out.includes(FRONT_LIVE_MOVES)) throw new Error('Market core frontdoor patch could not locate live-moves route.');
    out = out.replace(FRONT_LIVE_MOVES, [
      FRONT_LIVE_MOVES,
      "  if (url.pathname === '/api/apex/stream') return { port: APEX_PORT, path: '/api/market/stream' + url.search, injectShell: false };",
      "  if (url.pathname === '/api/apex/market-state') return { port: APEX_PORT, path: '/api/market/state' + url.search, injectShell: false };",
      "  if (url.pathname === '/api/apex/market-health') return { port: APEX_PORT, path: '/api/market/health' + url.search, injectShell: false };",
    ].join('\n'));
  }
  return out;
}
