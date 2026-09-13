function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Auto Scout research UI patch could not locate ${label}.`);
  return source.replace(from, to);
}

export function patchResearchUi(source) {
  let out = String(source || '');

  out = replaceOnce(
    out,
    "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL'];",
    "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL','TENNIS'];",
    'sport list',
  );

  out = replaceOnce(
    out,
    "var { detectStaleLine, staleLineLabel } = await import('/assets/lib/markets/line-lag.mjs');",
    "var { detectStaleLine, detectSnipe, staleLineLabel } = await import('/assets/lib/markets/line-lag.mjs');",
    'automatic snipe import',
  );

  out = replaceOnce(
    out,
    "var { repriceProjection } = await import('/assets/lib/projections/reprice.mjs');",
    "var { repriceProjection } = await import('/assets/lib/projections/reprice.mjs');\nvar { buildSnipeRows, snipeTableHtml } = await import('/assets/lib/ui/snipe-table.mjs');",
    'dedicated snipe table import',
  );

  out = replaceOnce(
    out,
    '<span class="asStatus" id="asStatus">Current sportsbook lines</span><button class="asBtn" id="asRefresh">Refresh</button>',
    '<span class="asStatus" id="asStatus">Current sportsbook lines</span><span id="asRefresh" hidden aria-hidden="true"></span>',
    'manual refresh button',
  );

  out = replaceOnce(
    out,
    "var BOARD_VIEWS={research:'Prop Research',players:'Players',popular:'Popular',discrepancies:'Line Discrepancies',saved:'Saved Props'};",
    "var BOARD_VIEWS={research:'Prop Research',players:'Players',popular:'Popular',snipes:'Live Snipes',discrepancies:'Line Discrepancies',saved:'Saved Props'};",
    'snipe board view',
  );

  out = replaceOnce(
    out,
    "var staleCache=new Map();",
    "var staleCache=new Map(),seenSnipeKeys=new Set(),snipeAlertsPrimedSport=null;",
    'snipe alert state',
  );

  out = replaceOnce(
    out,
    "<button data-view=\"discrepancies\" data-icon=\"trend\" aria-label=\"Compare line discrepancies\"><span class=\"asNavIcon\" aria-hidden=\"true\">↗</span><span>Compare</span></button>",
    "<button data-view=\"snipes\" data-icon=\"trend\" aria-label=\"Live market snipes\"><span class=\"asNavIcon\" aria-hidden=\"true\">◎</span><span>Snipes</span></button><button data-view=\"discrepancies\" data-icon=\"trend\" aria-label=\"Compare line discrepancies\"><span class=\"asNavIcon\" aria-hidden=\"true\">↗</span><span>Compare</span></button>",
    'snipes navigation',
  );

  out = replaceOnce(
    out,
    "document.getElementById('asRefresh').onclick=()=>load();",
    "document.getElementById('asRefresh').onclick=()=>load();document.querySelector('.asNav')?.style.setProperty('grid-template-columns','repeat(6,minmax(0,1fr))');",
    'snipes navigation layout',
  );

  out = replaceOnce(
    out,
    "function staleFor(g){\n if(staleCache.has(g.key))return staleCache.get(g.key);\n var signal=null;\n try{signal=detectStaleLine(g.rows);}catch(e){signal=null;}\n staleCache.set(g.key,signal);\n return signal;\n}\nfunction staleBadge(g){\n var signal=staleFor(g);\n if(!signal)return '';\n return '<div class=\"asStale\"><span class=\"asStaleTag\">⚡ Stale Line</span>'\n  +'<span class=\"asStaleText\">'+esc(staleLineLabel(signal))+'</span></div>';\n}",
    `function staleFor(g){
 if(staleCache.has(g.key))return staleCache.get(g.key);
 var signal=null;
 try{signal=detectSnipe(g.comparisonOffers||g.rows,{targetBooks:selectedBooks});}catch(e){signal=null;}
 staleCache.set(g.key,signal);
 return signal;
}
function staleBadge(g){
 var signal=staleFor(g);
 if(!signal)return '';
 return '<div class="asStale"><span class="asStaleTag">🎯 Market Snipe</span>'
  +'<span class="asStaleText">'+esc(staleLineLabel(signal))+'</span></div>';
}
function snipeRows(){
 return buildSnipeRows(groups(true),{sport,targetBooks:selectedBooks,query,market:marketFilter,side:sideFilter});
}
function announceSnipes(){
 var current=new Map(buildSnipeRows(groups(true),{sport,targetBooks:selectedBooks}).map(function(row){return[row.id,row];}));
 if(snipeAlertsPrimedSport!==sport){seenSnipeKeys=new Set(current.keys());snipeAlertsPrimedSport=sport;return;}
 var fresh=[...current.keys()].filter(key=>!seenSnipeKeys.has(key));
 seenSnipeKeys=new Set(current.keys());
 if(!fresh.length)return;
 toast(fresh.length===1?'🎯 New market snipe detected':'🎯 '+fresh.length+' new market snipes detected');
}`,
    'market-backed snipe detector',
  );

  out = replaceOnce(
    out,
    "function renderSummary(){var gs=groups(),events=uniq(gs.map(function(g){return g.eventId;})).length,booksAll=uniq(gs.flatMap(function(g){return books(g);})).length,ready=gs.filter(function(g){var r=researchFor(g);return r&&r.available;}).length;document.getElementById('asSummary').innerHTML=[['Markets',gs.length],['Events',events],['Sportsbooks',booksAll],['Research ready',ready],['Listed lines',(payload.props||[]).length]].map(function(x){return'<div class=\"asSummaryItem\"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>';}).join('');}",
    `function renderSummary(){
 if(activeView==='snipes'){
  var ss=snipeRows(),events=uniq(ss.map(function(row){return row.groupKey&&groups(true).find(function(g){return g.key===row.groupKey;})?.eventId;})).length,targets=uniq(ss.map(function(row){return row.targetKey;})).length,sharp=ss.filter(function(row){return String(row.quality||'').toLowerCase().includes('sharp');}).length,consensus=ss.filter(function(row){return String(row.source||'').includes('consensus');}).length;
  document.getElementById('asSummary').innerHTML=[['Live snipes',ss.length],['Events',events],['Target books',targets],['Sharp confirmed',sharp],['Consensus backed',consensus]].map(function(x){return'<div class="asSummaryItem"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>';}).join('');return;
 }
 var gs=groups(),events=uniq(gs.map(function(g){return g.eventId;})).length,booksAll=uniq(gs.flatMap(function(g){return books(g);})).length,ready=gs.filter(function(g){var r=researchFor(g);return r&&r.available;}).length;document.getElementById('asSummary').innerHTML=[['Markets',gs.length],['Events',events],['Sportsbooks',booksAll],['Research ready',ready],['Listed lines',(payload.props||[]).length]].map(function(x){return'<div class="asSummaryItem"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>';}).join('');}`,
    'snipe-specific summary',
  );

  out = replaceOnce(
    out,
    " var viewNote=document.getElementById('asViewNote'),notes={popular:'Sorted by the number of sportsbooks quoting each prop. User pick popularity is unavailable.',discrepancies:'Largest line differences across fresh, verified books on the selected side. Differences are in each market’s own units and are not an EV ranking.'};",
    " var viewNote=document.getElementById('asViewNote'),notes={popular:'Sorted by the number of sportsbooks quoting each prop. User pick popularity is unavailable.',snipes:'Snipes are specific executable lines or prices that beat a sharp reference or a multi-book market consensus. All available books are used as references even when your selected platforms only limit where the bet can be placed.',discrepancies:'Largest line differences across fresh, verified books on the selected side. Differences are in each market’s own units and are not an EV ranking.'};",
    'snipes view explanation',
  );

  out = replaceOnce(
    out,
    " var list=document.getElementById('asList'),a=cardList(),focused=(list.contains(document.activeElement)||document.querySelector('.asHeaderRow').contains(document.activeElement))?focusToken(document.activeElement):null,origin=focusToken(lastFocus);\n applyColumnHeaders();document.getElementById('asResultCount').textContent=a.length+' players · '+(marketFilter==='all'?'grouped props':marketFilter)+' · '+(activeView==='saved'?(saveLoadError?'Saved props unavailable':serverSaves?'Saved to access profile':'Saved on this device'):'Available board');",
    ` var list=document.getElementById('asList'),a=activeView==='snipes'?snipeRows():cardList(),focused=(list.contains(document.activeElement)||document.querySelector('.asHeaderRow').contains(document.activeElement))?focusToken(document.activeElement):null,origin=focusToken(lastFocus);
 applyColumnHeaders();document.querySelector('.asHeaderRow').hidden=activeView==='snipes';document.getElementById('asResultCount').textContent=activeView==='snipes'?(a.length+' live market snipes · consensus/sharp backed'):(a.length+' players · '+(marketFilter==='all'?'grouped props':marketFilter)+' · '+(activeView==='saved'?(saveLoadError?'Saved props unavailable':serverSaves?'Saved to access profile':'Saved on this device'):'Available board'));`,
    'dedicated snipe result set',
  );

  out = replaceOnce(
    out,
    " if(!a.length){list.innerHTML='<div class=\"asEmpty\"><b>'+esc(activeView==='saved'?'No saved props in this view.':payload.meta?.warning?'Props could not load.':(payload.props||[]).length?'No props match your filters.':'No live props available for '+sport+'.')+'</b><p>'+esc(activeView==='saved'?'Save a prop to return to it here.':(payload.props||[]).length?'Clear filters or try another market.':'Try another sport or refresh shortly.')+'</p><button class=\"asBtn\" id=\"asResetEmpty\">'+((payload.props||[]).length?'Clear filters':'Refresh')+'</button></div>';document.getElementById('asResetEmpty').onclick=()=>{query='';marketFilter=bookFilter=sideFilter='all';selectedBooks=null;storeLocal('autoscout-selected-books',null);advanced={};document.getElementById('asSearch').value='';document.getElementById('asSide').value='all';renderAdvanced();renderControls();(payload.props||[]).length?renderList():load();};}",
    ` if(!a.length){
  if(activeView==='snipes'){
   var selectedTargetCount=Array.isArray(selectedBooks)?selectedBooks.length:null;
   list.innerHTML='<div class="asEmpty"><b>No verified market snipes right now.</b><p>'+esc(selectedTargetCount===1?'Auto Scout is still comparing that selected platform against every available reference book. A snipe only appears when the target line or price is materially better than a sharp or multi-book consensus.':'A snipe requires a specific target quote plus sharp or multi-book confirmation. Regular player props are intentionally not copied into this table.')+'</p><button class="asBtn" id="asResetEmpty">Scan all target books</button></div>';
   document.getElementById('asResetEmpty').onclick=()=>{selectedBooks=null;storeLocal('autoscout-selected-books',null);query='';marketFilter=sideFilter='all';document.getElementById('asSearch').value='';document.getElementById('asSide').value='all';renderControls();renderList();};
  } else {
   list.innerHTML='<div class="asEmpty"><b>'+esc(activeView==='saved'?'No saved props in this view.':payload.meta?.warning?'Props could not load.':(payload.props||[]).length?'No props match your filters.':'No live props available for '+sport+'.')+'</b><p>'+esc(activeView==='saved'?'Save a prop to return to it here.':(payload.props||[]).length?'Clear filters or try another market.':'Try another sport or refresh shortly.')+'</p><button class="asBtn" id="asResetEmpty">'+((payload.props||[]).length?'Clear filters':'Refresh')+'</button></div>';document.getElementById('asResetEmpty').onclick=()=>{query='';marketFilter=bookFilter=sideFilter='all';selectedBooks=null;storeLocal('autoscout-selected-books',null);advanced={};document.getElementById('asSearch').value='';document.getElementById('asSide').value='all';renderAdvanced();renderControls();(payload.props||[]).length?renderList():load();};
  }
 }`,
    'truthful snipe empty state',
  );

  out = replaceOnce(
    out,
    "  list.innerHTML=a.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(rowHtml).join('');bindRows();}",
    "  list.innerHTML=activeView==='snipes'?snipeTableHtml(a.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE)):a.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(rowHtml).join('');bindRows();}",
    'dedicated snipe table rendering',
  );

  out = replaceOnce(
    out,
    " hydrateML();\n renderPagination(a.length);\n renderBatchControl();\n if(!hydrateFailed)hydrateBoard();",
    " if(activeView!=='snipes')hydrateML();\n renderPagination(a.length);\n renderBatchControl();document.getElementById('asResearchBatch').hidden=activeView==='snipes';\n if(activeView!=='snipes'&&!hydrateFailed)hydrateBoard();",
    'skip research hydration for snipes',
  );

  out = replaceOnce(
    out,
    " intelligence?.updateBoard({groups:a,allGroups:groups(),scope:sport,at:payload.meta?.fetchedAt,stale:payload.meta?.stale});",
    " if(activeView!=='snipes')intelligence?.updateBoard({groups:a,allGroups:groups(),scope:sport,at:payload.meta?.fetchedAt,stale:payload.meta?.stale});",
    'keep intelligence on prop groups only',
  );

  out = replaceOnce(
    out,
    "document.getElementById('asList').setAttribute('aria-busy','false');render();syncPropRoute();",
    "document.getElementById('asList').setAttribute('aria-busy','false');announceSnipes();render();syncPropRoute();",
    'automatic snipe alerts on refresh',
  );

  out = replaceOnce(
    out,
    "function researchFor(g,line,side){\n var key=researchKey(g,line==null?boardLine(g):line,side||defaultSide(g)), entry=researchCache.get(key);",
    `function lineOnlyPolicy(g){
 var name=String(g?.playerName||''),market=String(g?.market||''),marketId=String(g?.marketId||''),selectedSport=String(g?.sport||'').toUpperCase();
 if(/\\s+\\+\\s+/.test(name)||/\\bcombo\\b/i.test(market))return {ok:true,available:false,lineOnly:true,retryable:false,code:'COMBO_HISTORY_UNVERIFIED',message:'Live combo line only. Auto Scout does not combine separate player histories unless the source provides a verified combo history.'};
 if(/\\bfantasy(?:\\s+(?:score|points?))?\\b/i.test(market+' '+marketId))return {ok:true,available:false,lineOnly:true,retryable:false,code:'FANTASY_SCORING_UNVERIFIED',message:'Live fantasy line only. Historical hit rates are withheld until this platform’s exact scoring formula is verified for this sport.'};
 if(selectedSport==='TENNIS')return {ok:true,available:false,lineOnly:true,retryable:false,code:'HISTORICAL_SOURCE_UNVERIFIED',message:'Live tennis line only. A complete tennis match-history source is not verified yet, so Auto Scout will not invent L5/L10/H2H results.'};
 return null;
}
function researchFor(g,line,side){
 var lineOnly=lineOnlyPolicy(g);if(lineOnly)return lineOnly;
 var key=researchKey(g,line==null?boardLine(g):line,side||defaultSide(g)), entry=researchCache.get(key);`,
    'research cache entry',
  );

  out = replaceOnce(
    out,
    "async function getResearch(g,line,side,force){\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),key=researchKey(g,valueLine,valueSide);",
    "async function getResearch(g,line,side,force){\n var lineOnly=lineOnlyPolicy(g);if(lineOnly)return lineOnly;\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),key=researchKey(g,valueLine,valueSide);",
    'research request entry',
  );

  out = replaceOnce(
    out,
    "function researchState(r){\n if(!r)return hydrateFailed?'Research needs retry':'Loading historical results';\n if(r.available)return '';\n if(r.code==='NO_GAME_LOG_DATA')return 'No logs available';\n if(r.retryable||r.code==='RESEARCH_PROVIDER_ERROR')return 'Research needs retry';\n return 'Historical statistic unavailable';\n}",
    `function researchState(r){
 if(!r)return hydrateFailed?'Research needs retry':'Loading historical results';
 if(r.available)return '';
 if(r.code==='COMBO_HISTORY_UNVERIFIED')return 'Combo line only';
 if(r.code==='FANTASY_SCORING_UNVERIFIED')return 'Fantasy line only';
 if(r.code==='HISTORICAL_SOURCE_UNVERIFIED'||r.code==='UNSUPPORTED_MARKET')return 'Line only';
 if(r.code==='STAT_NOT_AVAILABLE')return 'Stat not reported';
 if(r.code==='PLAYER_NOT_FOUND'||r.code==='PLAYER_TEAM_MISMATCH')return 'Player match unavailable';
 if(r.code==='NO_GAME_LOG_DATA')return 'No logs available';
 if(r.retryable||r.code==='RESEARCH_PROVIDER_ERROR')return 'Research needs retry';
 return 'Historical statistic unavailable';
}`,
    'research state labels',
  );

  out = replaceOnce(
    out,
    "function predictionStrip(g,line){\n var key=projectionKey(g,line), entry=projectionFor(g,line);",
    "function predictionStrip(g,line){\n var research=researchFor(g,line),lineOnly=lineOnlyPolicy(g)||(research?.lineOnly?research:null);if(lineOnly)return '<div class=\"asPredict\"><span class=\"asPredictNote\">'+esc(lineOnly.message||'Live line only. A verified historical model input is not available for this market.')+'</span></div>';\n var key=projectionKey(g,line), entry=projectionFor(g,line);",
    'projection strip',
  );

  out = replaceOnce(
    out,
    "function mlTarget(g,line,side){\n var q=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&(bookFilter==='all'||x.sportsbookKey===bookFilter));",
    "function mlTarget(g,line,side){\n var research=researchFor(g,line,side);if(lineOnlyPolicy(g)||research?.lineOnly)return null;\n var q=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&(bookFilter==='all'||x.sportsbookKey===bookFilter));",
    'ML target',
  );

  out = replaceOnce(
    out,
    "!base.available?'<p class=\"asAvailability\">'+esc(researchAvailability(base))+'</p><button class=\"asBtn\" id=\"asRetryResearch\">Retry research</button>':'')",
    "!base.available?'<p class=\"asAvailability\">'+esc(researchAvailability(base))+'</p>'+(base.lineOnly?'':'<button class=\"asBtn\" id=\"asRetryResearch\">Retry research</button>'):'')",
    'drawer retry control',
  );

  out = replaceOnce(
    out,
    "Statistics use verified historical results only. N/A means no verified sample for that split; it is not zero.",
    "Statistics use verified historical results only. N/A means no verified sample for that split; it is not zero. Combo, fantasy-formula and unverified-source markets are labeled line-only instead of being presented as failed research.",
    'coverage note',
  );

  out = replaceOnce(
    out,
    "load();setInterval(function(){if(!document.hidden&&!drawerState&&!loading)load();},90000);",
    "load();setInterval(function(){if(!document.hidden&&!drawerState&&!loading)load();},30000);",
    'automatic board refresh interval',
  );

  return out;
}
