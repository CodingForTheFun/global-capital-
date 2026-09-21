const ODDS_START = 'function oddsStrip(g){';
const ODDS_END = '// Sharp fair value for a DFS leg.';
const BIND_START = 'function bindRows(){';
const MATCHUP_ANCHOR = "+'<div class=\"asCardMatch\"><span>'+esc(displayTeam(g.awayTeam)+' @ '+displayTeam(g.homeTeam))+'</span><span class=\"asCardTime\">'+esc(when(g.gameStartTime))+'</span></div>'";

function replaceOnce(source, anchor, replacement, label) {
  const count = String(source).split(anchor).length - 1;
  if (count !== 1) throw new Error(`PropLine market UI patch expected one ${label} anchor; found ${count}.`);
  return String(source).replace(anchor, () => replacement);
}

function replaceBlock(source, label, startNeedle, endNeedle, replacement) {
  const text = String(source ?? '');
  const start = text.indexOf(startNeedle);
  if (start < 0) throw new Error(`PropLine market UI patch could not locate ${label} start.`);
  if (text.indexOf(startNeedle, start + startNeedle.length) >= 0) {
    throw new Error(`PropLine market UI patch found more than one ${label} start.`);
  }
  const end = text.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`PropLine market UI patch could not locate ${label} end.`);
  return text.slice(0, start) + replacement + text.slice(end);
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
 var value=row&&(row.lastSeenAt||row.updatedAt||row.providerUpdatedAt||row.ingestedAt);
 var at=value?Date.parse(value):NaN;
 return Number.isFinite(at)?at:null;
}
function quoteChangeStamp(row){
 var value=row&&(row.lastChangeAt||row.providerUpdatedAt||row.updatedAt||row.ingestedAt);
 var at=value?Date.parse(value):NaN;
 return Number.isFinite(at)?at:null;
}
function compactAge(at){
 if(at==null)return '';
 var age=Math.max(0,Date.now()-at),seconds=Math.floor(age/1000);
 if(seconds<60)return seconds+'s';
 var minutes=Math.floor(seconds/60);
 if(minutes<60)return minutes+'m';
 var hours=Math.floor(minutes/60);
 if(hours<24)return hours+'h';
 return Math.floor(hours/24)+'d';
}
function marketAmount(value){
 var n=num(value);if(n==null)return '';
 if(Math.abs(n)>=1000000)return '$'+(n/1000000).toFixed(n>=10000000?0:1)+'M';
 if(Math.abs(n)>=1000)return '$'+(n/1000).toFixed(n>=10000?0:1)+'K';
 return '$'+Math.round(n);
}
function safeTeamLogo(value){
 if(!value)return '';
 try{var url=new URL(String(value),window.location.origin);return url.protocol==='https:'?url.href:'';}catch(e){return '';}
}
function teamLogoHtml(value,name){
 var href=safeTeamLogo(value);return href?'<img class="asTeamLogo" loading="lazy" decoding="async" src="'+esc(href)+'" alt="" title="'+esc(name||'Team')+'">':'';
}
function proplineMatchupHtml(g){
 var away=displayTeam(g.awayTeam),home=displayTeam(g.homeTeam);
 return '<div class="asCardMatch"><span class="asMatchTeams">'+teamLogoHtml(g.awayTeamLogoUrl,away)+'<b>'+esc(away)+'</b><i>@</i>'+teamLogoHtml(g.homeTeamLogoUrl,home)+'<b>'+esc(home)+'</b></span><span class="asCardTime">'+esc(when(g.gameStartTime))+'</span>'+(g.espnEventId?'<span class="asEspnMatch" title="PropLine supplied ESPN fixture id '+esc(g.espnEventId)+'">ESPN linked</span>':'')+'</div>';
}
function quoteMeta(row){
 if(!row)return '';
 var parts=[],p=num(row.impliedProbability);
 if(p!=null){if(p<=1)p*=100;if(p>=0&&p<=100)parts.push(dec(p,1)+'% implied');}
 var seen=quoteStamp(row),changed=quoteChangeStamp(row),seenAge=compactAge(seen),changeAge=compactAge(changed);
 if(seenAge)parts.push((row.provider==='propline'?'Seen ':'Updated ')+seenAge+' ago');
 if(changeAge&&changed!==seen)parts.push('Market change '+changeAge+' ago');
 return parts.join(' · ');
}
function quoteSignalHtml(row,g){
 var chips=[];
 if(row){
  var seen=quoteStamp(row),seenAge=compactAge(seen);
  if(seenAge)chips.push('<span class="asMarketSignal fresh">Fresh '+esc(seenAge)+'</span>');
  var flavor=String(row.dfsOddsType||'').toLowerCase();
  if(row.sportsbookKey==='prizepicks'&&flavor)chips.push('<span class="asMarketSignal pp '+esc(flavor)+'">PrizePicks '+esc(flavor.charAt(0).toUpperCase()+flavor.slice(1))+'</span>');
  var mult=num(row.payoutMultiplier);
  if(row.sportsbookKey==='underdog'&&mult!=null)chips.push('<span class="asMarketSignal ud">Underdog '+esc(mult.toFixed(2))+'×</span>');
 }
 var liquidRows=(g&&Array.isArray(g.rows)?g.rows:[]).filter(function(r){return num(r.liquidity)!=null;}).sort(function(a,b){return num(b.liquidity)-num(a.liquidity);});
 var liquid=(row&&num(row.liquidity)!=null)?row:liquidRows[0];
 if(liquid){var liq=num(liquid.liquidity),liqAt=liquid.liquidityUpdatedAt?Date.parse(liquid.liquidityUpdatedAt):NaN,liqAge=Number.isFinite(liqAt)?compactAge(liqAt):'',book=liquid.sportsbook||liquid.sportsbookKey||'';chips.push('<span class="asMarketSignal liquidity">'+esc(book?book+' ':'')+'Liquidity '+esc(marketAmount(liq))+(liqAge?' · '+esc(liqAge):'')+'</span>');}
 if(g&&g.espnEventId)chips.push('<span class="asMarketSignal espn">ESPN match</span>');
 return chips.length?'<div class="asMarketSignals" aria-label="Market data signals">'+chips.join('')+'</div>':'';
}
function currentBookSide(item,side){
 var rows=(item&&item.rows||[]).filter(function(r){return !r.isAlternate&&r.side===side&&num(r.line)!=null;});
 if(!rows.length)return null;
 var latest=Math.max.apply(null,rows.map(function(r){var t=quoteStamp(r);return t==null?0:t;}));
 var current=rows.filter(function(r){var t=quoteStamp(r);return (t==null?0:t)===latest;});
 var signatures=new Set(current.map(function(r){return JSON.stringify([num(r.line),num(r.price)]);}));
 return signatures.size===1?current[0]:null;
}
function oddsStrip(g){
 var rows=g.comparisonOffers||g.rows||[],activeSide=defaultSide(g);
 var comparison=compareResearchQuotes({...g,rows:rows,archived:!!g.archived||!!payload.meta?.stale},{line:boardLine(g),side:activeSide});
 var activeFresh=(comparison.offers||[]).filter(function(q){return q.fresh&&q.side===activeSide;});
 var canRank=activeFresh.length>=2,bestLineValue=canRank?comparison.bestLines[activeSide]:null;
 var bestLineBooks=new Set(activeFresh.filter(function(q){return q.line===bestLineValue;}).map(function(q){return bookId(q.bookKey||q.book||q.sportsbook);}));
 var bestPriceBooks=new Set((comparison.bestPrices[activeSide]||[]).map(function(q){return bookId(q.bookKey||q.book||q.sportsbook);}));
 var map=new Map();
 (g.rows||[]).forEach(function(r){
  if(r.isAlternate)return;
  var k=bookId(r.sportsbookKey||r.sportsbook);if(!k)return;
  if(!map.has(k))map.set(k,{key:k,name:r.sportsbook||bookInfo(k).name||k,rows:[]});
  map.get(k).rows.push(r);
 });
 var choices=Array.from(map.values()).sort(function(a,b){
  var ab=bestLineBooks.has(a.key)?0:1,bb=bestLineBooks.has(b.key)?0:1;
  return ab-bb||String(a.name).localeCompare(String(b.name));
 });
 if(!choices.length)return '';
 var selected=propBookFor(g)||'',selectedBook=selected?map.get(selected):null;
 var selectedOver=selectedBook?currentBookSide(selectedBook,'OVER'):bestLine(g,'OVER');
 var selectedUnder=selectedBook?currentBookSide(selectedBook,'UNDER'):bestLine(g,'UNDER');
 var options='<option value="">All books · best line</option>'+choices.map(function(item){return '<option value="'+esc(item.key)+'" '+(item.key===selected?'selected':'')+'>'+esc(item.name)+'</option>';}).join('');
 function selectedQuote(row,side){var line=row&&num(row.line)!=null?dec(row.line):'—',price=row&&num(row.price)!=null?money(row.price):'—';return '<span class="asPropBookQuote '+side.toLowerCase()+'"><b>'+side.charAt(0)+' '+esc(line)+'</b><em>'+esc(price)+'</em></span>';}
 var chips=choices.map(function(item){
  var over=currentBookSide(item,'OVER'),under=currentBookSide(item,'UNDER');
  var active=activeSide==='UNDER'?under:over;
  var bestLine=!!active&&bestLineBooks.has(item.key)&&num(active.line)===num(bestLineValue);
  var bestPrice=!!active&&bestPriceBooks.has(item.key)&&num(active.line)===num(comparison.selectedLine);
  var label=bestLine&&bestPrice?'BEST LINE + PRICE':bestLine?'BEST LINE':bestPrice?'BEST PRICE':'';
  var meta=quoteMeta(active||over||under),href=safeBookLink((active||over||under)?.deeplink);
  var open=href?'<a class="asOddsChip'+(bestLine||bestPrice?' asOddsBest':'')+'" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" data-book-link="1">':'<div class="asOddsChip'+(bestLine||bestPrice?' asOddsBest':'')+'">';
  var close=href?'</a>':'</div>';
  return open
   +'<div class="asOddsBookTop"><b>'+esc(String(item.name||item.key).slice(0,18))+'</b>'+(label?'<em>'+esc(label)+'</em>':'')+'</div>'
   +'<div class="asOddsValues">'
    +(over?'<span class="o"><strong>O '+esc(dec(over.line))+'</strong>'+(num(over.price)!=null?'<i>'+esc(money(over.price))+'</i>':'')+'</span>':'')
    +(under?'<span class="u"><strong>U '+esc(dec(under.line))+'</strong>'+(num(under.price)!=null?'<i>'+esc(money(under.price))+'</i>':'')+'</span>':'')
   +'</div>'
   +(meta?'<small class="asOddsMeta">'+esc(meta)+'</small>':'')
   +(href?'<small class="asOddsGo">Open book ↗</small>':'')+close;
 });
 var summary=[];
 if(bestLineValue!=null)summary.push((activeSide==='UNDER'?'Under':'Over')+' best '+dec(bestLineValue));
 if(activeFresh.length>=2){var values=activeFresh.map(function(q){return q.line;}),gap=Math.max.apply(null,values)-Math.min.apply(null,values);if(gap>0)summary.push('book gap '+dec(gap,2));}
 var propLineTimes=(g.rows||[]).filter(function(q){return q.provider==='propline'||q.providerOutcomeId;}).map(quoteStamp).filter(function(q){return q!=null;});
 if(propLineTimes.length)summary.push('fresh '+compactAge(Math.max.apply(null,propLineTimes)));
 var solo=choices.length<2;
 var signalRow=(activeSide==='UNDER'?selectedUnder:selectedOver)||selectedOver||selectedUnder||null;
 return '<div class="asOddsStrip asPropBookStrip'+(solo?' asOddsSolo':'')+'" aria-label="Sportsbook lines">'
  +'<div class="asOddsHead"><span>Available lines</span>'+(summary.length?'<strong>'+esc(summary.join(' · '))+'</strong>':'')+'</div>'
  +(solo?''
   :'<div class="asPropBookControl">'
   +'<label class="asPropBookPicker"><span class="asSrOnly">Sportsbook for '+esc(g.playerName+' '+g.market)+'</span><select class="asPropBookSelect" data-prop-book="'+esc(g.key)+'" aria-label="Choose sportsbook for '+esc(g.playerName+' '+g.market)+'">'+options+'</select></label>'
   +'<div class="asPropBookValues">'+selectedQuote(selectedOver,'OVER')+selectedQuote(selectedUnder,'UNDER')+'</div>'
   +'<small class="asPropBookMeta">'+esc(selected?'Selected sportsbook':choices.length+' live book'+(choices.length===1?'':'s')+' · tap to choose')+'</small>'
  +'</div>')
  +quoteSignalHtml(signalRow,g)
  +'<div class="asOddsRail">'+chips.join('')+'</div></div>';
}
`;

const MARKET_CSS = String.raw`
#as5 .asOddsStrip.asPropBookStrip{display:grid!important;gap:7px!important;margin:8px 10px 0!important;padding:9px!important;border:1px solid rgba(68,101,145,.42)!important;border-radius:13px!important;background:linear-gradient(180deg,rgba(6,18,34,.86),rgba(3,11,23,.94))!important;overflow:hidden!important}
#as5 .asOddsHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px!important}
#as5 .asOddsHead>span{font-size:8px!important;font-weight:950!important;letter-spacing:.08em!important;text-transform:uppercase!important;color:#7f96b2!important}
#as5 .asOddsHead>strong{font-size:8px!important;font-weight:800!important;color:#a9bad0!important;text-align:right!important}
#as5 .asPropBookControl{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:6px 10px!important;align-items:center!important}
#as5 .asPropBookControl .asPropBookPicker{min-width:0!important;max-width:none!important;width:100%!important}
#as5 .asPropBookControl .asPropBookMeta{grid-column:1/-1!important;margin-left:0!important}
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
#as5 .asMarketSignals{display:flex!important;gap:5px!important;flex-wrap:wrap!important;align-items:center!important;padding:0 2px!important}
#as5 .asMarketSignal{display:inline-flex!important;align-items:center!important;min-height:20px!important;padding:3px 6px!important;border:1px solid rgba(72,97,131,.5)!important;border-radius:999px!important;background:rgba(8,17,31,.72)!important;color:#9fb0c6!important;font-size:7px!important;font-weight:900!important;white-space:nowrap!important}
#as5 .asMarketSignal.fresh{border-color:rgba(16,185,129,.35)!important;color:#75e7bd!important;background:rgba(6,78,59,.16)!important}
#as5 .asMarketSignal.liquidity{border-color:rgba(56,189,248,.32)!important;color:#88d9fb!important}
#as5 .asMarketSignal.pp.goblin{border-color:rgba(34,197,94,.4)!important;color:#77e59a!important}
#as5 .asMarketSignal.pp.demon{border-color:rgba(244,63,94,.4)!important;color:#ff8da0!important}
#as5 .asMarketSignal.ud{border-color:rgba(139,92,246,.38)!important;color:#b9a4ff!important}
#as5 .asMarketSignal.espn{border-color:rgba(239,68,68,.3)!important;color:#f7a3a3!important}
#as5 .asMatchTeams{display:inline-flex!important;align-items:center!important;gap:4px!important;min-width:0!important}
#as5 .asMatchTeams b{font-size:inherit!important;font-weight:850!important;white-space:nowrap!important}
#as5 .asMatchTeams i{font-style:normal!important;color:#60738d!important;font-size:8px!important}
#as5 .asTeamLogo{width:17px!important;height:17px!important;object-fit:contain!important;flex:0 0 17px!important}
#as5 .asEspnMatch{display:inline-flex!important;align-items:center!important;padding:2px 5px!important;border:1px solid rgba(239,68,68,.28)!important;border-radius:999px!important;color:#efaaaa!important;background:rgba(127,29,29,.15)!important;font-size:6px!important;font-weight:900!important;white-space:nowrap!important}
#as5 .asPpSpecialStrip{border-color:rgba(124,91,255,.38)!important;background:linear-gradient(180deg,rgba(19,19,45,.78),rgba(8,13,26,.9))!important}
#as5 .asPpSpecialLabel{color:#9f94d8!important}
/* The dropdown already exposes every live book. The old card rail repeated the same
   PrizePicks/Underdog names and burned a large block of vertical space on mobile. */
#as5 .asOddsRail{display:none!important}
/* The visual header used a text glyph for search that can render as a boxed question
   mark on iOS. Suppress that glyph and draw a font-independent magnifier instead. */
#as5 .asHeaderSearchIcon{position:relative!important;display:inline-block!important;width:16px!important;height:16px!important;flex:0 0 16px!important;font-size:0!important;line-height:0!important;color:transparent!important}
#as5 .asHeaderSearchIcon:before{content:""!important;position:absolute!important;left:1px!important;top:1px!important;width:10px!important;height:10px!important;box-sizing:border-box!important;border:2px solid #9ebce2!important;border-radius:50%!important}
#as5 .asHeaderSearchIcon:after{content:""!important;position:absolute!important;left:10px!important;top:11px!important;width:6px!important;height:2px!important;border-radius:2px!important;background:#9ebce2!important;transform:rotate(45deg)!important;transform-origin:left center!important}
@media(max-width:540px){#as5 .asOddsStrip.asPropBookStrip{margin-left:8px!important;margin-right:8px!important;padding:7px!important;gap:5px!important}#as5 .asOddsRail{gap:7px!important}#as5 .asOddsChip{flex:0 0 calc(50% - 4px)!important;min-width:0!important;min-height:76px!important;padding:7px 8px!important;gap:4px!important}
#as5 .asOddsSolo .asOddsChip{flex:1 1 auto!important;min-height:0!important}
#as5 .asOddsSolo .asOddsRail{overflow-x:visible!important}#as5 .asOddsValues>span{padding:4px 5px!important}#as5 .asOddsHead>strong{max-width:58%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#as5 .asPropBookControl{grid-template-columns:1fr!important;gap:4px!important}#as5 .asPropBookControl .asPropBookValues{justify-content:space-between!important}}
`;

export function patchProplineMarketUi(source) {
  let patched = String(source ?? '');
  patched = replaceBlock(patched, 'odds strip', ODDS_START, ODDS_END, `${MARKET_FUNCTIONS}\n`);
  patched = replaceOnce(
    patched,
    MATCHUP_ANCHOR,
    "+proplineMatchupHtml(g)",
    'card matchup',
  );
  patched = replaceOnce(
    patched,
    BIND_START,
    `${BIND_START}\n document.querySelectorAll('[data-book-link]').forEach(function(a){a.onclick=function(e){e.stopPropagation();};a.onkeydown=function(e){e.stopPropagation();};});`,
    'row binding start',
  );
  const styleRuntime = `\n;(function installProplineMarketStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-propline-market-style'))return;var style=document.createElement('style');style.id='oblige-propline-market-style';style.textContent=${JSON.stringify(MARKET_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
  return patched + styleRuntime;
}
