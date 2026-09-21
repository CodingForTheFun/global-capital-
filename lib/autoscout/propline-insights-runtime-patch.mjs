// Surfaces the PropLine analytical endpoints inside the research drawer.
//
// The data layer and /api/apex/propline existed but nothing in the UI called
// them, so ten paid endpoints were reachable and invisible. The drawer is the
// right home for eight of them: it is already the per-prop view, already knows
// the player, market, side and event, and already renders sections.
//
// Everything added here is enrichment. It loads after the drawer has rendered,
// renders nothing at all when an answer is absent, and can never delay or block
// the research the drawer exists to show.
const DRAWER_BODY_END = "+panels[panel]+'</div>';";
const RENDER_DRAWER = 'function renderDrawer(){';

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`PropLine insights patch expected one ${label} anchor; found ${count}.`);
  return source.replace(anchor, replacement);
}

const INSIGHTS_FUNCTIONS = String.raw`
var proplineCache=new Map(),proplineToken=0;
function proplineAsk(kind,params){
 var q=new URLSearchParams(Object.assign({kind:kind},params||{}));
 var key=q.toString();
 if(proplineCache.has(key))return Promise.resolve(proplineCache.get(key));
 return nativeFetch('/api/apex/propline?'+key).then(function(r){return r.ok?r.json():null;}).then(function(j){
  var data=j&&j.available?j.data:null;proplineCache.set(key,data);return data;
 }).catch(function(){return null;});
}
function proplinePct(value){return value==null?'':Math.round(value*100)+'%';}
function proplineBlock(title,inner){return inner?'<div class="asPlBlock"><small>'+esc(title)+'</small>'+inner+'</div>':'';}
function proplineTrendsHtml(data){
 if(!data||!data.windows)return '';
 var order=['l5','l10','l20','l50'],cells=order.filter(function(k){return data.windows[k];}).map(function(k){
  var w=data.windows[k];
  if(w.hitRate==null||!w.games)return '';
  return '<span class="asPlWin"><b>'+esc(k.toUpperCase())+'</b><em>'+esc(proplinePct(w.hitRate))+'</em><i>'+esc(String(w.games))+'g</i></span>';
 }).join('');
 return proplineBlock('Graded hit rate',cells?'<div class="asPlWins">'+cells+'</div>':'');
}
function proplineMovementHtml(data,g){
 if(!data||!data.moves)return '';
 var mine=data.moves.filter(function(m){return m.playerName&&g.playerName&&m.playerName.toLowerCase()===g.playerName.toLowerCase();}).slice(0,4);
 if(!mine.length)return '';
 var rows=mine.map(function(m){
  var delta=m.pointDelta;
  var cls=delta>0?'up':delta<0?'down':'flat';
  var arrow=delta>0?'▲':delta<0?'▼':'■';
  return '<div class="asPlMove"><span class="'+cls+'">'+arrow+' '+esc(delta==null?'—':dec(Math.abs(delta)))+'</span>'
   +'<em>'+esc(m.openingPoint==null?'—':dec(m.openingPoint))+' → '+esc(m.currentPoint==null?'—':dec(m.currentPoint))+'</em>'
   +'<i>'+esc(m.bookmakerKey||'')+(m.steamScore!=null?' · steam '+esc(String(Math.round(m.steamScore))):'')+'</i></div>';
 }).join('');
 return proplineBlock('Line movement',rows);
}
function proplineBestHtml(data,g){
 if(!data||!data.best)return '';
 var mine=data.best.filter(function(b){return b.playerName&&g.playerName&&b.playerName.toLowerCase()===g.playerName.toLowerCase();}).slice(0,3);
 if(!mine.length)return '';
 var rows=mine.map(function(b){
  return '<div class="asPlBest"><b>'+esc((b.side||'').charAt(0)+' '+(b.line==null?'—':dec(b.line)))+'</b>'
   +'<em>'+esc(b.price==null?'—':money(b.price))+'</em>'
   +'<i>'+esc(b.bookmakerKey||'')+(b.booksCompared?' of '+esc(String(b.booksCompared)):'')+'</i></div>';
 }).join('');
 return proplineBlock('Best price across books',rows);
}
function proplineClosingHtml(data,g){
 if(!data||!data.closes)return '';
 var mine=data.closes.filter(function(c){return c.playerName&&g.playerName&&c.playerName.toLowerCase()===g.playerName.toLowerCase();});
 if(!mine.length)return '';
 var c=mine[0];
 if(c.openingLine==null&&c.closingLine==null)return '';
 // A close captured early is labelled rather than passed off as a real close.
 var note=c.stale?'<i class="asPlWarn">close captured early</i>':'';
 return proplineBlock('Open → close','<div class="asPlOpenClose"><b>'+esc(c.openingLine==null?'—':dec(c.openingLine))+'</b><span>→</span><b>'+esc(c.closingLine==null?'—':dec(c.closingLine))+'</b>'+note+'</div>');
}
function proplineContextHtml(data){
 if(!data)return '';
 var bits=[];
 if(data.weather&&(data.weather.temperature_f!=null||data.weather.summary))bits.push(esc([data.weather.temperature_f!=null?data.weather.temperature_f+'°F':'',data.weather.summary||'',data.weather.wind_mph!=null?data.weather.wind_mph+'mph wind':''].filter(Boolean).join(' · ')));
 if(data.roof)bits.push(esc(data.roof));
 if(data.venue)bits.push(esc(data.venue));
 if(Array.isArray(data.probablePitchers)&&data.probablePitchers.length)bits.push(esc(data.probablePitchers.map(function(p){return typeof p==='string'?p:(p&&p.name)||'';}).filter(Boolean).join(' vs ')));
 return bits.length?proplineBlock('Conditions','<div class="asPlCtx">'+bits.join(' · ')+'</div>'):'';
}
function proplineProjectionHtml(data,g){
 if(!data||!data.projections)return '';
 var mine=data.projections.filter(function(p){return p.playerName&&g.playerName&&p.playerName.toLowerCase()===g.playerName.toLowerCase();});
 if(!mine.length)return '';
 // Labelled market-implied, never presented as this product's own model.
 return proplineBlock('Market-implied','<div class="asPlProj"><b>'+esc(dec(mine[0].projection))+'</b><i>implied by the no-vig market, not a model</i></div>');
}
function proplineResultsHtml(data,g){
 if(!data||!data.results)return '';
 var mine=data.results.filter(function(r){return r.playerName&&g.playerName&&r.playerName.toLowerCase()===g.playerName.toLowerCase();});
 if(!mine.length)return '';
 var r=mine[0];
 return proplineBlock('Graded result','<div class="asPlResult '+esc(r.resolution)+'"><b>'+esc(r.resolution.toUpperCase())+'</b><em>'+esc(r.actualValue==null?'—':dec(r.actualValue))+'</em><i>vs '+esc(r.line==null?'—':dec(r.line))+'</i></div>');
}
function loadProplineInsights(g){
 var host=document.getElementById('asProplineInsights');
 if(!host||!g||!g.sport)return;
 var token=++proplineToken;
 var sport=g.sport,eventId=g.providerEventId||g.eventId||'',player=g.playerName||'';
 var asks=[
  player?proplineAsk('trends',{sport:sport,playerName:player}):Promise.resolve(null),
  eventId?proplineAsk('movement',{sport:sport,eventId:eventId}):Promise.resolve(null),
  eventId?proplineAsk('best-line',{sport:sport,eventId:eventId}):Promise.resolve(null),
  eventId?proplineAsk('closing',{sport:sport,eventId:eventId}):Promise.resolve(null),
  eventId?proplineAsk('context',{sport:sport,eventId:eventId}):Promise.resolve(null),
  eventId?proplineAsk('projections',{sport:sport,eventId:eventId}):Promise.resolve(null),
  eventId?proplineAsk('results',{sport:sport,eventId:eventId}):Promise.resolve(null)
 ];
 Promise.all(asks).then(function(out){
  // A newer prop was opened while these were in flight.
  if(token!==proplineToken)return;
  var html=[proplineTrendsHtml(out[0]),proplineMovementHtml(out[1],g),proplineBestHtml(out[2],g),
   proplineClosingHtml(out[3],g),proplineResultsHtml(out[6],g),proplineProjectionHtml(out[5],g),proplineContextHtml(out[4])].filter(Boolean).join('');
  if(!html){host.hidden=true;host.innerHTML='';return;}
  host.hidden=false;
  host.innerHTML='<div class="asSectionTitle"><h3>PropLine</h3><span>graded and cross-book</span></div><div class="asSectionBody asPlGrid">'+html+'</div>';
 }).catch(function(){host.hidden=true;});
}
`;

const INSIGHTS_CSS = String.raw`
#as5 .asProplineSection{border:1px solid #24334c;border-radius:12px;background:#0d131e;margin:9px 0;overflow:hidden}
#as5 .asPlGrid{display:grid;gap:8px}
#as5 .asPlBlock small{display:block;color:#718097;font-size:6px;text-transform:uppercase;letter-spacing:.08em;font-weight:950;margin-bottom:4px}
#as5 .asPlWins{display:flex;gap:6px;flex-wrap:wrap}
#as5 .asPlWin{border:1px solid #24334c;background:#0a1019;border-radius:8px;padding:6px 8px;display:grid;justify-items:start}
#as5 .asPlWin b{font-size:6px;color:#8090a6}
#as5 .asPlWin em{font-style:normal;font-size:13px;font-weight:1000;color:#7ddcb0}
#as5 .asPlWin i{font-style:normal;font-size:6px;color:#6f7d92}
#as5 .asPlMove,#as5 .asPlBest{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #1b2536;font-size:9px}
#as5 .asPlMove:last-child,#as5 .asPlBest:last-child{border-bottom:0}
#as5 .asPlMove .up{color:#33e49b;font-weight:950}
#as5 .asPlMove .down{color:#ff6878;font-weight:950}
#as5 .asPlMove .flat{color:#8896aa;font-weight:950}
#as5 .asPlMove em,#as5 .asPlBest em{font-style:normal;color:#cfe0f5}
#as5 .asPlMove i,#as5 .asPlBest i{font-style:normal;color:#6f7d92;font-size:7px;text-align:right}
#as5 .asPlBest b{color:#7ddcb0;font-weight:1000}
#as5 .asPlOpenClose{display:flex;gap:7px;align-items:center;font-size:12px;font-weight:1000}
#as5 .asPlOpenClose span{color:#6f7d92;font-weight:400}
#as5 .asPlWarn{font-style:normal;font-size:7px;color:#f0c45f;font-weight:900;margin-left:6px}
#as5 .asPlCtx{font-size:9px;color:#cfe0f5}
#as5 .asPlProj b{font-size:15px;font-weight:1000;color:#8b7dff}
#as5 .asPlProj i{display:block;font-style:normal;font-size:7px;color:#6f7d92;margin-top:2px}
#as5 .asPlResult{display:flex;gap:8px;align-items:baseline}
#as5 .asPlResult b{font-size:11px;font-weight:1000}
#as5 .asPlResult.won b{color:#33e49b}
#as5 .asPlResult.lost b{color:#ff6878}
#as5 .asPlResult.push b,#as5 .asPlResult.void b{color:#f0c45f}
#as5 .asPlResult em{font-style:normal;font-size:14px;font-weight:1000}
#as5 .asPlResult i{font-style:normal;font-size:7px;color:#6f7d92}
`;

export function patchProplineInsightsUi(source) {
  let patched = String(source ?? '');
  // Unlike patches that consume their anchor, this one inserts beside anchors
  // that survive - so a second run would silently duplicate every function and
  // append a second section. Returning unchanged makes re-running safe.
  if (patched.includes('function loadProplineInsights(')) return patched;
  patched = replaceOnce(patched, RENDER_DRAWER, `${INSIGHTS_FUNCTIONS}\n${RENDER_DRAWER}`, 'renderDrawer');
  patched = replaceOnce(
    patched,
    DRAWER_BODY_END,
    `${DRAWER_BODY_END}\n loadProplineInsights(g);`,
    'drawer body end',
  );
  // The container is appended to the drawer body rather than spliced into the
  // tab panels, so a tab change cannot strip it and the panels keep their shape.
  patched = replaceOnce(
    patched,
    "<div class=\"asDrawerBody\" id=\"asDrawerBody\"></div>",
    "<div class=\"asDrawerBody\" id=\"asDrawerBody\"></div><div class=\"asProplineSection\" id=\"asProplineInsights\" hidden></div>",
    'drawer body container',
  );
  const styleRuntime = `\n;(function installProplineInsightsStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-propline-insights-style'))return;var style=document.createElement('style');style.id='oblige-propline-insights-style';style.textContent=${JSON.stringify(INSIGHTS_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
  return patched + styleRuntime;
}
