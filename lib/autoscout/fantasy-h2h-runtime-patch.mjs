function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Fantasy/H2H UI patch could not locate ${label}.`);
  return source.replace(from, to);
}

export function patchFantasyH2HUi(source) {
  let out = String(source || '');

  // Fantasy settlement is platform-specific. Prefix only the research request
  // with the exact book that owns the selected threshold; the board's canonical
  // market id and grouping remain untouched.
  {
    const helper = `function researchMarketKey(g,line,side){
 var id=g.marketId||'',label=String(g.market||'')+' '+id;
 if(!/\\bfantasy(?:\\s+(?:score|points?))?\\b/i.test(label))return id;
 var valueLine=num(line==null?boardLine(g):line),valueSide=side||defaultSide(g);
 var selected=typeof propBookFor==='function'?propBookFor(g):null;
 var candidates=sideRows(g,valueSide).filter(r=>num(r.line)===valueLine&&(!selected||r.sportsbookKey===selected));
 var quote=candidates.find(r=>r.sportsbookKey==='prizepicks')||candidates[0]||null;
 if(id.indexOf(':')>0){if(!selected||id.split(':')[0]===selected)return id;id=id.slice(id.indexOf(':')+1);}
 return quote&&quote.sportsbookKey?quote.sportsbookKey+':'+id:id;
}
`;
    const oldSource = "function researchParams(g,line,side){var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:g.marketId||'',line:String(line==null?'':line),side:side||defaultSide(g),games:'40',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||''});return q.toString();}";
    const oldTarget = helper + "function researchParams(g,line,side){var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:researchMarketKey(g,line,side)||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'',position:g.position||'',line:String(line==null?'':line),side:side||defaultSide(g),games:'40',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||''});return q.toString();}";
    const detailSource = "function researchParams(g,line,side,detail){\n var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:g.marketId||'',line:String(line==null?'':line),side:side||defaultSide(g),games:detail?'100':'40',historyYears:detail?'5':'1',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||'',opponent:g.opponent||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'game'});\n if(detail)q.set('detail','1');\n return q.toString();\n}";
    const detailTarget = helper + "function researchParams(g,line,side,detail){\n var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:researchMarketKey(g,line,side)||'',line:String(line==null?'':line),side:side||defaultSide(g),games:detail?'100':'40',historyYears:detail?'5':'1',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||'',opponent:g.opponent||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'game',position:g.position||''});\n if(detail)q.set('detail','1');\n return q.toString();\n}";
    if (out.includes(detailSource)) out = out.replace(detailSource, detailTarget);
    else out = replaceOnce(out, oldSource, oldTarget, 'research market source');
  }

  {
    const oldBatch = "providerPlayerId:g.providerPlayerId||'',line:line,side:side,team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',games:40};";
    const oldBatchPatched = "providerPlayerId:g.providerPlayerId||'',line:line,side:side,team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',marketId:researchMarketKey(g,line,side)||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'',position:g.position||'',games:40};";
    const detailBatch = "providerPlayerId:g.providerPlayerId||'',line:line,side:side,team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',opponent:g.opponent||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'game',games:40};";
    const detailBatchPatched = "providerPlayerId:g.providerPlayerId||'',line:line,side:side,team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',opponent:g.opponent||'',eventId:g.eventId||'',gameStartTime:g.gameStartTime||'',period:g.period||'game',position:g.position||'',marketId:researchMarketKey(g,line,side)||'',games:40};";
    if (out.includes(detailBatch)) {
      out = out.replace(detailBatch, detailBatchPatched)
        .replace("market:g.market,marketId:g.marketId||'',\n     providerPlayerId", "market:g.market,\n     providerPlayerId");
    } else {
      out = replaceOnce(out, oldBatch, oldBatchPatched, 'batch fantasy source')
        .replace("market:g.market,marketId:g.marketId||'',\n     providerPlayerId", "market:g.market,\n     providerPlayerId");
    }
  }

  {
    const oldKey = "function researchKey(g,line,side){return [g.key,g.team,g.homeTeam,g.awayTeam,num(line),side||'OVER'].join('|');}";
    const oldKeyPatched = "function researchKey(g,line,side){return [g.key,g.team,g.homeTeam,g.awayTeam,num(line),side||'OVER',researchMarketKey(g,line,side),g.eventId||'',g.gameStartTime||'',g.period||''].join('|');}";
    const detailKey = "function researchKey(g,line,side,detail){return [g.key,g.period||'game',g.team,g.homeTeam,g.awayTeam,num(line),side||'OVER',detail?'detail':'board'].join('|');}";
    const detailKeyPatched = "function researchKey(g,line,side,detail){return [g.key,g.period||'game',g.team,g.homeTeam,g.awayTeam,num(line),side||'OVER',detail?'detail':'board',researchMarketKey(g,line,side),g.eventId||'',g.gameStartTime||''].join('|');}";
    if (out.includes(detailKey)) out = out.replace(detailKey, detailKeyPatched);
    else out = replaceOnce(out, oldKey, oldKeyPatched, 'platform-aware research cache');
  }
  // The generic base cache has no book or cutoff identity; fantasy must only
  // reuse its fully qualified key. Capture queued parameters before selection changes.
  out = replaceOnce(out, "var base=researchCache.get('base|'+g.key);",
    "var base=/fantasy/i.test(String(g.market)+' '+g.marketId)?null:researchCache.get('base|'+g.key);", 'fantasy base cache');
  {
    const oldQueue = "({g,line:valueLine,side:valueSide,key,resolve});";
    const oldQueuePatched = "({g,line:valueLine,side:valueSide,key,query:researchParams(g,valueLine,valueSide),resolve});";
    const detailQueue = "({g,line:valueLine,side:valueSide,key,detail:isDetail,resolve});";
    const detailQueuePatched = "({g,line:valueLine,side:valueSide,key,detail:isDetail,query:researchParams(g,valueLine,valueSide,isDetail),resolve});";
    if (out.includes(detailQueue)) out = out.replace(detailQueue, detailQueuePatched);
    else out = replaceOnce(out, oldQueue, oldQueuePatched, 'queued platform snapshot');

    if (out.includes("researchParams(job.g,job.line,job.side,job.detail)")) {
      out = out.replace("researchParams(job.g,job.line,job.side,job.detail)", "job.query");
    } else {
      out = replaceOnce(out, "researchParams(job.g,job.line,job.side)", "job.query", 'queued platform request');
    }
  }
  out = replaceOnce(out, "if(selectedSport==='TENNIS')return",
    "if(selectedSport==='TENNIS'&&!/fantasy/i.test(market+' '+marketId))return", 'tennis fantasy gate');

  // Let the shared server verify exact formulas or platform settlements for
  // every sport. A browser league allowlist would hide valid server results.
  out = replaceOnce(
    out,
    "if(/\\bfantasy(?:\\s+(?:score|points?))?\\b/i.test(market+' '+marketId))return {ok:true,available:false,lineOnly:true,retryable:false,code:'FANTASY_SCORING_UNVERIFIED',message:'Live fantasy line available. Trend data is not available for this scoring market yet.'};",
    "/* Fantasy history is resolved by the server against exact platform evidence. */",
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
