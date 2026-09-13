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

// The normal board honors the selected-book drawer. Snipes must not shrink the
// market reference set just because the bettor selected one target platform.
// Scan every live book in Snipes; ordinary prop/research views stay unchanged.
replaceOnce(
  "function viewGroups(){var current=groups().filter(g=>g.sport===sport);if(activeView!=='saved')return current;var merged=new Map(current.filter(g=>favorites.has(g.key)).map(g=>[g.key,g]));savedRecords.forEach(g=>{if(g.sport===sport&&favorites.has(g.key)&&!merged.has(g.key))merged.set(g.key,{...g,archived:true});});return filterBookGroups(Array.from(merged.values()),selectedBooks);}",
  "function viewGroups(){var current=(activeView==='snipes'?groups(true):groups()).filter(g=>g.sport===sport);if(activeView!=='saved')return current;var merged=new Map(current.filter(g=>favorites.has(g.key)).map(g=>[g.key,g]));savedRecords.forEach(g=>{if(g.sport===sport&&favorites.has(g.key)&&!merged.has(g.key))merged.set(g.key,{...g,archived:true});});return filterBookGroups(Array.from(merged.values()),selectedBooks);}",
  'snipes use full reference pool',
);

// A dedicated compact opportunity table. Each row represents one specific
// actionable quote against a sharp or multi-book market reference. It never
// renders historical L5/L10 cards as if a snipe were an ordinary prop.
replaceOnce(
  "async function prefetch(list){await Promise.all(list.map(async g=>{await getResearch(g,boardLine(g),defaultSide(g),false);if(g.sport===sport)renderListLight();}));}\nfunction renderListLight(){",
  `async function prefetch(list){await Promise.all(list.map(async g=>{await getResearch(g,boardLine(g),defaultSide(g),false);if(g.sport===sport)renderListLight();}));}\nfunction snipeTableHtml(groups){
 var rows=groups.map(function(g){var s=staleFor(g);if(!s)return null;return {g:g,s:s};}).filter(Boolean);
 if(!rows.length){
  var liveBooks=uniq(viewGroups().flatMap(function(g){return books(g);})).length;
  return '<div class="asEmpty"><b>No verified snipes right now.</b><p>A normal consensus snipe needs one bettor-friendly target quote plus at least two independent live reference books. A two-book signal is accepted only when the reference is a verified sharp book. '+esc(sport)+' currently has '+liveBooks+' live book'+(liveBooks===1?'':'s')+' available for comparison. Auto Scout will not turn ordinary props into fake snipes.</p></div>';
 }
 return '<div class="asTableWrap"><table class="asTable asSnipeTable"><thead><tr><th>Player / market</th><th>Take</th><th>Book</th><th>Reference</th><th>Edge</th><th>Evidence</th></tr></thead><tbody>'+rows.map(function(row){
  var g=row.g,s=row.s,refBook=s.referenceBook||s.sharpBook||'Market consensus',refLine=s.referenceLine??s.sharpLine??s.line;
  var edge=s.edgePct!=null?'+'+dec(s.edgePct)+'% EV':s.edgePoints!=null?s.edgePoints+' prob pts':s.lineMove!=null?'+'+dec(s.lineMove)+' line':'—';
  var kind=s.source==='sharp-lag'?'Sharp confirmed':s.kind==='price-consensus'?'No-vig consensus':s.source==='sharp-consensus'?'Sharp + consensus':'Market consensus';
  var evidence=s.referenceCount!=null?(s.supportCount!=null?s.supportCount+'/'+s.referenceCount+' refs':s.referenceCount+' refs'):(s.signalCount!=null?s.signalCount+' signal'+(s.signalCount===1?'':'s'):'Verified');
  return '<tr><td><b>'+esc(g.playerName)+'</b><span class="asQuoteTime">'+esc(g.market)+' · '+esc(when(g.gameStartTime))+'</span></td><td><b>'+esc(s.side)+' '+esc(dec(s.line))+'</b>'+(s.price!=null||s.retailPrice!=null?'<span class="asQuoteTime">'+esc(money(s.price??s.retailPrice))+'</span>':'')+'</td><td>'+esc(s.targetBook||s.retailBook||s.targetKey||s.retailKey||'—')+'</td><td>'+esc(refBook)+' <b>'+esc(dec(refLine))+'</b></td><td><b>'+esc(edge)+'</b></td><td><span class="asStaleTag">🎯 '+esc(kind)+'</span><span class="asQuoteTime">'+esc(evidence)+'</span></td></tr>';
 }).join('')+'</tbody></table></div><p class="asNotice">Snipes are temporary executable market mismatches, not a second copy of the regular prop list. They disappear when the market converges, the edge drops below the threshold, or the quote becomes stale.</p>';
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
console.log('[autoscout] real snipe table enabled: sharp/no-vig/multi-book consensus opportunities only');
