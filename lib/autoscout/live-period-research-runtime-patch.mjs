function replaceOnce(source, from, to, label) {
  const count = String(source || '').split(from).length - 1;
  if (count !== 1) throw new Error(`Live period research patch expected one ${label} anchor; found ${count}.`);
  return source.replace(from, to);
}

export function patchLivePeriodResearchUi(source) {
  let out = String(source || '');

  out = replaceOnce(
    out,
    "function groupKey(r){return [r.sport,r.eventId,r.playerId||r.playerName,r.marketId||r.market].join('|');}",
    `function canonicalPeriod(value,market){
 var explicit=String(value||'').trim(),label=String(market||'').trim().toLowerCase();
 if(!explicit){
  var compact=label.match(/\\b([1-9])\\s*(q|h|p|i|s)\\b/i);if(compact)return compact[1]+compact[2].toLowerCase();
  var named=[[/\\b(?:first|1st)\\s+quarter\\b/i,'1q'],[/\\b(?:second|2nd)\\s+quarter\\b/i,'2q'],[/\\b(?:third|3rd)\\s+quarter\\b/i,'3q'],[/\\b(?:fourth|4th)\\s+quarter\\b/i,'4q'],[/\\b(?:first|1st)\\s+half\\b/i,'1h'],[/\\b(?:second|2nd)\\s+half\\b/i,'2h'],[/\\b(?:first|1st)\\s+period\\b/i,'1p'],[/\\b(?:second|2nd)\\s+period\\b/i,'2p'],[/\\b(?:third|3rd)\\s+period\\b/i,'3p'],[/\\b(?:first|1st)\\s+inning\\b/i,'1i'],[/\\b(?:first|1st)\\s+set\\b/i,'1s'],[/\\b(?:second|2nd)\\s+set\\b/i,'2s'],[/\\b(?:third|3rd)\\s+set\\b/i,'3s'],[/\\b(?:fourth|4th)\\s+set\\b/i,'4s'],[/\\b(?:fifth|5th)\\s+set\\b/i,'5s']];
  for(var pair of named)if(pair[0].test(label))return pair[1];
  return 'game';
 }
 var raw=explicit.toLowerCase().replace(/[\\s_-]+/g,'');
 if(['game','full','fullgame','match','singlestat'].includes(raw))return'game';
 var direct=raw.match(/^([1-9])([qhpis])$/);if(direct)return direct[1]+direct[2];
 var reversed=raw.match(/^([qhpis])([1-9])$/);if(reversed)return reversed[2]+reversed[1];
 var firstN=raw.match(/^f([357])$/);if(firstN)return'1ix'+firstN[1];
 return raw;
}
function groupKey(r){var base=[r.sport,r.eventId,r.playerId||r.playerName,r.marketId||r.market].join('|'),period=canonicalPeriod(r.period,r.market);return period==='game'?base:base+'|'+period;}`,
    'group key',
  );

  out = replaceOnce(
    out,
    "marketId:r.marketId,market:r.market,homeTeam:r.homeTeam,awayTeam:r.awayTeam",
    "marketId:r.marketId,market:r.market,period:canonicalPeriod(r.period,r.market),opponent:r.opponent||p.opponent||'',homeTeam:r.homeTeam,awayTeam:r.awayTeam",
    'group period context',
  );

  out = replaceOnce(
    out,
    "function researchKey(g,line,side){return [g.key,g.team,g.homeTeam,g.awayTeam,num(line),side||'OVER',researchMarketKey(g,line,side),g.eventId||'',g.gameStartTime||'',g.period||''].join('|');}",
    "function researchKey(g,line,side,detail){return [g.key,g.period||'game',g.team,g.homeTeam,g.awayTeam,num(line),side||'OVER',researchMarketKey(g,line,side),g.eventId||'',g.gameStartTime||'',detail?'detail':'board'].join('|');}",
    'research cache key',
  );

  out = replaceOnce(
    out,
    "function researchParams(g,line,side){var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:researchMarketKey(g,line,side)||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'',position:g.position||'',line:String(line==null?'':line),side:side||defaultSide(g),games:'40',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||''});return q.toString();}",
    "function researchParams(g,line,side,detail){var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:researchMarketKey(g,line,side)||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'game',position:g.position||'',opponent:g.opponent||'',line:String(line==null?'':line),side:side||defaultSide(g),games:detail?'100':'40',historyYears:detail?'5':'1',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||''});if(detail)q.set('detail','1');return q.toString();}",
    'research query',
  );

  out = replaceOnce(
    out,
    "async function getResearch(g,line,side,force){\n var lineOnly=lineOnlyPolicy(g);if(lineOnly)return lineOnly;\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),key=researchKey(g,valueLine,valueSide);",
    "async function getResearch(g,line,side,force,detail){\n var lineOnly=lineOnlyPolicy(g);if(lineOnly)return lineOnly;\n var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),isDetail=detail===true,key=researchKey(g,valueLine,valueSide,isDetail);",
    'detail research entry',
  );

  out = replaceOnce(
    out,
    " if(!force){var cached=researchFor(g,valueLine,valueSide);if(cached)return cached;}",
    " if(!force){if(isDetail){var direct=researchCache.get(key);if(direct&&direct.expires>Date.now())return direct.value;}else{var cached=researchFor(g,valueLine,valueSide);if(cached)return cached;}}",
    'detail cache bypass',
  );

  out = replaceOnce(
    out,
    "researchQueue[drawerState?.g.key===g.key?'unshift':'push']({g,line:valueLine,side:valueSide,key,query:researchParams(g,valueLine,valueSide),resolve});",
    "researchQueue[isDetail?'unshift':'push']({g,line:valueLine,side:valueSide,key,detail:isDetail,query:researchParams(g,valueLine,valueSide,isDetail),resolve});",
    'detail queue snapshot',
  );

  out = replaceOnce(
    out,
    "awayTeam:g.awayTeam||'',marketId:researchMarketKey(g,line,side)||''",
    "awayTeam:g.awayTeam||'',opponent:g.opponent||'',marketId:researchMarketKey(g,line,side)||''",
    'batch opponent context',
  );

  out = replaceOnce(
    out,
    "getResearch(g,drawerState.line,drawerState.side,false).then(r=>{if(!drawerState||drawerState.g.key!==g.key)return;drawerState.base=r;renderDrawer();});",
    "getResearch(g,drawerState.line,drawerState.side,false,true).then(r=>{if(!drawerState||drawerState.g.key!==g.key)return;drawerState.base=r;renderDrawer();});",
    'drawer detail lookup',
  );

  out = replaceOnce(
    out,
    "var result=await getResearch(g,line,side,true);if(drawerState?.g.key===g.key){drawerState.base=result;renderDrawer();}",
    "var result=await getResearch(g,line,side,true,true);if(drawerState?.g.key===g.key){drawerState.base=result;renderDrawer();}",
    'drawer detail retry',
  );

  return out;
}
