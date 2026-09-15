const ODDS_ANCHOR = String.raw`function oddsStrip(g){
 var map=new Map();
 g.rows.forEach(function(r){var k=r.sportsbookKey||r.sportsbook;if(!map.has(k))map.set(k,{key:k,name:r.sportsbook||k,o:null,u:null});
  map.get(k)[r.side==='OVER'?'o':'u']=r;});
 var chips=Array.from(map.values()).sort(function(a,b){return String(a.name).localeCompare(String(b.name));}).map(function(x){
  return '<div class="asOddsChip"><b>'+esc(String(x.name||x.key).slice(0,16))+'</b><span>'
   +(x.o?'<i class="o">O '+esc(dec(x.o.line))+' '+esc(money(x.o.price))+tacoBadgeHtml(g.archived?null:x.o)+'</i>':'')
   +(x.u?'<i class="u">U '+esc(dec(x.u.line))+' '+esc(money(x.u.price))+tacoBadgeHtml(g.archived?null:x.u)+'</i>':'')+'</span></div>';});
 return chips.length?'<div class="asOddsStrip" aria-label="Sportsbook lines">'+chips.join('')+'</div>':'';
}`;

const BIND_ANCHOR = String.raw`function bindRows(){
 document.querySelectorAll('.asCardModels').forEach(el=>{el.onclick=e=>e.stopPropagation();el.onkeydown=e=>e.stopPropagation();});`;

function replaceOnce(source, anchor, replacement, label) {
  const count = String(source).split(anchor).length - 1;
  if (count !== 1) throw new Error(`PropLine market UI patch expected one ${label} anchor; found ${count}.`);
  return String(source).replace(anchor, replacement);
}

const MARKET_FUNCTIONS = String.raw`
// PropLine adds richer quote metadata (implied probability, precise change
// times, and safe book links). Keep it purely presentational: no browser-side
// provider calls and no invented line movement.
function safeBookLink(value){
 if(!value)return '';
 try{var url=new URL(String(value),window.location.origin);return (url.protocol==='https:'||url.protocol==='http:')?url.href:'';}catch(e){return '';}
}
function quoteStamp(row){
 var value=row&&(row.providerUpdatedAt||row.updatedAt||row.ingestedAt);
 var at=value?Date.parse(value):NaN;
 return Number.isFinite(at)?at:null;
}
function compactAge(at){
 if(at==null)return '';
 var age=Math.max(0,Date.now()-at),minutes=Math.floor(age/60000);
 if(minutes<1)return 'now';
 if(minutes<60)return minutes+'m';
 var hours=Math.floor(minutes/60);
 if(hours<24)return hours+'h';
 return Math.floor(hours/24)+'d';
}
function quoteMeta(row){
 if(!row)return '';
 var parts=[],p=num(row.impliedProbability);
 if(p!=null){if(p<=1)p*=100;if(p>=0&&p<=100)parts.push(dec(p,1)+'% implied');}
 var at=quoteStamp(row),age=compactAge(at);
 if(age)parts.push((row.provider==='propline'?'Market change ':'Updated ')+age);
 return parts.join(' · ');
}
function oddsStrip(g){
 var rows=g.comparisonOffers||g.rows||[],activeSide=defaultSide(g);
 var comparison=compareResearchQuotes({...g,rows:rows,archived:!!g.archived||!!payload.meta?.stale},{line:boardLine(g),side:activeSide});
 var activeFresh=comparison.offers.filter(function(q){return q.fresh&&q.side===activeSide;});
 var canRank=activeFresh.length>=2,bestLineValue=canRank?comparison.bestLines[activeSide]:null;
 var bestLineBooks=new Set(activeFresh.filter(function(q){return q.line===bestLineValue;}).map(function(q){return q.bookKey;}));
 var bestPriceBooks=new Set((comparison.bestPrices[activeSide]||[]).map(function(q){return q.bookKey;}));
 var map=new Map();
 g.rows.forEach(function(r){
  var k=String(r.sportsbookKey||r.sportsbook||'').toLowerCase();if(!k)return;
  if(!map.has(k))map.set(k,{key:k,name:r.sportsbook||k,o:null,u:null});
  map.get(k)[r.side==='OVER'?'o':'u']=r;
 });
 var chips=Array.from(map.values()).sort(function(a,b){
  var ab=bestLineBooks.has(a.key)?0:1,bb=bestLineBooks.has(b.key)?0:1;
  return ab-bb||String(a.name).localeCompare(String(b.name));
 }).map(function(x){
  var active=activeSide==='UNDER'?x.u:x.o;
  var bestLine=!!active&&bestLineBooks.has(x.key)&&num(active.line)===num(bestLineValue);
  var bestPrice=!!active&&bestPriceBooks.has(x.key)&&num(active.line)===num(comparison.selectedLine);
  var label=bestLine&&bestPrice?'BEST LINE + PRICE':bestLine?'BEST LINE':bestPrice?'BEST PRICE':'';
  var meta=quoteMeta(active||x.o||x.u),href=safeBookLink((active||x.o||x.u)?.deeplink);
  var open=href?'<a class="asOddsChip'+(bestLine||bestPrice?' asOddsBest':'')+'" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" data-book-link="1">':'<div class="asOddsChip'+(bestLine||bestPrice?' asOddsBest':'')+'">';
  var close=href?'</a>':'</div>';
  return open
   +'<div class="asOddsBookTop"><b>'+esc(String(x.name||x.key).slice(0,18))+'</b>'+(label?'<em>'+esc(label)+'</em>':'')+'</div>'
   +'<div class="asOddsValues">'
    +(x.o?'<span class="o"><strong>O '+esc(dec(x.o.line))+'</strong><i>'+esc(money(x.o.price))+tacoBadgeHtml(g.archived?null:x.o)+'</i></span>':'')
    +(x.u?'<span class="u"><strong>U '+esc(dec(x.u.line))+'</strong><i>'+esc(money(x.u.price))+tacoBadgeHtml(g.archived?null:x.u)+'</i></span>':'')
   +'</div>'
   +(meta?'<small class="asOddsMeta">'+esc(meta)+'</small>':'')
   +(href?'<small class="asOddsGo">Open book ↗</small>':'')+close;
 });
 if(!chips.length)return '';
 var summary=[];
 if(bestLineValue!=null)summary.push((activeSide==='UNDER'?'Under':'Over')+' best '+dec(bestLineValue));
 if(activeFresh.length>=2){var values=activeFresh.map(function(q){return q.line;}),gap=Math.max.apply(null,values)-Math.min.apply(null,values);if(gap>0)summary.push('book gap '+dec(gap,2));}
 var propLineTimes=activeFresh.filter(function(q){return q.provider==='propline'&&q.at!=null;}).map(function(q){return q.at;});
 if(propLineTimes.length)summary.push('market change '+compactAge(Math.max.apply(null,propLineTimes)));
 return '<div class="asOddsStrip" aria-label="Sportsbook lines">'
  +'<div class="asOddsHead"><span>Available lines</span>'+(summary.length?'<strong>'+esc(summary.join(' · '))+'</strong>':'')+'</div>'
  +'<div class="asOddsRail">'+chips.join('')+'</div></div>';
}
`;

const MARKET_CSS = String.raw`
#as5 .asOddsStrip{display:grid!important;gap:7px!important;margin:8px 10px 0!important;padding:9px!important;border:1px solid rgba(68,101,145,.42)!important;border-radius:13px!important;background:linear-gradient(180deg,rgba(6,18,34,.86),rgba(3,11,23,.94))!important;overflow:hidden!important}
#as5 .asOddsHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px!important}
#as5 .asOddsHead>span{font-size:8px!important;font-weight:950!important;letter-spacing:.08em!important;text-transform:uppercase!important;color:#7f96b2!important}
#as5 .asOddsHead>strong{font-size:8px!important;font-weight:800!important;color:#a9bad0!important;text-align:right!important}
#as5 .asOddsRail{display:flex!important;gap:7px!important;overflow-x:auto!important;padding:1px 0 2px!important;scrollbar-width:none!important}
#as5 .asOddsRail::-webkit-scrollbar{display:none!important}
#as5 .asOddsChip{position:relative!important;flex:0 0 158px!important;display:grid!important;gap:6px!important;min-height:92px!important;padding:8px 9px!important;border:1px solid rgba(63,92,129,.5)!important;border-radius:11px!important;background:linear-gradient(180deg,rgba(13,29,50,.96),rgba(7,17,32,.98))!important;color:#eaf2fc!important;text-decoration:none!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important}
#as5 .asOddsChip.asOddsBest{border-color:rgba(50,142,255,.82)!important;background:linear-gradient(180deg,rgba(14,47,83,.98),rgba(7,25,50,.99))!important;box-shadow:0 0 0 1px rgba(40,129,255,.12),0 8px 20px rgba(0,74,180,.13),inset 0 1px 0 rgba(255,255,255,.045)!important}
#as5 .asOddsBookTop{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:5px!important}
#as5 .asOddsBookTop>b{font-size:10px!important;line-height:1.1!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#as5 .asOddsBookTop>em{font-style:normal!important;font-size:6px!important;font-weight:1000!important;letter-spacing:.05em!important;padding:3px 4px!important;border-radius:999px!important;background:rgba(37,122,255,.2)!important;border:1px solid rgba(56,145,255,.46)!important;color:#8bc0ff!important;white-space:nowrap!important}
#as5 .asOddsValues{display:grid!important;grid-template-columns:1fr 1fr!important;gap:5px!important}
#as5 .asOddsValues>span{display:grid!important;gap:2px!important;padding:5px 6px!important;border-radius:8px!important;background:rgba(4,12,24,.55)!important;border:1px solid rgba(68,92,125,.28)!important}
#as5 .asOddsValues strong{font-size:10px!important;font-weight:950!important;color:#f3f7fd!important}
#as5 .asOddsValues i{font-style:normal!important;font-size:8px!important;font-weight:800!important;color:#899bb2!important}
#as5 .asOddsValues .o strong{color:#79ebbd!important}#as5 .asOddsValues .u strong{color:#ff9aa5!important}
#as5 .asOddsMeta{font-size:7px!important;line-height:1.2!important;color:#71849e!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#as5 .asOddsGo{position:absolute!important;right:8px!important;bottom:6px!important;font-size:6px!important;font-weight:850!important;color:#6fa8ef!important}
#as5 .asPpSpecialStrip{border-color:rgba(124,91,255,.38)!important;background:linear-gradient(180deg,rgba(19,19,45,.78),rgba(8,13,26,.9))!important}
#as5 .asPpSpecialLabel{color:#9f94d8!important}
@media(max-width:540px){#as5 .asOddsStrip{margin-left:8px!important;margin-right:8px!important;padding:8px!important}#as5 .asOddsChip{flex-basis:148px!important;min-height:88px!important}#as5 .asOddsHead>strong{max-width:58%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
`;

export function patchProplineMarketUi(source) {
  let patched = String(source ?? '');
  patched = replaceOnce(patched, ODDS_ANCHOR, `${MARKET_FUNCTIONS}\n`, 'odds strip');
  patched = replaceOnce(
    patched,
    BIND_ANCHOR,
    `${BIND_ANCHOR}\n document.querySelectorAll('[data-book-link]').forEach(function(a){a.onclick=function(e){e.stopPropagation();};a.onkeydown=function(e){e.stopPropagation();};});`,
    'row binding',
  );
  const styleRuntime = `\n;(function installProplineMarketStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-propline-market-style'))return;var style=document.createElement('style');style.id='oblige-propline-market-style';style.textContent=${JSON.stringify(MARKET_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
  return patched + styleRuntime;
}
