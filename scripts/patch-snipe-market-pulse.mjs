import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = 'apex-v2/scout-ui-v5.js';
if (!existsSync(file)) {
  console.warn(`[snipe-pulse] ${file} is not present; skipping the market-pulse patch.`);
} else {
  let source = readFileSync(file, 'utf8');
  function replaceOnce(from, to, label) {
    if (source.includes(to)) return;
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`[snipe-pulse] ${label} anchor count=${count}`);
    source = source.replace(from, to);
  }

  const functionAnchor = 'function snipeTableHtml(groups){';
  const helpers = String.raw`
var snipePulseCache=new Map(),snipePulseInflight=new Map();
function snipePulseStyle(){return '<style id="asSnipePulseStyle">'
 +'.asSnipeReady{position:relative;overflow:hidden;border:1px solid #355173;background:linear-gradient(135deg,#111d34 0%,#0b1425 58%,#10243d 100%);border-radius:18px;padding:15px;margin-bottom:10px;box-shadow:0 18px 50px rgba(0,0,0,.18)}'
 +'.asSnipeReady:before{content:"";position:absolute;width:180px;height:180px;border-radius:50%;right:-78px;top:-112px;background:radial-gradient(circle,rgba(75,134,255,.28),transparent 68%);pointer-events:none}.asSnipeReadyTop{position:relative;display:flex;gap:12px;align-items:flex-start}.asSnipeReadyCopy{min-width:0;flex:1}.asSnipeKicker{display:block;color:#7da9e8;font-size:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.asSnipeReady h3{margin:4px 0 4px;font-size:18px;letter-spacing:-.03em}.asSnipeReady p{margin:0;color:#9cabc1;font-size:11px;line-height:1.55;max-width:760px}.asSnipeSource{position:relative;flex:none;border:1px solid #2e664f;background:#0d2a20;color:#82f0bc;border-radius:999px;padding:6px 9px;font-size:8px;font-weight:950}.asSnipeTrack{position:relative;height:7px;margin-top:13px;border-radius:999px;background:#0a101b;border:1px solid #21304a;overflow:hidden}.asSnipeTrack span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#4f88ff,#5ee0ba);box-shadow:0 0 18px rgba(94,224,186,.28)}.asSnipeReadyMeta{position:relative;display:flex;justify-content:space-between;gap:10px;margin-top:7px;color:#7f8da3;font-size:9px;font-weight:800}.asSnipeWatch{border:1px solid #263852;background:#0c1422;border-radius:16px;padding:12px;margin-bottom:10px}.asSnipeSectionHead{display:flex;align-items:center;gap:9px;margin-bottom:9px}.asSnipeSectionHead b{font-size:12px}.asSnipeSectionHead span{margin-left:auto;border:1px solid #534728;background:#241d0e;color:#f0cb70;border-radius:999px;padding:4px 7px;font-size:7px;font-weight:950;text-transform:uppercase;letter-spacing:.08em}.asSnipeWatchGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.asSnipeWatchCard{border:1px solid #253653;background:linear-gradient(180deg,#111d31,#0c1320);border-radius:13px;padding:10px;min-width:0}.asSnipeWatchCard strong{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asSnipeWatchCard small{display:block;color:#8190a8;font-size:8px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asSnipeCompare{display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-top:9px}.asSnipeQuote{border:1px solid #243754;background:#0a111c;border-radius:9px;padding:7px}.asSnipeQuote em{display:block;color:#74849b;font-size:7px;font-style:normal;text-transform:uppercase}.asSnipeQuote b{display:block;margin-top:2px;font-size:11px}.asSnipeArrow{color:#5f7391;font-size:11px}.asSnipeGap{display:flex;justify-content:space-between;gap:8px;margin-top:7px;color:#91a0b6;font-size:8px}.asSnipeGap b{color:#e7edf8}.asPulsePanel{border:1px solid #29465c;background:linear-gradient(160deg,#0d1727,#0a111c);border-radius:16px;padding:12px;margin-bottom:10px}.asPulseHead{display:flex;gap:10px;align-items:center;margin-bottom:10px}.asPulseHead b{font-size:12px}.asPulseHead p{margin:2px 0 0;color:#7f8ea5;font-size:8px}.asPulseLive{margin-left:auto;display:inline-flex;align-items:center;gap:5px;border:1px solid #285945;background:#0c251c;color:#7de7b6;border-radius:999px;padding:5px 8px;font-size:7px;font-weight:950;text-transform:uppercase;letter-spacing:.08em}.asPulseLive i{width:6px;height:6px;border-radius:50%;background:#43dfa0;box-shadow:0 0 0 4px rgba(67,223,160,.11)}.asPulseLive.off{border-color:#3b4558;background:#151b26;color:#8e9aab}.asPulseLive.off i{background:#718096;box-shadow:none}.asPulseStats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px}.asPulseStat{border:1px solid #22324a;background:#0a111d;border-radius:10px;padding:8px}.asPulseStat small{display:block;color:#708097;font-size:7px;text-transform:uppercase;letter-spacing:.08em}.asPulseStat b{display:block;margin-top:2px;font-size:13px}.asPulseGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.asPulseCard{border:1px solid #243650;background:#101928;border-radius:12px;padding:9px;min-width:0}.asPulseCard.steam{border-color:#66572c;background:linear-gradient(180deg,#211d12,#101723)}.asPulseCard.suspended{border-color:#5c3540;background:linear-gradient(180deg,#21131a,#101723)}.asPulseType{display:flex;justify-content:space-between;gap:8px;color:#8ba0bc;font-size:7px;font-weight:950;text-transform:uppercase;letter-spacing:.07em}.asPulseType em{font-style:normal;color:#6f7f96;font-weight:800;text-transform:none;letter-spacing:0}.asPulseCard strong{display:block;margin-top:6px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asPulseCard p{margin:2px 0 0;color:#7f8fa7;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asPulseMetric{margin-top:7px;color:#dce5f3;font-size:9px;font-weight:850}.asPulseLoading,.asPulseEmpty{display:flex;align-items:center;gap:8px;color:#8392a8;font-size:9px;min-height:38px}.asPulseLoading span{width:8px;height:8px;border-radius:50%;background:#4f88ff;box-shadow:0 0 0 0 rgba(79,136,255,.5);animation:asSnipePulse 1.4s infinite}@keyframes asSnipePulse{70%{box-shadow:0 0 0 8px rgba(79,136,255,0)}100%{box-shadow:0 0 0 0 rgba(79,136,255,0)}}.asSnipeFoot{margin:10px 2px 0!important}.asSnipeMiniEmpty{border:1px dashed #2b3c55;border-radius:12px;padding:12px;color:#8796aa;font-size:9px}.asSnipeMiniEmpty b{display:block;color:#dfe7f2;font-size:11px;margin-bottom:3px}'
 +'@media(max-width:720px){.asSnipeReady{padding:13px}.asSnipeReady h3{font-size:16px}.asSnipeReadyTop{align-items:flex-start}.asSnipeSource{font-size:7px}.asSnipeWatchGrid,.asPulseGrid{grid-template-columns:1fr}.asPulseStats{grid-template-columns:repeat(3,minmax(0,1fr))}.asPulsePanel,.asSnipeWatch{padding:10px}}'
 +'</style>';}
function snipeReadinessHtml(list,liveBooks){
 var added=num(payload&&payload.meta&&payload.meta.proplineSupplement&&payload.meta.proplineSupplement.added)||0;
 var needed=Math.max(0,3-liveBooks),progress=Math.max(0,Math.min(100,Math.round((liveBooks/3)*100)));
 var title=liveBooks>=3?'Consensus coverage ready':liveBooks===2?'One more independent book unlocks full consensus':liveBooks===1?'Waiting on a second reference book':'Waiting on live reference books';
 var detail=liveBooks>=3?'The board has enough independent books to verify consensus snipes when a real edge appears.':liveBooks===2?'Two-book disagreements stay on Market Watch unless one side is a verified sharp reference. The real-time feed still shows movement and steam while consensus builds.':'Snipes stay hidden until the board has enough independent evidence. Live market movement can still appear below.';
 var source=added>0?'PropLine +'+added+' lines':'PropLine live context';
 return '<section class="asSnipeReady"><div class="asSnipeReadyTop"><div class="asSnipeReadyCopy"><span class="asSnipeKicker">Snipe readiness</span><h3>'+esc(title)+'</h3><p>'+esc(detail)+'</p></div><span class="asSnipeSource">'+esc(source)+'</span></div><div class="asSnipeTrack" aria-label="Consensus coverage '+progress+' percent"><span style="width:'+progress+'%"></span></div><div class="asSnipeReadyMeta"><span>'+liveBooks+' live book'+(liveBooks===1?'':'s')+'</span><span>'+(needed?needed+' more for normal consensus':'3+ book threshold met')+'</span></div></section>';
}
function snipeWatchRows(list){
 var out=[];
 (list||[]).forEach(function(g){
  ['OVER','UNDER'].forEach(function(side){
   var latest=new Map();
   (g.rows||[]).forEach(function(r){
    if(String(r.side||'').toUpperCase()!==side||num(r.line)==null)return;
    var key=String(r.sportsbookKey||r.sportsbook||'').toLowerCase();if(!key)return;
    var at=Date.parse(r.ingestedAt||r.observedAt||r.updatedAt||r.providerUpdatedAt||'')||0,prev=latest.get(key),prevAt=prev?(Date.parse(prev.ingestedAt||prev.observedAt||prev.updatedAt||prev.providerUpdatedAt||'')||0):-1;
    if(!prev||at>=prevAt)latest.set(key,r);
   });
   var offers=Array.from(latest.values());if(offers.length<2)return;
   offers.sort(function(a,b){return side==='OVER'?num(a.line)-num(b.line):num(b.line)-num(a.line);});
   var target=offers[0],reference=offers[offers.length-1],gap=Math.abs(num(reference.line)-num(target.line));
   if(!(gap>0))return;
   out.push({g:g,side:side,target:target,reference:reference,gap:Number(gap.toFixed(2)),books:offers.length});
  });
 });
 out.sort(function(a,b){return b.gap-a.gap||String(a.g.playerName).localeCompare(String(b.g.playerName));});
 return out.slice(0,6);
}
function snipeWatchHtml(list){
 var rows=snipeWatchRows(list);
 if(!rows.length)return '<section class="asSnipeWatch"><div class="asSnipeSectionHead"><b>Market Watch</b><span>Unverified</span></div><div class="asSnipeMiniEmpty"><b>No two-book line gaps to watch.</b>The live pulse below will still surface verified movement, steam, and off-board events.</div></section>';
 return '<section class="asSnipeWatch"><div class="asSnipeSectionHead"><b>Market Watch</b><span>Not a snipe yet</span></div><div class="asSnipeWatchGrid">'+rows.map(function(row){
  var g=row.g,t=row.target,r=row.reference;
  return '<article class="asSnipeWatchCard"><strong>'+esc(g.playerName)+'</strong><small>'+esc(g.market)+' · '+esc(row.side)+'</small><div class="asSnipeCompare"><div class="asSnipeQuote"><em>Friendlier line</em><b>'+esc(t.sportsbook||t.sportsbookKey||'Book')+' '+esc(dec(t.line))+'</b></div><span class="asSnipeArrow">↔</span><div class="asSnipeQuote"><em>Reference</em><b>'+esc(r.sportsbook||r.sportsbookKey||'Book')+' '+esc(dec(r.line))+'</b></div></div><div class="asSnipeGap"><span>'+row.books+' books compared</span><b>'+esc(dec(row.gap))+' line gap</b></div></article>';
 }).join('')+'</div></section>';
}
function snipePulseHostHtml(){return '<section class="asPulsePanel" id="asSnipePulse" aria-live="polite"><div class="asPulseLoading"><span aria-hidden="true"></span>Loading live market pulse…</div></section>';}
function snipeAgo(value){var at=Date.parse(value||'');if(!Number.isFinite(at))return 'recent';var seconds=Math.max(0,Math.floor((Date.now()-at)/1000));if(seconds<60)return seconds+'s ago';if(seconds<3600)return Math.floor(seconds/60)+'m ago';return Math.floor(seconds/3600)+'h ago';}
function snipePulseEventHtml(row){
 var type=String(row&&row.type||'line_movement'),tone=type==='steam'?'steam':type==='market_suspended'?'suspended':'move';
 var label=type==='steam'?'⚡ Steam':type==='market_suspended'?'⊘ Off board':'↗ Line move';
 var who=row.playerName||([row.awayTeam,row.homeTeam].filter(Boolean).join(' @ '))||'Market update';
 var market=String(row.marketDescription||row.marketKey||'Player prop').replace(/^(player_|batter_|pitcher_)/,'').replace(/_/g,' ');
 var book=row.bookmakerTitle||row.bookmakerKey||((row.books||[]).length?(row.books.length+' books'):'Market');
 var metric='';
 if(type==='steam')metric='Steam '+(num(row.steamScore)==null?'signal':dec(row.steamScore))+(num(row.booksMoved)!=null?' · '+row.booksMoved+'/'+(row.booksQuoting||'?')+' books':'')+(row.consensusDirection?' · '+row.consensusDirection:'');
 else if(type==='market_suspended')metric='Off board'+(num(row.booksAgreeing)!=null?' · '+row.booksAgreeing+' books agree':'');
 else metric='Line '+(num(row.previous&&row.previous.point)==null?'—':dec(row.previous.point))+' → '+(num(row.current&&row.current.point)==null?'—':dec(row.current.point))+(num(row.priceChangePct)!=null?' · '+dec(row.priceChangePct)+'% price move':'');
 return '<article class="asPulseCard '+tone+'"><div class="asPulseType"><span>'+label+'</span><em>'+esc(snipeAgo(row.occurredAt||row.receivedAt))+'</em></div><strong>'+esc(who)+'</strong><p>'+esc(market)+' · '+esc(book)+'</p><div class="asPulseMetric">'+esc(metric)+'</div></article>';
}
function snipePulseHtml(data){
 var summary=data&&data.summary||{},meta=data&&data.meta||{};
 var events=(Array.isArray(data&&data.events)?data.events:[]).filter(function(row){return ['steam','line_movement','market_suspended'].includes(String(row&&row.type||''));}).slice(0,6);
 var connected=meta.connected===true;
 var cards=events.length?'<div class="asPulseGrid">'+events.map(snipePulseEventHtml).join('')+'</div>':'<div class="asPulseEmpty">'+(connected?'Feed connected. No qualifying movement in the recent window.':'Real-time movement feed is warming up. Current board lines remain available above.')+'</div>';
 return '<div class="asPulseHead"><div><b>Live Market Pulse</b><p>PropLine movement context · recent market events</p></div><span class="asPulseLive '+(connected?'':'off')+'"><i aria-hidden="true"></i>'+(connected?'Live':'Warming')+'</span></div><div class="asPulseStats"><div class="asPulseStat"><small>Line moves</small><b>'+esc(summary.lineMovements||0)+'</b></div><div class="asPulseStat"><small>Steam</small><b>'+esc(summary.steam||0)+'</b></div><div class="asPulseStat"><small>Off board</small><b>'+esc(summary.marketSuspensions||0)+'</b></div></div>'+cards;
}
async function hydrateSnipePulse(){
 var host=document.getElementById('asSnipePulse');if(!host||activeView!=='snipes')return;
 var key=sport,cached=snipePulseCache.get(key);
 if(cached&&Date.now()-cached.at<15000){host.innerHTML=snipePulseHtml(cached.data);return;}
 if(snipePulseInflight.has(key)){
  try{var waiting=await snipePulseInflight.get(key),current=document.getElementById('asSnipePulse');if(current&&activeView==='snipes'&&sport===key)current.innerHTML=snipePulseHtml(waiting);}catch{}
  return;
 }
 var request=nativeFetch('/api/apex/live-moves?'+new URLSearchParams({sport:key,limit:'8'}).toString(),{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json'}}).then(async function(response){var body=await response.json().catch(function(){return null;});if(!response.ok)throw new Error('LIVE_MOVES_UNAVAILABLE');return body||{};});
 snipePulseInflight.set(key,request);
 try{
  var data=await request;snipePulseCache.set(key,{at:Date.now(),data:data});
  var current=document.getElementById('asSnipePulse');if(current&&activeView==='snipes'&&sport===key)current.innerHTML=snipePulseHtml(data);
 }catch{
  var current=document.getElementById('asSnipePulse');if(current&&activeView==='snipes'&&sport===key)current.innerHTML='<div class="asPulseEmpty">Live movement context is temporarily unavailable. Current board lines and verified Snipes are unaffected.</div>';
 }finally{snipePulseInflight.delete(key);}
}
`;
  replaceOnce(functionAnchor, `${helpers}\n${functionAnchor}`, 'insert market-pulse helpers');

  const rowsAnchor = " var rows=groups.map(function(g){var s=staleFor(g);if(!s)return null;return {g:g,s:s};}).filter(Boolean);";
  replaceOnce(
    rowsAnchor,
    `${rowsAnchor}\n var liveBooks=uniq(viewGroups().flatMap(function(g){return books(g);})).length;\n var shell=snipePulseStyle()+snipeReadinessHtml(groups,liveBooks);`,
    'add snipe readiness shell',
  );

  replaceOnce(
    " if(!rows.length){\n  var liveBooks=uniq(viewGroups().flatMap(function(g){return books(g);})).length;\n  return '<div class=\"asEmpty\"><b>No verified snipes right now.</b><p>A normal consensus snipe needs one bettor-friendly target quote plus at least two independent live reference books. A two-book signal is accepted only when the reference is a verified sharp book. '+esc(sport)+' currently has '+liveBooks+' live book'+(liveBooks===1?'':'s')+' available for comparison. Auto Scout will not turn ordinary props into fake snipes.</p></div>';\n }",
    " if(!rows.length){\n  return shell+snipeWatchHtml(groups)+snipePulseHostHtml()+'<p class=\"asNotice asSnipeFoot\">Verified Snipes stay strict: two-book gaps are shown as watch items until enough independent evidence arrives. Nothing is promoted to a snipe just to fill the screen.</p>';\n }",
    'replace oversized empty state',
  );

  replaceOnce(
    " return '<div class=\"asTableWrap\"><table class=\"asTable asSnipeTable\">",
    " return shell+snipePulseHostHtml()+'<div class=\"asTableWrap\"><table class=\"asTable asSnipeTable\">",
    'add pulse above verified snipe table',
  );

  replaceOnce(
    " if(activeView==='snipes'){document.querySelector('.asHeaderRow').innerHTML='<span>Live snipe opportunities</span>';document.getElementById('asResultCount').textContent=a.length+' verified snipes · '+sport;list.innerHTML=snipeTableHtml(a);renderPagination(0);renderBatchControl();restoreFocus(focused||origin);return;}",
    " if(activeView==='snipes'){document.querySelector('.asHeaderRow').innerHTML='<span>Snipes + live market pulse</span>';document.getElementById('asResultCount').textContent=a.length+' verified snipes · '+sport;list.innerHTML=snipeTableHtml(a);void hydrateSnipePulse();renderPagination(0);renderBatchControl();restoreFocus(focused||origin);return;}",
    'hydrate live movement context',
  );

  writeFileSync(file, source, 'utf8');
  console.log('[autoscout] Snipes enhanced with PropLine live market pulse and honest two-book watch cards');
}
