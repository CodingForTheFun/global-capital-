function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Fantasy/H2H UI patch could not locate ${label}.`);
  return source.replace(from, to);
}

export function patchFantasyH2HUi(source) {
  let out = String(source || '');

  // Fantasy settlement is platform-specific. Prefix only the research request
  // with the exact book that owns the selected threshold; the board's canonical
  // market id and grouping remain untouched.
  out = replaceOnce(
    out,
    "function researchParams(g,line,side){var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:g.marketId||'',line:String(line==null?'':line),side:side||defaultSide(g),games:'40',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||''});return q.toString();}",
    `function researchMarketKey(g,line,side){
 var id=g.marketId||'',label=String(g.market||'')+' '+id;
 if(!/\\bfantasy(?:\\s+(?:score|points?))?\\b/i.test(label))return id;
 var valueLine=num(line==null?boardLine(g):line),valueSide=side||defaultSide(g);
 var candidates=sideRows(g,valueSide).filter(r=>num(r.line)===valueLine&&(bookFilter==='all'||r.sportsbookKey===bookFilter));
 var quote=candidates.find(r=>r.sportsbookKey==='prizepicks')||candidates[0]||null;
 if(id.indexOf(':')>0)return id;
 return quote&&quote.sportsbookKey?quote.sportsbookKey+':'+id:id;
}
function researchParams(g,line,side){var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:researchMarketKey(g,line,side)||'',line:String(line==null?'':line),side:side||defaultSide(g),games:'40',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||''});return q.toString();}`,
    'research market source',
  );

  out = replaceOnce(
    out,
    "providerPlayerId:g.providerPlayerId||'',line:line,side:side,team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',games:40};",
    "providerPlayerId:g.providerPlayerId||'',line:line,side:side,team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',marketId:researchMarketKey(g,line,side)||'',games:40};",
    'batch fantasy source',
  ).replace("market:g.market,marketId:g.marketId||'',\n     providerPlayerId", "market:g.market,\n     providerPlayerId");

  // The base patch deliberately blocks all fantasy history. Open only the exact
  // PrizePicks formulas that the server can reconstruct without guessing.
  out = replaceOnce(
    out,
    "if(/\\bfantasy(?:\\s+(?:score|points?))?\\b/i.test(market+' '+marketId))return {ok:true,available:false,lineOnly:true,retryable:false,code:'FANTASY_SCORING_UNVERIFIED',message:'Live fantasy line available. Trend data is not available for this scoring market yet.'};",
    "if(/\\bfantasy(?:\\s+(?:score|points?))?\\b/i.test(market+' '+marketId)){var pp=(g.rows||[]).some(r=>r.sportsbookKey==='prizepicks');var exact=pp&&(selectedSport==='NBA'&&/^(?:prizepicks:)?player_fantasy_(?:score|points)$/.test(marketId)||selectedSport==='MLB'&&(/(?:^|:)player_hitter_fantasy_score$/.test(marketId)||/(?:^|:)player_pitcher_fantasy_score$/.test(marketId)||/^(?:Hitter|Pitcher) Fantasy (?:Score|Points)$/i.test(market)));if(!exact)return {ok:true,available:false,lineOnly:true,retryable:false,code:'FANTASY_SCORING_UNVERIFIED',message:'Live fantasy line available. Trend data is not available for this scoring market yet.'};}",
    'client fantasy gate',
  );

  out = replaceOnce(
    out,
    "if(r.code==='FANTASY_SCORING_UNVERIFIED')return 'Fantasy line available';",
    "if(r.code==='FANTASY_SCORING_UNVERIFIED'||r.code==='FANTASY_COMPONENTS_INCOMPLETE')return 'Fantasy line available';",
    'fantasy research state',
  );

  // H2H is a percentage only when there is at least one verified prior meeting.
  // A true zero-game sample is not 0% and should not look like a measured result.
  // Keep the zero sample visible in the note so customers can distinguish it
  // from a provider/research failure without us inventing matchup history.
  out = replaceOnce(
    out,
    "if(!games)return badge('h2h','H2H','N/A','','no meetings');",
    "if(!games)return badge('h2h','H2H','N/A','','0 prior games');",
    'H2H zero-meeting label',
  );

  return out;
}
