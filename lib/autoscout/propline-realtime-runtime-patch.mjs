const CORE_WEBHOOK_IMPORT = "import { handleProplineWebhook, WEBHOOK_PATH as PROPLINE_WEBHOOK_PATH } from '../lib/data-sources/propline/webhook-route.mjs';";
const CORE_REALTIME_IMPORT = "import { handleProplineRealtimeEvent, proplineRealtimeSnapshot, proplineRealtimeHealth, startProplineRealtime } from '../lib/data-sources/propline/realtime.mjs';";
const CORE_WEBHOOK_CALL = "if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res);";
const CORE_START = 'startFrugalPersistence();';
const CORE_HEALTH = 'proplineWebhook: proplineWebhookHealth()';

export function patchProplineRealtimeCore(source) {
  let out = String(source || '');
  if (!out.includes(CORE_REALTIME_IMPORT)) {
    if (!out.includes(CORE_WEBHOOK_IMPORT)) throw new Error('PropLine realtime core patch could not locate webhook import.');
    out = out.replace(CORE_WEBHOOK_IMPORT, `${CORE_WEBHOOK_IMPORT}\n${CORE_REALTIME_IMPORT}`);
  }
  if (!out.includes('proplineRealtimeSnapshot({ sport:')) {
    if (!out.includes(CORE_WEBHOOK_CALL)) throw new Error('PropLine realtime core patch could not locate webhook route.');
    out = out.replace(CORE_WEBHOOK_CALL, [
      "if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res, { onEvent: handleProplineRealtimeEvent });",
      "  if (req.method === 'GET' && url.pathname === '/api/propline/live') {",
      "    if (!rateAllowed(req, 'propline-live', 180, 60_000)) return json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many live-movement requests.' }, { 'retry-after': '30' });",
      "    return json(res, 200, { ok: true, ...proplineRealtimeSnapshot({ sport: url.searchParams.get('sport'), type: url.searchParams.get('type'), player: url.searchParams.get('player'), market: url.searchParams.get('market'), eventId: url.searchParams.get('eventId'), limit: url.searchParams.get('limit') }) });",
      "  }",
    ].join('\n  '));
  }
  if (!out.includes('proplineRealtime: proplineRealtimeHealth()')) {
    if (!out.includes(CORE_HEALTH)) throw new Error('PropLine realtime core patch could not locate health payload.');
    out = out.replace(CORE_HEALTH, `${CORE_HEALTH}, proplineRealtime: proplineRealtimeHealth()`);
  }
  if (!out.includes('startProplineRealtime();')) {
    if (!out.includes(CORE_START)) throw new Error('PropLine realtime core patch could not locate scheduler bootstrap.');
    out = out.replace(CORE_START, `${CORE_START}\nstartProplineRealtime();`);
  }
  return out;
}

const FRONT_CORE_CHILD = "const apex = child('apex-v2/server-core.mjs', APEX_PORT, 'Auto Scout data core');";
const FRONT_RUNTIME_CHILD = "const apex = child('apex-v2/.server-core-propline-runtime.mjs', APEX_PORT, 'Auto Scout data core');";
const FRONT_LINE_HISTORY = "if (url.pathname === '/api/apex/line-history') return { port: APEX_PORT, path: '/api/line-history' + url.search, injectShell: false };";
const FRONT_GATE_URL = "const url = new URL(req.url || '/', 'http://localhost');\n  if (!gateActive()) return false;";

export function patchProplineRealtimeFrontdoor(source) {
  let out = String(source || '');
  if (!out.includes(FRONT_RUNTIME_CHILD)) {
    if (!out.includes(FRONT_CORE_CHILD)) throw new Error('PropLine realtime frontdoor patch could not locate data-core child.');
    out = out.replace(FRONT_CORE_CHILD, FRONT_RUNTIME_CHILD);
  }
  if (!out.includes("url.pathname === '/api/apex/live-moves'")) {
    if (!out.includes(FRONT_LINE_HISTORY)) throw new Error('PropLine realtime frontdoor patch could not locate line-history route.');
    out = out.replace(FRONT_LINE_HISTORY, `${FRONT_LINE_HISTORY}\n  if (url.pathname === '/api/apex/live-moves') return { port: APEX_PORT, path: '/api/propline/live' + url.search, injectShell: false };\n  if (url.pathname === '/api/propline/webhook') return { port: APEX_PORT, path: '/api/propline/webhook' + url.search, injectShell: false };`);
  }
  if (!out.includes("url.pathname === '/api/propline/webhook') return false")) {
    if (!out.includes(FRONT_GATE_URL)) throw new Error('PropLine realtime frontdoor patch could not locate account gate.');
    out = out.replace(FRONT_GATE_URL, "const url = new URL(req.url || '/', 'http://localhost');\n  // PropLine signs this public callback with HMAC; session gating would block upstream delivery.\n  if (url.pathname === '/api/propline/webhook') return false;\n  if (!gateActive()) return false;");
  }
  return out;
}

export function patchProplineRealtimeUi(source) {
  const out = String(source || '');
  if (out.includes('obligePropsMarketMovesView')) return out;
  if (!out.includes('asNav')) throw new Error('PropLine realtime UI patch could not locate ObligeProps navigation.');

  const runtime = String.raw`
;(function obligePropsMarketMovesView(){
  var started=false,state={active:false,type:'',allSports:false,timer:null,loading:false,drawerTimer:null};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){var n=Number(v);return Number.isFinite(n)?n:null;}
  function show(v){return v===null||v===undefined||v===''?'—':esc(v);}
  function price(v){var n=num(v);return n===null?'—':(n>0?'+':'')+n;}
  function ago(v){var t=Date.parse(v||'');if(!Number.isFinite(t))return '—';var s=Math.max(0,Math.floor((Date.now()-t)/1000));if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
  function currentSport(){var on=document.querySelector('#as5 .asSport.on');return on?String(on.textContent||'').trim().toUpperCase():'';}
  function labelMarket(v){return String(v||'Player prop').replace(/^(player_|batter_|pitcher_)/,'').replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});}
  function dot(type){return type==='steam'?'⚡':type==='market_suspended'?'⊘':type==='resolution'?'✓':'↗';}
  function typeLabel(type){return type==='steam'?'Steam':type==='market_suspended'?'Off Board':type==='resolution'?'Grade':'Line Move';}
  function eventCard(row){
    var type=String(row.type||'line_movement'),klass=' '+type.replace(/_/g,'-');
    var who=row.playerName||((row.awayTeam||row.homeTeam)?[row.awayTeam,row.homeTeam].filter(Boolean).join(' @ '):'Market update');
    var market=labelMarket(row.marketDescription||row.marketKey);
    var book=row.bookmakerTitle||row.bookmakerKey||((row.books||[]).length?(row.books.length+' books'):'Market');
    var detail='';
    if(type==='steam') detail='<div class="asMoveMetric"><span>Steam</span><b>'+show(row.steamScore)+'</b></div><div class="asMoveMetric"><span>Books</span><b>'+show(row.booksMoved)+' / '+show(row.booksQuoting)+'</b></div><div class="asMoveMetric"><span>Direction</span><b>'+show(row.consensusDirection)+'</b></div>';
    else if(type==='market_suspended') detail='<div class="asMoveMetric"><span>Status</span><b>Off board</b></div><div class="asMoveMetric"><span>Books agree</span><b>'+show(row.booksAgreeing)+'</b></div><div class="asMoveMetric"><span>Markets</span><b>'+show((row.markets||[]).length)+'</b></div>';
    else if(type==='resolution') detail='<div class="asMoveMetric"><span>Result</span><b>'+show(row.resolution)+'</b></div><div class="asMoveMetric"><span>Actual</span><b>'+show(row.actualValue)+'</b></div><div class="asMoveMetric"><span>Line</span><b>'+show(row.current&&row.current.point)+'</b></div>';
    else detail='<div class="asMoveMetric"><span>Line</span><b>'+show(row.previous&&row.previous.point)+' → '+show(row.current&&row.current.point)+'</b></div><div class="asMoveMetric"><span>Price</span><b>'+price(row.previous&&row.previous.price)+' → '+price(row.current&&row.current.price)+'</b></div><div class="asMoveMetric"><span>Move</span><b>'+(num(row.priceChangePct)===null?'—':esc(Number(row.priceChangePct).toFixed(1))+'%')+'</b></div>';
    var flavor=row.dfsOddsType&&row.dfsOddsType!=='standard'?'<span class="asMoveFlavor">'+esc(row.dfsOddsType)+'</span>':'';
    return '<article class="asMoveCard'+klass+'"><div class="asMoveTop"><span class="asMoveType">'+dot(type)+' '+typeLabel(type)+'</span><span class="asMoveWhen">'+esc(ago(row.occurredAt||row.receivedAt))+'</span></div><div class="asMoveWho"><h3>'+esc(who)+flavor+'</h3><p>'+esc(market)+' · '+esc(book)+'</p></div><div class="asMoveMetrics">'+detail+'</div></article>';
  }
  async function api(path){var r=await fetch(path,{credentials:'same-origin',headers:{accept:'application/json'},cache:'no-store'});var b=await r.json().catch(function(){return null;});if(r.status===401){location.href='/';throw new Error('Sign in required');}if(!r.ok)throw new Error((b&&b.message)||'Market moves unavailable');return b;}
  function build(){
    var root=document.getElementById('as5'),nav=root&&root.querySelector('.asNav'),main=root&&root.querySelector('.asMain');if(!root||!nav||!main)return false;
    var btn=document.createElement('button');btn.type='button';btn.id='asMovesMainTab';btn.className='asNavMoves';btn.setAttribute('aria-label','Market moves and steam');btn.innerHTML='<span class="asNavIcon" aria-hidden="true">↯</span><span>Moves</span>';
    var saved=nav.querySelector('[data-view="saved"]');nav.insertBefore(btn,saved||null);
    var style=document.createElement('style');style.id='oblige-market-moves-style';style.textContent=[
      '#as5 #asMovesMainView[hidden]{display:none!important}',
      '#as5 .asMovesEmbedded{max-width:1380px;margin:auto;padding:14px 14px 96px}',
      '#as5 .asMovesHead{display:flex;gap:12px;align-items:flex-end;margin:2px 0 12px}',
      '#as5 .asMovesHead h1{margin:0;font-size:25px;letter-spacing:-.05em}',
      '#as5 .asMovesHead p{margin:4px 0 0;color:#8394ae;font-size:10px}',
      '#as5 .asMovesLive{margin-left:auto;border:1px solid rgba(54,225,157,.35);background:rgba(13,61,44,.28);border-radius:999px;padding:7px 10px;color:#73efb9;font-size:8px;font-weight:950}',
      '#as5 .asMovesLive.off{border-color:rgba(255,111,127,.35);background:rgba(84,25,34,.3);color:#ff9aaa}',
      '#as5 .asMovesSummary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}',
      '#as5 .asMovesSummary>div{border:1px solid #25344e;background:linear-gradient(145deg,#101a2b,#090f19);border-radius:13px;padding:10px 11px}',
      '#as5 .asMovesSummary span{display:block;color:#7d8ea9;font-size:7px;text-transform:uppercase;letter-spacing:.07em;font-weight:900}',
      '#as5 .asMovesSummary b{display:block;font-size:18px;margin-top:2px}',
      '#as5 .asMovesTools{display:flex;gap:7px;align-items:center;margin-bottom:10px;overflow:auto;scrollbar-width:none}',
      '#as5 .asMovesTools::-webkit-scrollbar{display:none}',
      '#as5 .asMoveChip,#as5 .asMovesRefresh{height:34px;border:1px solid #263650;background:#0c1421;color:#9cabc1;border-radius:10px;padding:0 11px;font-size:8px;font-weight:900;white-space:nowrap}',
      '#as5 .asMoveChip.on{background:#1e3150;color:#fff;border-color:#45668f}',
      '#as5 .asMovesRefresh{margin-left:auto;color:#eef4ff}',
      '#as5 .asTrending{display:flex;gap:6px;overflow:auto;margin:0 0 11px;scrollbar-width:none}',
      '#as5 .asTrending::-webkit-scrollbar{display:none}',
      '#as5 .asTrendPill{border:1px solid rgba(99,119,159,.3);background:#0d1523;border-radius:999px;padding:6px 9px;font-size:8px;color:#a9b7cb;white-space:nowrap}',
      '#as5 .asMovesGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '#as5 .asMoveCard{border:1px solid #25344e;background:linear-gradient(145deg,#101a2b,#090f19);border-radius:15px;padding:11px;box-shadow:0 12px 30px rgba(0,0,0,.18)}',
      '#as5 .asMoveCard.steam{border-color:rgba(241,193,83,.44);box-shadow:inset 0 0 30px rgba(241,193,83,.025)}',
      '#as5 .asMoveCard.market-suspended{border-color:rgba(255,107,125,.4)}',
      '#as5 .asMoveCard.resolution{border-color:rgba(61,225,162,.32)}',
      '#as5 .asMoveTop{display:flex;justify-content:space-between;gap:10px}',
      '#as5 .asMoveType{font-size:8px;font-weight:950;text-transform:uppercase;letter-spacing:.07em;color:#69e9b3}',
      '#as5 .asMoveCard.steam .asMoveType{color:#f3c965}',
      '#as5 .asMoveCard.market-suspended .asMoveType{color:#ff8090}',
      '#as5 .asMoveWhen{font-size:8px;color:#7486a1}',
      '#as5 .asMoveWho h3{font-size:13px;margin:7px 0 2px}',
      '#as5 .asMoveWho p{font-size:8px;color:#8192ad;margin:0}',
      '#as5 .asMoveFlavor{font-size:7px;margin-left:6px;padding:2px 5px;border-radius:999px;background:#29334a;color:#c8d4e6;text-transform:uppercase}',
      '#as5 .asMoveMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:9px}',
      '#as5 .asMoveMetric{border:1px solid rgba(91,116,157,.22);background:rgba(5,10,17,.42);border-radius:9px;padding:7px}',
      '#as5 .asMoveMetric span{display:block;color:#71829d;font-size:6px;text-transform:uppercase;letter-spacing:.06em}',
      '#as5 .asMoveMetric b{display:block;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#as5 .asMovesEmpty{grid-column:1/-1;border:1px dashed #2c3b55;border-radius:14px;padding:22px;text-align:center;color:#7f90aa;font-size:9px}',
      '#as5 .asMovesEmpty b{display:block;color:#f3f7ff;font-size:12px;margin-bottom:4px}',
      '#as5 .asPlayerSignals{margin-top:14px;border-top:1px solid rgba(91,116,157,.22);padding-top:12px}',
      '#as5 .asPlayerSignals h3{font-size:12px;margin:0 0 8px}',
      '#as5 .asPlayerSignals .asMovesGrid{grid-template-columns:1fr}',
      '@media(max-width:650px){#as5 .asMovesEmbedded{padding:10px 8px 88px}#as5 .asMovesHead h1{font-size:21px}#as5 .asMovesSummary{grid-template-columns:repeat(2,1fr)}#as5 .asMovesGrid{grid-template-columns:1fr}#as5 .asMovesHead p{max-width:230px}#as5 .asMovesLive{padding:6px 8px}#as5 .asMovesRefresh{margin-left:0}#as5 .asNavMoves{display:grid!important;grid-template-rows:22px 13px!important;place-items:center!important}}'
    ].join('\n');(document.head||document.documentElement).appendChild(style);
    var panel=document.createElement('main');panel.id='asMovesMainView';panel.className='asMovesEmbedded';panel.hidden=true;panel.innerHTML=[
      '<section class="asMovesHead"><div><span class="asEyebrow">MARKET INTELLIGENCE</span><h1>Market Moves</h1><p>Real-time line movement, steam, off-board signals and graded props.</p></div><span id="asMovesLive" class="asMovesLive off">CONNECTING</span></section>',
      '<section class="asMovesSummary"><div><span>Line moves · 15m</span><b id="asMovesCountLine">0</b></div><div><span>Steam · 15m</span><b id="asMovesCountSteam">0</b></div><div><span>Off board · 15m</span><b id="asMovesCountOff">0</b></div><div><span>Grades · 15m</span><b id="asMovesCountGrades">0</b></div></section>',
      '<section class="asMovesTools"><button class="asMoveChip on" data-move-type="">All</button><button class="asMoveChip" data-move-type="steam">Steam</button><button class="asMoveChip" data-move-type="line_movement">Line Moves</button><button class="asMoveChip" data-move-type="market_suspended">Off Board</button><button class="asMoveChip" data-move-type="resolution">Grades</button><button class="asMoveChip" id="asMovesSport">Current sport</button><button class="asMovesRefresh" id="asMovesRefresh">Refresh</button></section>',
      '<div class="asTrending" id="asMovesTrending"></div><section class="asMovesGrid" id="asMovesGrid"><div class="asMovesEmpty"><b>Connecting to market stream</b>Live signals will appear here.</div></section>'
    ].join('');main.insertAdjacentElement('afterend',panel);
    btn.onclick=function(){activate();};
    nav.addEventListener('click',function(e){var b=e.target.closest('button');if(!b||b===btn)return;if(state.active)deactivate();},true);
    document.addEventListener('click',function(e){var chip=e.target.closest('[data-move-type]');if(chip&&panel.contains(chip)){state.type=chip.getAttribute('data-move-type')||'';panel.querySelectorAll('[data-move-type]').forEach(function(x){x.classList.toggle('on',x===chip);});load();}});
    panel.querySelector('#asMovesSport').onclick=function(){state.allSports=!state.allSports;this.textContent=state.allSports?'All sports':'Current sport';load();};
    panel.querySelector('#asMovesRefresh').onclick=function(){load();};
    document.addEventListener('visibilitychange',schedule);
    observeDrawer();
    return true;
  }
  function activate(){var root=document.getElementById('as5'),main=root&&root.querySelector('.asMain'),panel=document.getElementById('asMovesMainView'),btn=document.getElementById('asMovesMainTab');if(!main||!panel||!btn)return;state.active=true;var live=document.getElementById('asLiveMainView');if(live)live.hidden=true;main.hidden=true;panel.hidden=false;root.querySelectorAll('.asNav button').forEach(function(x){x.classList.toggle('on',x===btn);x.removeAttribute('aria-current');});btn.setAttribute('aria-current','page');load();}
  function deactivate(){state.active=false;clearTimeout(state.timer);var root=document.getElementById('as5'),main=root&&root.querySelector('.asMain'),panel=document.getElementById('asMovesMainView'),btn=document.getElementById('asMovesMainTab');if(panel)panel.hidden=true;if(main)main.hidden=false;if(btn)btn.classList.remove('on');}
  function schedule(){clearTimeout(state.timer);if(!state.active||document.hidden)return;state.timer=setTimeout(load,12000);}
  async function load(){if(!state.active||state.loading)return;state.loading=true;var grid=document.getElementById('asMovesGrid');try{var q=new URLSearchParams({limit:'160'});var s=currentSport();if(!state.allSports&&s)q.set('sport',s);if(state.type)q.set('type',state.type);var data=await api('/api/apex/live-moves?'+q.toString()),sum=data.summary||{},meta=data.meta||{};document.getElementById('asMovesCountLine').textContent=sum.lineMovements||0;document.getElementById('asMovesCountSteam').textContent=sum.steam||0;document.getElementById('asMovesCountOff').textContent=sum.marketSuspensions||0;document.getElementById('asMovesCountGrades').textContent=sum.resolutions||0;var live=document.getElementById('asMovesLive');live.textContent=meta.connected?'LIVE':'WARMING';live.classList.toggle('off',!meta.connected);document.getElementById('asMovesTrending').innerHTML=(data.trendingPlayers||[]).map(function(p){return '<span class="asTrendPill">'+esc(p.playerName)+' · '+esc(p.signals)+' signals</span>';}).join('');var rows=data.events||[];grid.innerHTML=rows.length?rows.map(eventCard).join(''):'<div class="asMovesEmpty"><b>No matching signals yet</b>PropLine is connected; this filter has no recent movement.</div>';}catch(e){grid.innerHTML='<div class="asMovesEmpty"><b>Market stream temporarily unavailable</b>'+esc(e.message||'Try again shortly.')+'</div>';}finally{state.loading=false;schedule();}}
  function drawerPlayer(){var bg=document.getElementById('asDrawerBg'),title=document.getElementById('asDrawerTitle');if(!bg||bg.hidden||!title)return'';return String(title.textContent||'').trim().replace(/\s+research$/i,'');}
  async function updateDrawer(){var name=drawerPlayer(),body=document.getElementById('asDrawerBody');if(!name||!body)return;var old=body.querySelector('#asRealtimePlayerSignals');if(old)old.remove();try{var q=new URLSearchParams({player:name,limit:'6'}),s=currentSport();if(s)q.set('sport',s);var data=await api('/api/apex/live-moves?'+q.toString());if(!(data.events||[]).length)return;var section=document.createElement('section');section.id='asRealtimePlayerSignals';section.className='asPlayerSignals';section.innerHTML='<h3>Live market signals</h3><div class="asMovesGrid">'+data.events.map(eventCard).join('')+'</div>';body.appendChild(section);}catch{}}
  function observeDrawer(){var bg=document.getElementById('asDrawerBg');if(!bg)return;var observer=new MutationObserver(function(){clearTimeout(state.drawerTimer);state.drawerTimer=setTimeout(updateDrawer,180);});observer.observe(bg,{attributes:true,attributeFilter:['hidden']});}
  function boot(){if(started)return;started=build();if(!started)setTimeout(boot,350);}boot();
}());
`;
  return out + runtime;
}
