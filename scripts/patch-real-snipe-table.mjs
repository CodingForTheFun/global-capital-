import { readFileSync, writeFileSync } from 'node:fs';

const file = 'apex-v2/scout-ui-v5.js';
let source = readFileSync(file, 'utf8');
function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`[snipe-table] ${label} anchor count=${count}`);
  source = source.replace(from, to);
}

// Snipes are derived market opportunities, not a normal prop-board filter.
// Clicking the quick chip opens the dedicated Snipes view and clears the old
// stale-line boolean so normal prop filtering cannot accidentally hide it.
replaceOnce(
  "   else if(id==='stale')quick.stale=!quick.stale;",
  "   else if(id==='stale'){quick.stale=false;activeView='snipes';}",
  'quick snipe opens dedicated view',
);

// A dedicated compact opportunity table. Each row represents a comparison
// signal: the takeable book/side/number versus the reference book/number.
// It deliberately does not render historical L5/L10 cards as if a snipe were
// an ordinary player recommendation.
replaceOnce(
  "async function prefetch(list){await Promise.all(list.map(async g=>{await getResearch(g,boardLine(g),defaultSide(g),false);if(g.sport===sport)renderListLight();}));}\nfunction renderListLight(){",
  `async function prefetch(list){await Promise.all(list.map(async g=>{await getResearch(g,boardLine(g),defaultSide(g),false);if(g.sport===sport)renderListLight();}));}\nfunction snipeTableHtml(groups){
 var rows=groups.map(function(g){var s=staleFor(g);if(!s)return null;return {g:g,s:s};}).filter(Boolean);
 if(!rows.length){
  var liveBooks=uniq(viewGroups().flatMap(function(g){return books(g);})).length;
  return '<div class="asEmpty"><b>No verified snipes right now.</b><p>A snipe needs the same player + market quoted by at least two independent live books, or a verified sharp-vs-retail lag. '+esc(sport)+' currently has '+liveBooks+' live book'+(liveBooks===1?'':'s')+' on this board. Auto Scout will not turn ordinary props into fake snipes.</p></div>';
 }
 return '<div class="asTableWrap"><table class="asTable asSnipeTable"><thead><tr><th>Player / market</th><th>Take</th><th>Book</th><th>Reference</th><th>Gap</th><th>Signal</th></tr></thead><tbody>'+rows.map(function(row){
  var g=row.g,s=row.s,refBook=s.referenceBook||s.sharpBook||'Market',refLine=s.referenceLine??s.sharpLine??s.line;
  var gap=s.edgePoints!=null?s.edgePoints+' prob pts':s.lineMove!=null?s.lineMove+' line':'—';
  var kind=s.source==='sharp-lag'?'Sharp lag':s.kind==='price'?'Price lag':'Cross-book';
  return '<tr><td><b>'+esc(g.playerName)+'</b><span class="asQuoteTime">'+esc(g.market)+' · '+esc(when(g.gameStartTime))+'</span></td><td><b>'+esc(s.side)+' '+esc(dec(s.line))+'</b>'+(s.retailPrice!=null?'<span class="asQuoteTime">'+esc(money(s.retailPrice))+'</span>':'')+'</td><td>'+esc(s.retailBook||s.retailKey||'—')+'</td><td>'+esc(refBook)+' <b>'+esc(dec(refLine))+'</b></td><td><b>'+esc(gap)+'</b></td><td><span class="asStaleTag">🎯 '+esc(kind)+'</span></td></tr>';
 }).join('')+'</tbody></table></div><p class="asNotice">Snipes are temporary market mismatches, not a second copy of the regular prop list. A row disappears when the books converge or the quote becomes stale.</p>';
}
function renderListLight(){`,
  'dedicated snipe table renderer',
);

replaceOnce(
  " applyColumnHeaders();document.getElementById('asResultCount').textContent=a.length+' players · '+(marketFilter==='all'?'grouped props':marketFilter)+' · '+(activeView==='saved'?(saveLoadError?'Saved props unavailable':serverSaves?'Saved to access profile':'Saved on this device'):'Available board');",
  " if(activeView==='snipes'){document.querySelector('.asHeaderRow').innerHTML='<span>Live snipe opportunities</span>';document.getElementById('asResultCount').textContent=a.length+' verified snipes · '+sport;list.innerHTML=snipeTableHtml(a);renderPagination(0);renderBatchControl();restoreFocus(focused||origin);return;}\n applyColumnHeaders();document.getElementById('asResultCount').textContent=a.length+' players · '+(marketFilter==='all'?'grouped props':marketFilter)+' · '+(activeView==='saved'?(saveLoadError?'Saved props unavailable':serverSaves?'Saved to access profile':'Saved on this device'):'Available board');",
  'route snipes to dedicated table',
);

writeFileSync(file, source, 'utf8');
console.log('[autoscout] real snipe table enabled: derived cross-book/sharp-lag opportunities only');
