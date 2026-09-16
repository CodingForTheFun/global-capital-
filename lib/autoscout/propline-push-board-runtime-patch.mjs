const CORE_REALTIME_IMPORT = "import { handleProplineRealtimeEvent, proplineRealtimeSnapshot, proplineRealtimeHealth, startProplineRealtime } from '../lib/data-sources/propline/realtime.mjs';";
const CORE_OVERLAY_IMPORT = "import { applyProplineLiveBoardOverlay, proplineLiveBoardOverlayHealth, recordProplineLiveBoardEvent } from '../lib/data-sources/propline/live-board-overlay.mjs';";
const CORE_DELIVERY_IMPORT = "import { proplineDeliveryHealth, startProplineDeliveryHealthMonitor } from '../lib/data-sources/propline/delivery-health.mjs';";
const CORE_WEBHOOK = "if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res, { onEvent: handleProplineRealtimeEvent });";
const CORE_WEBHOOK_WITH_OVERLAY = "if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res, { onEvent: async (event) => { recordProplineLiveBoardEvent(event); return handleProplineRealtimeEvent(event); } });";
const CORE_BOARD = "const rawBoard = await fetchUnifiedBoard(sport, { signal: controller.signal, includeAlternates });";
const CORE_BOARD_WITH_OVERLAY = "const rawBoard = applyProplineLiveBoardOverlay(await fetchUnifiedBoard(sport, { signal: controller.signal, includeAlternates }), sport);";
const CORE_HEALTH = 'proplineWebhook: proplineWebhookHealth(), proplineRealtime: proplineRealtimeHealth()';
const CORE_START = 'startProplineRealtime();';

export function patchProplinePushBoardCore(source) {
  let out = String(source || '');
  if (!out.includes(CORE_OVERLAY_IMPORT)) {
    if (!out.includes(CORE_REALTIME_IMPORT)) throw new Error('PropLine push-board core patch could not locate realtime import.');
    out = out.replace(CORE_REALTIME_IMPORT, `${CORE_REALTIME_IMPORT}\n${CORE_OVERLAY_IMPORT}\n${CORE_DELIVERY_IMPORT}`);
  } else if (!out.includes(CORE_DELIVERY_IMPORT)) {
    out = out.replace(CORE_OVERLAY_IMPORT, `${CORE_OVERLAY_IMPORT}\n${CORE_DELIVERY_IMPORT}`);
  }
  if (!out.includes(CORE_WEBHOOK_WITH_OVERLAY)) {
    if (!out.includes(CORE_WEBHOOK)) throw new Error('PropLine push-board core patch could not locate realtime webhook callback.');
    out = out.replace(CORE_WEBHOOK, CORE_WEBHOOK_WITH_OVERLAY);
  }
  if (!out.includes(CORE_BOARD_WITH_OVERLAY)) {
    if (!out.includes(CORE_BOARD)) throw new Error('PropLine push-board core patch could not locate props board fetch.');
    out = out.replace(CORE_BOARD, CORE_BOARD_WITH_OVERLAY);
  }
  if (!out.includes('proplinePushBoard: proplineLiveBoardOverlayHealth()')) {
    if (!out.includes(CORE_HEALTH)) throw new Error('PropLine push-board core patch could not locate realtime health.');
    out = out.replace(CORE_HEALTH, `${CORE_HEALTH}, proplinePushBoard: proplineLiveBoardOverlayHealth(), proplineDeliveries: proplineDeliveryHealth()`);
  }
  if (!out.includes('startProplineDeliveryHealthMonitor();')) {
    if (!out.includes(CORE_START)) throw new Error('PropLine push-board core patch could not locate realtime start.');
    out = out.replace(CORE_START, `${CORE_START}\nstartProplineDeliveryHealthMonitor();`);
  }
  return out;
}

export function patchProplinePushBoardUi(source) {
  const out = String(source || '');
  if (out.includes('obligePropsPushBoardWatcher')) return out;
  if (!out.includes('asRefresh')) throw new Error('PropLine push-board UI patch could not locate Refresh control.');
  return out + String.raw`
;(function obligePropsPushBoardWatcher(){
  var timer=null,lastBySport=new Map(),busy=false;
  function currentSport(){var on=document.querySelector('#as5 .asSport.on');return on?String(on.textContent||'').trim().toUpperCase():'';}
  function drawerOpen(){var bg=document.getElementById('asDrawerBg');return !!(bg&&!bg.hidden);}
  function movesOpen(){var panel=document.getElementById('asMovesMainView');return !!(panel&&!panel.hidden);}
  function schedule(){clearTimeout(timer);if(document.hidden)return;timer=setTimeout(check,5000);}
  async function check(){
    if(busy||document.hidden){schedule();return;}
    var sport=currentSport();if(!sport){schedule();return;}busy=true;
    try{
      var q=new URLSearchParams({sport:sport,limit:'1'}),r=await fetch('/api/apex/live-moves?'+q.toString(),{credentials:'same-origin',headers:{accept:'application/json'},cache:'no-store'});
      if(!r.ok)return;var data=await r.json(),row=Array.isArray(data.events)&&data.events[0],seq=Number(row&&row.sequence);
      if(!Number.isFinite(seq)||seq<=0)return;
      var previous=lastBySport.get(sport);lastBySport.set(sport,seq);
      if(Number.isFinite(previous)&&seq>previous&&!drawerOpen()&&!movesOpen()){
        var refresh=document.getElementById('asRefresh');if(refresh&&!refresh.disabled)refresh.click();
      }
    }catch{}finally{busy=false;schedule();}
  }
  document.addEventListener('visibilitychange',function(){if(!document.hidden)check();else clearTimeout(timer);});
  window.addEventListener('focus',check);
  schedule();
}());
`;
}
