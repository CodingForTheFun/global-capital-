function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Oblige Props research-tabs patch could not locate ${label}.`);
  return source.replace(from, to);
}

export function patchResearchTabsUi(source) {
  let out = String(source || '');

  out = replaceOnce(
    out,
    "var BOARD_VIEWS={research:'Prop Research',players:'Players',popular:'Popular',snipes:'Automatic Snipes',discrepancies:'Line Discrepancies',saved:'Saved Props'};",
    "var BOARD_VIEWS={research:'Prop Research',players:'Player Index',popular:'Hot Trends',snipes:'Best Lines',discrepancies:'Book Compare',saved:'Saved Props'};",
    'board view titles',
  );

  out = replaceOnce(
    out,
    '<button data-view="popular" data-icon="popular"><span class="asNavIcon" aria-hidden="true">▲</span><span>Popular</span></button>',
    '<button type="button" class="asNavScores" aria-label="Live sports scores"><span class="asNavIcon" aria-hidden="true">●</span><span>Scores</span></button>',
    'scores navigation',
  );

  out = replaceOnce(
    out,
    '<button data-view="snipes" data-icon="trend" aria-label="Automatic snipes"><span class="asNavIcon" aria-hidden="true">◎</span><span>Snipes</span></button>',
    '<button data-view="snipes" data-icon="trend" aria-label="Best live lines"><span class="asNavIcon" aria-hidden="true">◎</span><span>Best Lines</span></button>',
    'best-lines navigation',
  );

  out = replaceOnce(
    out,
    '<button data-view="discrepancies" data-icon="trend" aria-label="Compare line discrepancies"><span class="asNavIcon" aria-hidden="true">↗</span><span>Compare</span></button>',
    '<button data-view="discrepancies" data-icon="trend" aria-label="Compare sportsbook quotes"><span class="asNavIcon" aria-hidden="true">↗</span><span>Compare</span></button>',
    'compare navigation',
  );

  out = replaceOnce(
    out,
    ` if(activeView==='players')a.sort((x,y)=>x.playerName.localeCompare(y.playerName)||x.market.localeCompare(y.market));
 if(activeView==='popular')a.sort((x,y)=>books(y).length-books(x).length||x.playerName.localeCompare(y.playerName));
 if(activeView==='snipes'){var snipeScores=new Map(a.map(g=>{var s=staleFor(g);return[g.key,s?Math.max(num(s.lineMove)||0,(num(s.edgePoints)||0)/10):0];}));a=a.filter(g=>staleFor(g));a.sort((x,y)=>(snipeScores.get(y.key)||0)-(snipeScores.get(x.key)||0)||x.playerName.localeCompare(y.playerName));}
 if(activeView==='discrepancies'){var spreads=new Map(a.map(g=>[g.key,lineSpread(g)]));a=a.filter(g=>spreads.get(g.key)>0);a.sort((x,y)=>spreads.get(y.key)-spreads.get(x.key));}`,
    ` if(activeView==='players')a.sort((x,y)=>x.playerName.localeCompare(y.playerName)||x.market.localeCompare(y.market));
 if(activeView==='popular')a.sort((x,y)=>{var xr=researchFor(x),yr=researchFor(y),xw=xr?.windows?.l5,yw=yr?.windows?.l5,xr5=num(xw?.hitRate),yr5=num(yw?.hitRate),xg=num(xw?.games)||0,yg=num(yw?.games)||0;if(xr5!=null||yr5!=null){if(xr5==null)return 1;if(yr5==null)return -1;return yr5-xr5||yg-xg||books(y).length-books(x).length||x.playerName.localeCompare(y.playerName);}return books(y).length-books(x).length||x.playerName.localeCompare(y.playerName);});
 if(activeView==='snipes'){var snipeScores=new Map(a.map(g=>{var s=staleFor(g);return[g.key,s?Math.max(num(s.lineMove)||0,(num(s.edgePoints)||0)/10):0];})),bestLineSpreads=new Map(a.map(g=>[g.key,num(lineSpread(g))||0]));a.sort((x,y)=>Number(Boolean(staleFor(y)))-Number(Boolean(staleFor(x)))||(snipeScores.get(y.key)||0)-(snipeScores.get(x.key)||0)||(bestLineSpreads.get(y.key)||0)-(bestLineSpreads.get(x.key)||0)||books(y).length-books(x).length||x.playerName.localeCompare(y.playerName));}
 if(activeView==='discrepancies'){var compareSpreads=new Map(a.map(g=>[g.key,num(lineSpread(g))||0])),multiBook=a.filter(g=>books(g).length>1);if(multiBook.length)a=multiBook;a.sort((x,y)=>books(y).length-books(x).length||(compareSpreads.get(y.key)||0)-(compareSpreads.get(x.key)||0)||x.playerName.localeCompare(y.playerName));}`,
    'research view ranking',
  );

  out = replaceOnce(
    out,
    " var viewNote=document.getElementById('asViewNote'),notes={popular:'Sorted by the number of sportsbooks quoting each prop. User pick popularity is unavailable.',snipes:'Automatic live line opportunities. Auto Scout scans every refreshed board, ranks bettor-friendlier numbers and removes a snipe when the gap closes.',discrepancies:'Largest line differences across fresh, verified books on the selected side. Differences are in each market’s own units and are not an EV ranking.'};",
    " var viewNote=document.getElementById('asViewNote'),notes={players:'Every player with a live line, A to Z.',popular:'Hottest recent form first, by last-5 hit rate.',snipes:'Where one book is offering a better number than the rest.',discrepancies:'The same prop, side by side at every book quoting it.'};",
    'research view explanations',
  );

  return out;
}
