const STATE_ANCHOR = "var sideFilter='all';\nvar sortBy='shuffle';";
const FILTER_ANCHOR = '<label><span class="asSrOnly">Over or Under</span><select class="asControl" id="asSide"><option value="all">Over + Under</option><option value="OVER">Over</option><option value="UNDER">Under</option></select></label><button class="asBtn asFilterTrigger" id="asAdvancedToggle" aria-expanded="false">Filters <span id="asFilterCount"></span></button>';
const SIDE_BIND_ANCHOR = " document.getElementById('asSide').onchange=e=>{sideFilter=e.target.value;page=1;renderList();};";
const CONTROL_VALUE_ANCHOR = " document.getElementById('asSearch').value=query;document.getElementById('asSide').value=sideFilter;document.getElementById('asSort').value=sortBy;applyPreferences();renderAdvanced();renderSlip();";
const VISIBLE_ANCHOR = "function visible(ignoreResearch=false){\n var a=viewGroups();";
const FOCUS_ANCHOR = 'function focusToken(element){';
const RESET_ANCHOR = "query='';marketFilter=bookFilter=sideFilter='all';selectedBooks=null;";

const OLD_SPECIAL_STRIP = String.raw`function prizePicksSpecialStrip(g){
 if(g.archived||!Array.isArray(g.specialRows)||!g.specialRows.length)return '';
 var rows=g.specialRows.slice().sort(function(a,b){return num(a.line)-num(b.line)||String(a.side).localeCompare(String(b.side));});
 var chips=rows.map(function(row){
  var face=prizePicksSpecialFaceHtml(row);
  if(!face)return '';
  return '<span class="asPpSpecialChip '+esc(row.specialType)+'">'+face+'<b>'+esc(row.side==='UNDER'?'Less':'More')+'</b><em>'+esc(dec(row.line,1))+'</em></span>';
 }).filter(Boolean);
 if(!chips.length)return '';
 return '<div class="asPpSpecialStrip" aria-label="PrizePicks alternate projections"><span class="asPpSpecialLabel">PrizePicks variants</span>'+chips.join('')+'</div>';
}`;

const NEW_SPECIAL_STRIP = String.raw`function prizePicksSpecialStrip(g){
 if(g.archived||!Array.isArray(g.specialRows)||!g.specialRows.length)return '';
 var rows=g.specialRows.slice().sort(function(a,b){return num(a.line)-num(b.line)||String(a.side||'').localeCompare(String(b.side||''));});
 var chips=rows.map(function(row){
  var face=prizePicksSpecialFaceHtml(row);
  if(!face)return '';
  var direction=row.side==='UNDER'?'Less':row.side==='OVER'?'More':'';
  var label=direction||(row.specialType==='demon'?'Demon':'Goblin');
  return '<span class="asPpSpecialChip '+esc(row.specialType)+'">'+face+'<b>'+esc(label)+'</b><em>'+esc(dec(row.line,1))+'</em></span>';
 }).filter(Boolean);
 if(!chips.length)return '';
 return '<div class="asPpSpecialStrip" aria-label="PrizePicks alternate projections"><span class="asPpSpecialLabel">PrizePicks variants</span>'+chips.join('')+'</div>';
}`;

const AUTO_REFRESH_RUNTIME = String.raw`
var autoBoardRefreshTimer=null,lastAutoBoardRefreshAt=Date.now();
function autoBoardRefreshSafe(){
 removeExpiredTacoBadges(document);removeExpiredPrizePicksSpecials(document);
 if(document.hidden||loading||drawerState)return;
 var active=document.activeElement;
 if(active&&['INPUT','SELECT','TEXTAREA'].includes(active.tagName))return;
 if(Date.now()-lastAutoBoardRefreshAt<85000)return;
 lastAutoBoardRefreshAt=Date.now();load();
}
function startAutoBoardRefresh(){
 if(autoBoardRefreshTimer)return;
 autoBoardRefreshTimer=setInterval(autoBoardRefreshSafe,15000);
 document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastAutoBoardRefreshAt>=85000)autoBoardRefreshSafe();});
}
`;

const SPECIAL_CSS = String.raw`
@media(min-width:981px){#as5 .asFilters{grid-template-columns:minmax(220px,1.5fr) repeat(5,minmax(108px,.7fr))}}
#as5 #asSpecial{border-color:#33415b;background:#0c121d}
#as5 #asSpecial option[value="goblin"]{color:#86efac}
#as5 #asSpecial option[value="demon"]{color:#fda4af}
`;

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Automatic special-prop UI patch expected one ${label}; found ${count}.`);
  return source.replace(anchor, replacement);
}

export function patchAutomaticSpecialPropsUi(source) {
  let patched = String(source ?? '');
  patched = replaceOnce(
    patched,
    STATE_ANCHOR,
    "var sideFilter='all';\nvar specialFilter=String(readStored('autoscout-special-filter','all')||'all').toLowerCase();\nif(!['all','goblin','demon'].includes(specialFilter))specialFilter='all';\nvar sortBy='shuffle';",
    'special-filter state anchor',
  );
  patched = replaceOnce(
    patched,
    FILTER_ANCHOR,
    '<label><span class="asSrOnly">Over or Under</span><select class="asControl" id="asSide"><option value="all">Over + Under</option><option value="OVER">Over</option><option value="UNDER">Under</option></select></label><label><span class="asSrOnly">PrizePicks special projection</span><select class="asControl" id="asSpecial" aria-label="PrizePicks Goblin or Demon filter"><option value="all">All variants</option><option value="goblin">Green Goblins</option><option value="demon">Red Demons</option></select></label><button class="asBtn asFilterTrigger" id="asAdvancedToggle" aria-expanded="false">Filters <span id="asFilterCount"></span></button>',
    'filter controls anchor',
  );
  patched = replaceOnce(
    patched,
    SIDE_BIND_ANCHOR,
    SIDE_BIND_ANCHOR+"\n document.getElementById('asSpecial').onchange=e=>{specialFilter=e.target.value;storeLocal('autoscout-special-filter',specialFilter);page=1;renderList();};",
    'side-filter binding anchor',
  );
  patched = replaceOnce(
    patched,
    CONTROL_VALUE_ANCHOR,
    " document.getElementById('asSearch').value=query;document.getElementById('asSide').value=sideFilter;document.getElementById('asSpecial').value=specialFilter;document.getElementById('asSort').value=sortBy;applyPreferences();renderAdvanced();renderSlip();startAutoBoardRefresh();",
    'initial control values anchor',
  );
  patched = replaceOnce(
    patched,
    VISIBLE_ANCHOR,
    VISIBLE_ANCHOR+"\n if(specialFilter!=='all')a=a.filter(function(g){return Array.isArray(g.specialRows)&&g.specialRows.some(function(row){return row.specialVerified===true&&row.specialType===specialFilter;});});",
    'visible-list anchor',
  );
  patched = replaceOnce(
    patched,
    RESET_ANCHOR,
    "query='';marketFilter=bookFilter=sideFilter='all';specialFilter='all';storeLocal('autoscout-special-filter','all');selectedBooks=null;",
    'clear-filters anchor',
  );
  patched = replaceOnce(patched, OLD_SPECIAL_STRIP, NEW_SPECIAL_STRIP, 'special-line renderer');
  patched = replaceOnce(patched, FOCUS_ANCHOR, AUTO_REFRESH_RUNTIME+'\n'+FOCUS_ANCHOR, 'auto-refresh runtime anchor');
  return patched + `\n;(function installAutomaticSpecialPropsStyle(){if(typeof document==='undefined')return;if(document.getElementById('oblige-auto-special-props-style'))return;var style=document.createElement('style');style.id='oblige-auto-special-props-style';style.textContent=${JSON.stringify(SPECIAL_CSS)};(document.head||document.documentElement).appendChild(style);})();\n`;
}
