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

  return out;
}
