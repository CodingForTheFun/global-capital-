function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Auto Scout research UI patch could not locate ${label}.`);
  return source.replace(from, to);
}

export function patchResearchUi(source) {
  let out = String(source || '');

  // MLS, EPL and UCL were three tabs that could never fill: the DFS feeds tag
  // every club competition "SOCCER" - La Liga, Serie A, Liga MX and the
  // Championship alike - and have never once posted those three league names.
  // A visitor clicking any of them got an empty board. One SOCCER tab is where
  // the props have been all along.
  out = replaceOnce(
    out,
    "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL'];",
    "var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','SOCCER','TENNIS','CS','CS2','VAL','LOL','DOTA2','MMA','GOLF','MLS','EPL','UCL','PGA','CFL','FOOTBALL','BASEBALL','BASKETBALL','HOCKEY','AUSSIE_RULES','BADMINTON','BANDY','BEACH_VOLLEYBALL','BOXING','CRICKET','DARTS','ESPORTS','FLOORBALL','FUTSAL','HANDBALL','HORSE_RACING','LACROSSE','MOTORSPORTS','RUGBY','SNOOKER','TABLE_TENNIS','VOLLEYBALL','WATER_POLO'];",
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
    '<span class="asStatus" id="asStatus">Current sportsbook lines</span><button class="asBtn" id="asRefresh">Refresh</button>',
    '<span class="asStatus" id="asStatus">Current sportsbook lines</span><span id="asRefresh" hidden aria-hidden="true"></span>',
    'manual refresh button',
  );

  out = replaceOnce(
    out,
    "var BOARD_VIEWS={research:'Prop Research',players:'Players',popular:'Popular',discrepancies:'Line Discrepancies',saved:'Saved Props'};",
    "var BOARD_VIEWS={research:'Prop Research',players:'Players',popular:'Popular',snipes:'Automatic Snipes',discrepancies:'Line Discrepancies',saved:'Saved Props'};",
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
    "<button data-view=\"snipes\" data-icon=\"trend\" aria-label=\"Automatic snipes\"><span class=\"asNavIcon\" aria-hidden=\"true\">◎</span><span>Snipes</span></button><button data-view=\"discrepancies\" data-icon=\"trend\" aria-label=\"Compare line discrepancies\"><span class=\"asNavIcon\" aria-hidden=\"true\">↗</span><span>Compare</span></button>",
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
    "['stale','⚡ Stale lines',quick.stale],",
    "['stale','🎯 Snipes',quick.stale],",
    'quick snipe filter',
  );

  out = replaceOnce(
    out,
    " if(activeView==='popular')a.sort((x,y)=>books(y).length-books(x).length||x.playerName.localeCompare(y.playerName));\n if(activeView==='discrepancies'){var spreads=new Map(a.map(g=>[g.key,lineSpread(g)]));a=a.filter(g=>spreads.get(g.key)>0);a.sort((x,y)=>spreads.get(y.key)-spreads.get(x.key));}",
    " if(activeView==='popular')a.sort((x,y)=>books(y).length-books(x).length||x.playerName.localeCompare(y.playerName));\n if(activeView==='snipes'){var snipeScores=new Map(a.map(g=>{var s=staleFor(g);return[g.key,s?Math.max(num(s.lineMove)||0,(num(s.edgePoints)||0)/10):0];}));a=a.filter(g=>staleFor(g));a.sort((x,y)=>(snipeScores.get(y.key)||0)-(snipeScores.get(x.key)||0)||x.playerName.localeCompare(y.playerName));}\n if(activeView==='discrepancies'){var spreads=new Map(a.map(g=>[g.key,lineSpread(g)]));a=a.filter(g=>spreads.get(g.key)>0);a.sort((x,y)=>spreads.get(y.key)-spreads.get(x.key));}",
    'automatic snipes view filtering',
  );

  out = replaceOnce(
    out,
    "function staleFor(g){\n if(staleCache.has(g.key))return staleCache.get(g.key);\n var signal=null;\n try{signal=detectStaleLine(g.rows);}catch(e){signal=null;}\n staleCache.set(g.key,signal);\n return signal;\n}\nfunction staleBadge(g){\n var signal=staleFor(g);\n if(!signal)return '';\n return '<div class=\"asStale\"><span class=\"asStaleTag\">⚡ Stale Line</span>'\n  +'<span class=\"asStaleText\">'+esc(staleLineLabel(signal))+'</span></div>';\n}",
    `function staleFor(g){
 if(staleCache.has(g.key))return staleCache.get(g.key);
 var signal=null;
 try{signal=detectSnipe(g.rows);}catch(e){signal=null;}
 staleCache.set(g.key,signal);
 return signal;
}
function staleBadge(g){
 var signal=staleFor(g);
 if(!signal)return '';
 return '<div class="asStale"><span class="asStaleTag">🎯 Snipe</span>'
  +'<span class="asStaleText">'+esc(staleLineLabel(signal))+'</span></div>';
}
function announceSnipes(){
 var current=new Map();
 groups().filter(g=>g.sport===sport).forEach(function(g){var signal=staleFor(g);if(signal)current.set(g.key,signal);});
 if(snipeAlertsPrimedSport!==sport){seenSnipeKeys=new Set(current.keys());snipeAlertsPrimedSport=sport;return;}
 var fresh=[...current.keys()].filter(key=>!seenSnipeKeys.has(key));
 seenSnipeKeys=new Set(current.keys());
 if(!fresh.length)return;
 toast(fresh.length===1?'🎯 New snipe detected':'🎯 '+fresh.length+' new snipes detected');
}`,
    'automatic snipe detector',
  );

  out = replaceOnce(
    out,
    " var viewNote=document.getElementById('asViewNote'),notes={popular:'Sorted by the number of sportsbooks quoting each prop. User pick popularity is unavailable.',discrepancies:'Largest line differences across fresh, verified books on the selected side. Differences are in each market’s own units and are not an EV ranking.'};",
    " var viewNote=document.getElementById('asViewNote'),notes={popular:'Sorted by the number of sportsbooks quoting each prop. User pick popularity is unavailable.',snipes:'Automatic live line opportunities. Auto Scout scans every refreshed board, ranks bettor-friendlier numbers and removes a snipe when the gap closes.',discrepancies:'Largest line differences across fresh, verified books on the selected side. Differences are in each market’s own units and are not an EV ranking.'};",
    'snipes view explanation',
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
 if(/\\s+\\+\\s+/.test(name)||/\\bcombo\\b/i.test(market))return {ok:true,available:false,lineOnly:true,retryable:false,code:'COMBO_HISTORY_UNVERIFIED',message:'Live combo line available. Trend data is not available for combo props yet.'};
 if(/\\bfantasy(?:\\s+(?:score|points?))?\\b/i.test(market+' '+marketId))return {ok:true,available:false,lineOnly:true,retryable:false,code:'FANTASY_SCORING_UNVERIFIED',message:'Live fantasy line available. Trend data is not available for this scoring market yet.'};
 if(selectedSport==='TENNIS')return {ok:true,available:false,lineOnly:true,retryable:false,code:'HISTORICAL_SOURCE_UNVERIFIED',message:'Live tennis line available. Trend data is not available for this market yet.'};
 return null;
}
function researchFor(g,line,side){
 var lineOnly=lineOnlyPolicy(g);if(lineOnly)return lineOnly;
 var key=researchKey(g,line==null?boardLine(g):line,side||defaultSide(g)), entry=researchCache.get(key);`,
    'research cache entry',
  );

  {
    const oldEntry = "async function getResearch(g,line,side,force){\\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),key=researchKey(g,valueLine,valueSide);";
    const oldPatched = "async function getResearch(g,line,side,force){\\n var lineOnly=lineOnlyPolicy(g);if(lineOnly)return lineOnly;\\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),key=researchKey(g,valueLine,valueSide);";
    const detailEntry = "async function getResearch(g,line,side,force,detail){\\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),isDetail=detail===true,key=researchKey(g,valueLine,valueSide,isDetail);";
    const detailPatched = "async function getResearch(g,line,side,force,detail){\\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),isDetail=detail===true,key=researchKey(g,valueLine,valueSide,isDetail);\\n var lineOnly=lineOnlyPolicy(g);if(lineOnly&&!isDetail)return lineOnly;";
    if (out.includes(detailEntry)) out = out.replace(detailEntry, detailPatched);
    else out = replaceOnce(out, oldEntry, oldPatched, 'research request entry');
  }

  out = replaceOnce(
    out,
    "function researchState(r){\n if(!r)return hydrateFailed?'Research needs retry':'Loading historical results';\n if(r.available)return '';\n if(r.code==='NO_GAME_LOG_DATA')return 'No logs available';\n if(r.retryable||r.code==='RESEARCH_PROVIDER_ERROR')return 'Research needs retry';\n return 'Historical statistic unavailable';\n}",
    `function researchState(r){
 if(!r)return hydrateFailed?'Stats updating':'Loading trends';
 if(r.available)return '';
 if(r.code==='COMBO_HISTORY_UNVERIFIED')return 'Combo line available';
 if(r.code==='FANTASY_SCORING_UNVERIFIED')return 'Fantasy line available';
 if(r.code==='HISTORICAL_SOURCE_UNVERIFIED'||r.code==='UNSUPPORTED_MARKET')return 'Line available';
 if(r.code==='STAT_NOT_AVAILABLE')return 'Trend unavailable';
 if(r.code==='PLAYER_NOT_FOUND'||r.code==='PLAYER_TEAM_MISMATCH')return 'Player trend unavailable';
 if(r.code==='NO_GAME_LOG_DATA')return 'Trend unavailable';
 if(r.retryable||r.code==='RESEARCH_PROVIDER_ERROR')return 'Stats updating';
 return 'Trend unavailable';
}`,
    'research state labels',
  );

  out = replaceOnce(
    out,
    " if((r&&!r.available)||(!r&&hydrateFailed))return '<div class=\"asHistoryGap\" role=\"status\"><b>'+esc(researchState(r))+'</b><span>'+esc(r?.message||'This exact statistic has no verified history. The listed lines are still available.')+'</span></div>';",
    " if((r&&!r.available)||(!r&&hydrateFailed))return '<div class=\"asBadges asBadgesUnavailable\" aria-label=\"Trend data unavailable\">'+['L5','L10','L15','H2H','STRK','AVG','DIFF','SZN'].map(function(label){return '<div class=\"asBadge\"><small>'+label+'</small><b>—</b></div>';}).join('')+'</div>';",
    'customer-safe unavailable badges',
  );

  out = replaceOnce(
    out,
    "function predictionStrip(g,line){\n var key=projectionKey(g,line), entry=projectionFor(g,line);",
    "function predictionStrip(g,line){\n var research=researchFor(g,line),lineOnly=lineOnlyPolicy(g)||(research?.lineOnly?research:null);if(lineOnly)return '<div class=\"asPredict\"><span class=\"asPredictNote\">'+esc(lineOnly.message||'Live line available. Trend data is not available for this market yet.')+'</span></div>';\n var key=projectionKey(g,line), entry=projectionFor(g,line);",
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
    "function researchAvailability(base){if(base?.message)return base.message;var c=String(base?.code||'');if(/UNMAPPED/.test(c))return 'This market does not yet have a supported historical statistic. Current sportsbook lines remain available.';if(/SEASON_ONLY|NO_GAME_LOG/.test(c)||base?.sections?.seasonTotal)return 'Season or player context is available, but completed historical results were not returned. Hit rates require individual game results.';if(/PLAYER.*MATCH|AMBIGUOUS/.test(c))return 'This player could not be uniquely matched to historical statistics. Current sportsbook lines remain available.';return 'Historical research could not be loaded for this player and market. Any supplied player context and sportsbook lines remain available.';}",
    "function researchAvailability(base){var c=String(base?.code||'');if(/SEASON_ONLY|NO_GAME_LOG/.test(c)||base?.sections?.seasonTotal)return 'Recent trend data is not available for this prop yet.';if(/PLAYER.*MATCH|AMBIGUOUS/.test(c))return 'Player trend data is not available for this prop yet.';if(/UNMAPPED|UNSUPPORTED/.test(c)||base?.lineOnly)return 'Trend data is not available for this market yet.';return 'Trend data is updating. Current lines remain available.';}",
    'customer-safe research availability',
  );

  out = replaceOnce(
    out,
    "!base.available?'<p class=\"asAvailability\">'+esc(researchAvailability(base))+'</p><button class=\"asBtn\" id=\"asRetryResearch\">Retry research</button>':'')",
    "!base.available?'<p class=\"asAvailability\">'+esc(researchAvailability(base))+'</p>'+(base.lineOnly?'':'<button class=\"asBtn\" id=\"asRetryResearch\">Refresh stats</button>'):'')",
    'drawer retry control',
  );

  out = replaceOnce(
    out,
    "Statistics use verified historical results only. N/A means no verified sample for that split; it is not zero.",
    "Trend stats are shown when source data is available. A dash means that split is unavailable right now.",
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
