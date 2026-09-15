const FUNCTION_ANCHOR = 'function rowHtml(g){';
const CARD_ANCHOR = "  +badgeStrip(g,r,side)\n  +staleBadge(g)";

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Recent-five UI patch expected one ${label} anchor; found ${count}.`);
  return source.replace(anchor, replacement);
}

const RECENT_FIVE_FUNCTION = String.raw`
// PrizePicks-style recent form, grounded only in this prop's real game history.
// The raw player statistic is shared across books; the colour is recalculated
// against whichever book line is currently displayed on the card.
function recentFiveStrip(g,r,line,side){
 if(!r||!r.available)return '';
 var games=Array.isArray(r.gameLog)?r.gameLog.slice(0,5):[];
 var usable=games.filter(function(game){return num(game&&game.value)!=null;});
 if(!usable.length){
  return '<section class="asRecentFive asRecentFiveEmpty" aria-label="Last five recent results unavailable">'
   +'<div class="asRecentFiveHead"><b>Last 5</b><span>'+esc(r?.marketDisplayName||g.market)+'</span></div>'
   +'<p>Recent stats unavailable for this prop.</p></section>';
 }
 var target=num(line),activeSide=String(side||'OVER').toUpperCase();
 var values=usable.map(function(game){return num(game.value);});
 var average=values.reduce(function(total,value){return total+value;},0)/values.length;
 var scale=Math.max.apply(Math,(target==null?values:values.concat([target])).concat([1]));
 var cells=usable.map(function(game){
  var value=num(game.value),push=target!=null&&value===target;
  var hit=target==null?null:(activeSide==='UNDER'?value<target:value>target);
  var tone=target==null?'neutral':push?'push':hit?'hit':'miss';
  var height=Math.max(9,Math.min(100,Math.max(0,value)/scale*100));
  return '<div class="asRecentFiveGame '+tone+'">'
   +'<strong>'+esc(dec(value,1))+'</strong>'
   +'<div class="asRecentFiveBar" aria-hidden="true"><i style="height:'+height.toFixed(1)+'%"></i></div>'
   +'<span>'+esc(displayTeam(game.opponent)||'—')+'</span>'
   +'<small>'+esc(shortDate(game.date))+'</small></div>';
 }).join('');
 var sideLabel=activeSide==='UNDER'?'Under':'Over';
 return '<section class="asRecentFive" aria-label="Last '+usable.length+' recent '+esc(r?.marketDisplayName||g.market)+' results">'
  +'<div class="asRecentFiveHead"><span><b>Last '+usable.length+'</b><em>'+esc(r?.marketDisplayName||g.market)+'</em></span>'
   +(target==null?'':'<span class="asRecentFiveTarget">'+esc(sideLabel)+' '+esc(dec(target,1))+'</span>')+'</div>'
  +'<div class="asRecentFiveChart" style="--recent-count:'+usable.length+'">'+cells+'</div>'
  +'<div class="asRecentFiveFoot"><span><b>'+esc(dec(average,1))+'</b> avg last '+usable.length+'</span>'
   +(target==null?'':'<span>vs displayed '+esc(dec(target,1))+' line</span>')+'</div></section>';
}
`;

const RECENT_FIVE_CSS = String.raw`
#as5 .asRecentFive{margin:9px 12px 2px;padding:10px 11px 9px;border:1px solid rgba(72,91,127,.55);border-radius:12px;background:linear-gradient(180deg,rgba(12,18,31,.92),rgba(8,13,23,.96));overflow:hidden}
#as5 .asRecentFiveHead,#as5 .asRecentFiveFoot{display:flex;align-items:center;justify-content:space-between;gap:8px}
#as5 .asRecentFiveHead>span:first-child{display:flex;align-items:baseline;gap:7px;min-width:0}
#as5 .asRecentFiveHead b{font-size:11px;letter-spacing:.01em;color:#f8fafc}
#as5 .asRecentFiveHead em{font-style:normal;font-size:8px;font-weight:800;color:#8391a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#as5 .asRecentFiveTarget{flex:0 0 auto;padding:4px 7px;border:1px solid rgba(68,230,166,.24);border-radius:999px;background:rgba(20,90,67,.22);color:#8ef0c3;font-size:8px;font-weight:900}
#as5 .asRecentFiveChart{display:grid;grid-template-columns:repeat(var(--recent-count,5),minmax(0,1fr));gap:7px;align-items:end;margin-top:8px;min-height:107px}
#as5 .asRecentFiveGame{display:grid;grid-template-rows:18px 62px 16px 13px;min-width:0;text-align:center;align-items:end}
#as5 .asRecentFiveGame strong{align-self:center;font-size:10px;line-height:1;color:#e5e7eb}
#as5 .asRecentFiveBar{height:62px;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid rgba(148,163,184,.3);background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.004));border-radius:5px 5px 0 0;overflow:hidden}
#as5 .asRecentFiveBar i{display:block;width:min(82%,44px);min-height:5px;border-radius:6px 6px 2px 2px;background:#64748b;box-shadow:0 0 16px rgba(100,116,139,.12)}
#as5 .asRecentFiveGame.hit .asRecentFiveBar i{background:#23e29b;box-shadow:0 0 18px rgba(35,226,155,.15)}
#as5 .asRecentFiveGame.miss .asRecentFiveBar i{background:#f05263;box-shadow:0 0 18px rgba(240,82,99,.12)}
#as5 .asRecentFiveGame.push .asRecentFiveBar i{background:#a3a8b5}
#as5 .asRecentFiveGame span{align-self:end;font-size:8px;font-weight:950;color:#dce3ed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#as5 .asRecentFiveGame small{align-self:start;font-size:7px;color:#6f7e94;white-space:nowrap}
#as5 .asRecentFiveFoot{margin-top:6px;padding-top:6px;border-top:1px solid rgba(63,78,105,.35);font-size:8px;color:#77869d}
#as5 .asRecentFiveFoot b{font-size:11px;color:#eef3f8}
#as5 .asRecentFiveEmpty{min-height:58px;display:grid;align-content:center;gap:6px}
#as5 .asRecentFiveEmpty p{margin:0;color:#718096;font-size:8px}
@media(max-width:540px){#as5 .asRecentFive{margin-left:8px;margin-right:8px;padding:9px 8px 8px}#as5 .asRecentFiveChart{gap:4px;min-height:99px}#as5 .asRecentFiveGame{grid-template-rows:17px 57px 15px 12px}#as5 .asRecentFiveBar{height:57px}#as5 .asRecentFiveHead em{max-width:132px}#as5 .asRecentFiveFoot{font-size:7px}}
`;

export function patchRecentFiveUi(source) {
  let patched = String(source ?? '');
  patched = replaceOnce(
    patched,
    FUNCTION_ANCHOR,
    `${RECENT_FIVE_FUNCTION}\n${FUNCTION_ANCHOR}`,
    'row renderer',
  );
  patched = replaceOnce(
    patched,
    CARD_ANCHOR,
    "  +badgeStrip(g,r,side)\n  +recentFiveStrip(g,r,line,side)\n  +staleBadge(g)",
    'card insertion',
  );
  const styleRuntime = `\n;(function installRecentFiveStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-recent-five-style'))return;var style=document.createElement('style');style.id='oblige-recent-five-style';style.textContent=${JSON.stringify(RECENT_FIVE_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
  return patched + styleRuntime;
}
