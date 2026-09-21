// Runtime wiring for the PropLine capabilities that are useful to ObligeProps
// but do not belong in the core board fetcher. The production board, auth, and
// signed webhook/replay flow stay untouched.

function replaceOnce(source, anchor, replacement, label) {
  const count = String(source).split(anchor).length - 1;
  if (count !== 1) throw new Error(`PropLine full patch expected one ${label} anchor; found ${count}.`);
  return String(source).replace(anchor, () => replacement);
}

const FRONTDOOR_HANDLER_ANCHOR = 'async function maybeServeResearchBatch(req, res) {';
const FRONTDOOR_CHAIN_ANCHOR = '  if (await maybeServePropLineInsights(req, res)) return;';

const FULL_FRONTDOOR = String.raw`
const PROPLINE_FULL_READERS = Object.freeze({
  'player-history': (full, q) => full.fetchPlayerHistory(q.sport, q.playerName, { market: q.market, bookmaker: q.bookmaker, limit: q.limit }),
  'player-trends': (full, q) => full.fetchPlayerTrendsFull(q.sport, q.playerName, { market: q.market, dfsOddsType: q.dfsOddsType }),
  stats: (full, q) => full.fetchEventStats(q.sport, q.eventId, { statType: q.statType }),
  markets: (full, q) => full.fetchEventMarkets(q.sport, q.eventId),
  futures: (full, q) => full.fetchFutures(q.sport, { bookmakers: q.bookmaker }),
  'ev-calc': (full, q) => full.calculateExpectedValue(q.sport, q.eventId, { market: q.market, name: q.name, point: q.point, description: q.playerName, price: q.price }),
  'dfs-payouts': (full, q) => full.fetchDfsPayouts({ platform: q.platform, legWinProb: q.legWinProb }),
  'market-hit-rates': (full, q) => full.fetchMarketHitRates({ days: q.days, bookmaker: q.bookmaker }),
  'resolution-summary': (full, q) => full.fetchResolutionSummary({ days: q.days }),
  freshness: (full) => full.fetchFreshness(),
});

async function maybeServePropLineFull(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/api/apex/propline-full') return false;
  if (!proplineTrafficEnabled()) {
    directJson(res, 200, { ok: true, available: false, data: null, code: 'PROPLINE_DISABLED_BY_PROVIDER_MODE' });
    return true;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    directJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'GET, POST' });
    return true;
  }
  if (!researchRateAllowed(req)) {
    directJson(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many research requests. Try again shortly.' }, { 'retry-after': '60' });
    return true;
  }

  try {
    const full = await import('./lib/data-sources/propline/full.mjs');
    if (req.method === 'POST') {
      const body = await readJsonBody(req, 48 * 1024);
      if (!body || String(body.kind || '').trim().toLowerCase() !== 'sgp') {
        directJson(res, 400, { ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown PropLine action.' });
        return true;
      }
      const sport = String(body.sport || '').trim().slice(0, 16);
      const eventId = String(body.eventId || '').trim().slice(0, 160);
      const bookmaker = String(body.bookmaker || 'all').trim().toLowerCase().slice(0, 40) || 'all';
      const legs = Array.isArray(body.legs) ? body.legs.slice(0, 10).map((leg) => ({
        market: String(leg?.market || '').trim().slice(0, 120),
        name: String(leg?.name || '').trim().slice(0, 120),
        description: String(leg?.description || '').trim().slice(0, 120),
        point: leg?.point === null || leg?.point === undefined || leg?.point === '' ? null : Number(leg.point),
        period: String(leg?.period || '').trim().slice(0, 20),
        team: String(leg?.team || '').trim().slice(0, 120),
        book_outcome_id: String(leg?.book_outcome_id || '').trim().slice(0, 180),
      })) : [];
      if (!sport || !eventId || legs.length < 2 || legs.length > 10 || legs.some((leg) => !leg.market || !leg.name || (leg.point !== null && !Number.isFinite(leg.point)))) {
        directJson(res, 400, { ok: false, code: 'INVALID_SGP_REQUEST', message: 'Two to ten valid same-event legs are required.' });
        return true;
      }
      const data = await full.priceSameGameParlay(sport, eventId, { bookmaker, legs });
      directJson(res, 200, { ok: true, kind: 'sgp', available: Boolean(data), data: data || null });
      return true;
    }

    const kind = safeParam(url, 'kind', 40).toLowerCase();
    const reader = PROPLINE_FULL_READERS[kind];
    if (!reader) {
      directJson(res, 400, { ok: false, code: 'UNKNOWN_KIND', message: 'Unknown research capability requested.' });
      return true;
    }
    const q = {
      sport: safeParam(url, 'sport', 16),
      eventId: safeParam(url, 'eventId', 160),
      playerName: safeParam(url, 'playerName', 120),
      market: safeParam(url, 'market', 120),
      bookmaker: safeParam(url, 'bookmaker', 80),
      name: safeParam(url, 'name', 120),
      point: safeParam(url, 'point', 30),
      price: safeParam(url, 'price', 30),
      statType: safeParam(url, 'statType', 240),
      dfsOddsType: safeParam(url, 'dfsOddsType', 24),
      platform: safeParam(url, 'platform', 40) || 'prizepicks',
      legWinProb: safeParam(url, 'legWinProb', 30),
      limit: safeParam(url, 'limit', 8),
      days: safeParam(url, 'days', 8),
    };
    const data = await reader(full, q);
    directJson(res, 200, { ok: true, kind, available: Boolean(data), data: data || null });
  } catch (error) {
    directJson(res, 200, { ok: true, available: false, data: null, code: String(error?.code || 'PROPLINE_CAPABILITY_UNAVAILABLE').slice(0, 60) });
  }
  return true;
}
`;

export function patchProplineFullFrontdoor(source) {
  let patched = String(source ?? '');
  if (patched.includes('async function maybeServePropLineFull(')) return patched;
  patched = replaceOnce(patched, FRONTDOOR_HANDLER_ANCHOR, `${FULL_FRONTDOOR}\n${FRONTDOOR_HANDLER_ANCHOR}`, 'research-batch handler');
  patched = replaceOnce(patched, FRONTDOOR_CHAIN_ANCHOR, `  if (await maybeServePropLineFull(req, res)) return;\n${FRONTDOOR_CHAIN_ANCHOR}`, 'request chain');
  return patched;
}

const FULL_UI_FUNCTIONS = String.raw`
var proplineFullCache=new Map(),proplineFullToken=0,proplineSgpState=new Map();
function proplineFullAsk(kind,params){
 var q=new URLSearchParams(Object.assign({kind:kind},params||{})),key=q.toString();
 if(proplineFullCache.has(key))return Promise.resolve(proplineFullCache.get(key));
 return nativeFetch('/api/apex/propline-full?'+key).then(function(r){return r.ok?r.json():null;}).then(function(j){
  var data=j&&j.available?j.data:null;proplineFullCache.set(key,data);return data;
 }).catch(function(){return null;});
}
function proplineCompactNumber(v){var x=num(v);if(x==null)return'—';if(Math.abs(x)>=1000000)return (x/1000000).toFixed(x>=10000000?0:1)+'m';if(Math.abs(x)>=1000)return (x/1000).toFixed(x>=10000?0:1)+'k';return String(Math.round(x));}
function proplineFullBlock(title,inner){return inner?'<div class="asPlBlock asPlFullBlock"><small>'+esc(title)+'</small>'+inner+'</div>':'';}
function proplineHistoryHtml(data){
 if(!data||!Array.isArray(data.entries)||!data.entries.length)return '';
 var rows=data.entries.slice(0,3).map(function(r){
  var verdict=r.overResult||'',cls=verdict==='won'?'won':verdict==='lost'?'lost':'';
  return '<div class="asPlHistoryRow"><span>'+esc(shortDate(r.commenceTime))+'</span><b>'+esc(r.actualValue==null?'—':dec(r.actualValue))+'</b><em>line '+esc(r.line==null?'—':dec(r.line))+'</em><i class="'+cls+'">'+esc(verdict||'graded')+'</i></div>';
 }).join('');
 return proplineFullBlock('Resolved player history',rows);
}
function proplineStatsHtml(data,g){
 if(!data||!Array.isArray(data.players)||!g||!g.playerName)return '';
 var target=g.playerName.toLowerCase(),p=data.players.find(function(row){return row.name&&row.name.toLowerCase()===target;})||data.players.find(function(row){return row.name&&row.name.toLowerCase().indexOf(target)>=0;});
 if(!p||!p.stats)return '';
 var keys=Object.keys(p.stats).filter(function(k){return num(p.stats[k])!=null;}).slice(0,5);
 if(!keys.length)return '';
 var chips=keys.map(function(k){return '<span><b>'+esc(String(k).replace(/_/g,' '))+'</b><em>'+esc(dec(p.stats[k]))+'</em></span>';}).join('');
 return proplineFullBlock((data.status==='in_progress'?'Live box score':'Official box score'),'<div class="asPlStatChips">'+chips+'</div>');
}
function proplineMarketsHtml(data){
 if(!data||!Array.isArray(data.markets)||!data.markets.length)return '';
 var sample=data.markets.slice(0,4).map(function(m){return m.key;}).filter(Boolean).join(' · ');
 return proplineFullBlock('Event market coverage','<div class="asPlMetric"><b>'+esc(String(data.count||data.markets.length))+'</b><span>markets available</span></div>'+(sample?'<i class="asPlSub">'+esc(sample)+'</i>':''));
}
function proplineFuturesHtml(data){
 if(!data||!data.eventCount)return '';
 return proplineFullBlock('Futures coverage','<div class="asPlMetric"><b>'+esc(String(data.eventCount))+'</b><span>boards · '+esc(String(data.marketCount||0))+' markets</span></div>');
}
function proplineHitRateHtml(data,market){
 if(!data||!data.markets||!market)return '';
 var row=data.markets[market];if(!row||!row.total)return '';
 return proplineFullBlock('Market-wide baseline','<div class="asPlMetric"><b>'+esc(Math.round((row.overRate||0)*100)+'%')+'</b><span>Over · '+esc(String(row.won))+'/'+esc(String(row.total))+' graded · '+esc(data.bookmaker||'reference book')+'</span></div>');
}
function proplineFreshHtml(data,book){
 if(!data||!Array.isArray(data.bookmakers))return '';
 var key=String(book||'').toLowerCase(),row=key?data.bookmakers.find(function(b){return b.key===key;}):null;
 if(row){var props=row.marketClasses&&row.marketClasses.props||{},sec=num(props.staleness_seconds);return proplineFullBlock('Data freshness','<div class="asPlMetric '+(props.is_stale?'stale':'fresh')+'"><b>'+(props.is_stale?'STALE':'LIVE')+'</b><span>'+esc(row.key)+(sec!=null?' · '+esc(String(Math.round(sec)))+'s since props update':'')+'</span></div>');}
 var stale=data.bookmakers.filter(function(b){return b.isStale||(b.marketClasses&&b.marketClasses.props&&b.marketClasses.props.is_stale);}).length;
 return proplineFullBlock('Data freshness','<div class="asPlMetric '+(stale?'stale':'fresh')+'"><b>'+esc(String(data.bookmakers.length-stale))+'/'+esc(String(data.bookmakers.length))+'</b><span>books fresh</span></div>');
}
function proplineEvCalcHtml(data){
 if(!data||data.evPercent==null)return '';
 var cls=data.isPlusEv?'fresh':'';
 return proplineFullBlock('Price vs fair line','<div class="asPlMetric '+cls+'"><b>'+esc((data.evPercent>0?'+':'')+Number(data.evPercent).toFixed(2)+'%')+'</b><span>EV at selected price'+(data.fairSource?' · fair source '+esc(data.fairSource):'')+'</span></div>');
}
function proplineResolutionHtml(data){
 if(!data||data.totalGraded==null)return '';
 return proplineFullBlock('Grading coverage','<div class="asPlMetric"><b>'+esc(proplineCompactNumber(data.totalGraded))+'</b><span>props graded in '+esc(String(data.days||30))+'d · '+esc(String(data.sportsCovered||0))+' sports</span></div>');
}
function proplineCrossEvHtml(data,g){
 if(!data||!Array.isArray(data.plays)||!g)return '';
 var target=(g.playerName||'').toLowerCase(),market=g.marketId||'';
 var rows=data.plays.filter(function(p){return p.playerName&&p.playerName.toLowerCase()===target&&(!market||p.marketKey===market);}).slice(0,2);
 if(!rows.length)return '';
 return proplineFullBlock('Cross-book +EV',rows.map(function(p){return '<div class="asPlHistoryRow"><span>'+esc(p.bookmakerKey||'book')+'</span><b>'+esc(p.evPercent==null?'—':((p.evPercent>0?'+':'')+Number(p.evPercent).toFixed(2)+'%'))+'</b><em>'+esc((p.side||'')+' '+(p.line==null?'':dec(p.line)))+'</em><i>'+esc(p.devigMethod||'no-vig')+'</i></div>';}).join(''));
}
function proplineLineHistoryHtml(data,g,quote){
 if(!data||!Array.isArray(data.points)||!quote||!quote.providerOutcomeId)return '';
 var target=String(quote.providerOutcomeId),points=data.points.filter(function(p){return String(p.outcomeId||'')===target;});
 if(points.length<2)return '';
 var first=points[0],last=points[points.length-1],moves=0;
 for(var i=1;i<points.length;i++){if(num(points[i].line)!==num(points[i-1].line)||num(points[i].price)!==num(points[i-1].price)||num(points[i].liquidity)!==num(points[i-1].liquidity))moves++;}
 var recent=points.slice(-4).reverse().map(function(p){
  var liq=num(p.liquidity);
  return '<div class="asPlHistoryTick"><span>'+esc(shortDate(p.at))+'</span><b>'+esc(dec(p.line))+'</b><em>'+(num(p.price)!=null?esc(money(p.price)):'—')+'</em>'+(liq!=null?'<i>'+esc(String.fromCharCode(36)+Math.round(liq).toLocaleString())+' liq</i>':'')+'</div>';
 }).join('');
 return proplineFullBlock('Exact outcome line history','<div class="asPlMetric"><b>'+esc(String(moves))+'</b><span>moves · '+esc(first.line==null?'—':dec(first.line))+' → '+esc(last.line==null?'—':dec(last.line))+' · '+esc(quote.sportsbook||quote.sportsbookKey||'book')+'</span></div><div class="asPlHistoryTicks">'+recent+'</div>');
}
function loadProplineFull(g){
 var host=document.getElementById('asProplineFull');if(!host||!g||!g.sport)return;
 var token=++proplineFullToken,sport=g.sport,eventId=g.providerEventId||g.eventId||'',player=g.playerName||'',market=g.marketId||'',side=defaultSide(g),line=boardLine(g),quote=bestPrice(g,side,line),book=quote&&quote.sportsbookKey||'';
 var asks=[
  player&&market?proplineFullAsk('player-history',{sport:sport,playerName:player,market:market,bookmaker:book,limit:'5'}):Promise.resolve(null),
  eventId?proplineFullAsk('stats',{sport:sport,eventId:eventId}):Promise.resolve(null),
  eventId?proplineFullAsk('markets',{sport:sport,eventId:eventId}):Promise.resolve(null),
  proplineFullAsk('futures',{sport:sport}),
  proplineFullAsk('market-hit-rates',{sport:sport,days:'28',bookmaker:book||'bovada'}),
  proplineFullAsk('resolution-summary',{sport:sport,days:'30'}),
  proplineFullAsk('freshness',{sport:sport}),
  eventId&&market&&quote&&num(quote.price)!=null?proplineFullAsk('ev-calc',{sport:sport,eventId:eventId,market:market,name:side==='UNDER'?'Under':'Over',point:line==null?'':line,playerName:player,price:quote.price}):Promise.resolve(null),
  eventId?proplineAsk('ev',{sport:sport,eventId:eventId,markets:market}):Promise.resolve(null),
  eventId?proplineAsk('history',{sport:sport,eventId:eventId,markets:market}):Promise.resolve(null)
 ];
 Promise.all(asks).then(function(out){
  if(token!==proplineFullToken)return;
  var html=[proplineHistoryHtml(out[0]),proplineStatsHtml(out[1],g),proplineMarketsHtml(out[2]),proplineFuturesHtml(out[3]),proplineHitRateHtml(out[4],market),proplineResolutionHtml(out[5]),proplineFreshHtml(out[6],book),proplineEvCalcHtml(out[7]),proplineCrossEvHtml(out[8],g),proplineLineHistoryHtml(out[9],g,quote)].filter(Boolean).join('');
  if(!html){host.hidden=true;host.innerHTML='';return;}
  host.hidden=false;host.innerHTML='<div class="asSectionTitle"><h3>Verified market intelligence</h3><span>official stats · grading · pricing</span></div><div class="asSectionBody asPlGrid">'+html+'</div>';
 }).catch(function(){host.hidden=true;});
}
function proplineSgpKey(picks){return picks.map(function(p){return [p.sport,p.eventId,p.marketKey,p.side,p.line,p.playerName].join('|');}).join('~');}
function proplineSgpEligible(){
 if(!Array.isArray(slip)||slip.length<2||slip.length>10)return null;
 var eventId=slip[0].eventId,sport=slip[0].sport;if(!eventId||!sport)return null;
 if(!slip.every(function(p){return p.eventId===eventId&&p.sport===sport&&p.marketKey&&p.provider==='propline';}))return null;
 return {sport:sport,eventId:eventId,picks:slip.slice()};
}
function requestProplineSgp(){
 var eligible=proplineSgpEligible();if(!eligible)return;
 var key=proplineSgpKey(eligible.picks),current=proplineSgpState.get(key);if(current&&current.loading)return;
 proplineSgpState.set(key,{loading:true,data:current&&current.data||null,error:null});renderSlip();
 var legs=eligible.picks.map(function(p){return {market:p.marketKey,name:p.side==='UNDER'?'Under':'Over',description:p.playerName,point:p.line};});
 nativeFetch('/api/apex/propline-full',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'sgp',sport:eligible.sport,eventId:eligible.eventId,bookmaker:'all',legs:legs})})
  .then(function(r){return r.ok?r.json():null;}).then(function(j){proplineSgpState.set(key,{loading:false,data:j&&j.available?j.data:null,error:j&&j.available?null:'No current quote'});renderSlip();})
  .catch(function(){proplineSgpState.set(key,{loading:false,data:null,error:'No current quote'});renderSlip();});
}
function proplineSgpSlipHtml(){
 var eligible=proplineSgpEligible();if(!eligible)return '';
 var key=proplineSgpKey(eligible.picks),state=proplineSgpState.get(key)||{},best=state.data&&state.data.best;
 var result='';
 if(best&&best.quoted){result='<div class="asSgpResult"><b>'+esc(best.sgpPrice==null?'—':money(best.sgpPrice))+'</b><span>'+esc(state.data.bestBookmaker||best.bookmaker||'best book')+' live SGP'+(best.independentPrice!=null?' · independent '+esc(money(best.independentPrice)):'')+(best.correlationFactor!=null?' · correlation ×'+esc(Number(best.correlationFactor).toFixed(2)):'')+'</span></div>';}
 else if(state.error)result='<p class="asNotice">This exact slip does not have a current supported-book SGP quote.</p>';
 return '<section class="asSgpBox"><small>Same-game parlay market price</small><p>Shop this exact same-event slip across supported SGP books. This is a live book quote, not a model prediction.</p>'+result+'<button class="asBtn" id="asProplineSgpQuote" '+(state.loading?'disabled aria-busy="true"':'')+'>'+(state.loading?'Pricing…':best?'Refresh SGP price':'Get live SGP price')+'</button></section>';
}
`;

const FULL_UI_CSS = String.raw`
#as5 .asProplineFullSection{border:1px solid #26364f;border-radius:12px;background:#0c121d;margin:9px 0;overflow:hidden}
#as5 .asPlFullBlock{border-top:1px solid #182338;padding-top:7px}
#as5 .asPlFullBlock:first-child{border-top:0;padding-top:0}
#as5 .asPlHistoryRow{display:grid;grid-template-columns:58px 54px 1fr auto;gap:6px;align-items:center;padding:4px 0;font-size:8px;border-bottom:1px solid #172235}
#as5 .asPlHistoryRow:last-child{border-bottom:0}
#as5 .asPlHistoryRow span,#as5 .asPlHistoryRow em,#as5 .asPlHistoryRow i{font-style:normal;color:#8290a4}
#as5 .asPlHistoryRow b{font-size:10px;color:#e7eef8}
#as5 .asPlHistoryTicks{display:grid;gap:3px;margin-top:5px}
#as5 .asPlHistoryTick{display:grid;grid-template-columns:62px 42px 48px 1fr;gap:6px;align-items:center;padding:3px 0;border-top:1px solid #172235;font-size:7px}
#as5 .asPlHistoryTick span,#as5 .asPlHistoryTick em,#as5 .asPlHistoryTick i{font-style:normal;color:#7c8aa0}
#as5 .asPlHistoryTick b{font-size:9px;color:#e7eef8}
#as5 .asPlHistoryTick i{text-align:right}
#as5 .asPlHistoryRow i.won{color:#33e49b}#as5 .asPlHistoryRow i.lost{color:#ff6878}
#as5 .asPlStatChips{display:flex;gap:5px;flex-wrap:wrap}
#as5 .asPlStatChips span{border:1px solid #24334c;border-radius:7px;padding:5px 7px;background:#09111b;display:grid;gap:1px}
#as5 .asPlStatChips b{font-size:6px;color:#8190a4;text-transform:uppercase}#as5 .asPlStatChips em{font-style:normal;font-weight:950;font-size:11px}
#as5 .asPlMetric{display:flex;gap:8px;align-items:baseline}#as5 .asPlMetric b{font-size:13px}#as5 .asPlMetric span{font-size:8px;color:#8896aa}
#as5 .asPlMetric.fresh b{color:#33e49b}#as5 .asPlMetric.stale b{color:#f0c45f}
#as5 .asPlSub{display:block;font-style:normal;color:#657389;font-size:7px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#as5 .asSgpBox{margin:10px 0;border:1px solid #31415f;background:#0d1624;border-radius:10px;padding:10px}
#as5 .asSgpBox small{font-size:7px;color:#8b7dff;text-transform:uppercase;font-weight:950;letter-spacing:.06em}
#as5 .asSgpBox p{font-size:8px;line-height:1.45;color:#8795a9;margin:5px 0 8px}
#as5 .asSgpResult{display:grid;gap:2px;margin:7px 0}#as5 .asSgpResult b{font-size:18px;color:#7ddcb0}#as5 .asSgpResult span{font-size:8px;color:#b8c4d5}
`;

export function patchProplineFullUi(source) {
  let patched = String(source ?? '');
  if (patched.includes('function loadProplineFull(')) return patched;
  patched = replaceOnce(patched, 'function loadProplineInsights(g){', `${FULL_UI_FUNCTIONS}\nfunction loadProplineInsights(g){`, 'existing PropLine insight loader');
  patched = replaceOnce(
    patched,
    '<div class="asProplineSection" id="asProplineInsights" hidden></div>',
    '<div class="asProplineSection" id="asProplineInsights" hidden></div><div class="asProplineFullSection" id="asProplineFull" hidden></div>',
    'PropLine insight container',
  );
  patched = replaceOnce(patched, ' loadProplineInsights(g);', ' loadProplineInsights(g);\n loadProplineFull(g);', 'drawer insight call');
  patched = replaceOnce(
    patched,
    'slip.push({key:key,sport:g.sport,playerName:g.playerName,market:g.market,',
    'slip.push({key:key,sport:g.sport,playerName:g.playerName,market:g.market,marketKey:g.marketId||g.market,provider:quote?quote.provider:null,',
    'slip record',
  );
  patched = replaceOnce(
    patched,
    "+(count?'<button class=\"asBtn\" id=\"asSlipClear\">Clear slip</button>':'')",
    "+proplineSgpSlipHtml()+(count?'<button class=\"asBtn\" id=\"asSlipClear\">Clear slip</button>':'')",
    'slip controls',
  );
  patched = replaceOnce(
    patched,
    " var clear=document.getElementById('asSlipClear');",
    " var sgp=document.getElementById('asProplineSgpQuote');if(sgp)sgp.onclick=function(){requestProplineSgp();};\n var clear=document.getElementById('asSlipClear');",
    'slip bindings',
  );
  const styleRuntime = `\n;(function installProplineFullStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-propline-full-style'))return;var style=document.createElement('style');style.id='oblige-propline-full-style';style.textContent=${JSON.stringify(FULL_UI_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
  return patched + styleRuntime;
}
