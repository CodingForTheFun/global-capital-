// Keep Best Line Finder grounded in the same normalized offers already shown on
// the prop card. This is presentation-only: no provider calls and no invented
// prices. A single fresh quote may identify a best line; consensus still needs
// at least two distinct books.
const PATCH_CSS = `
#as5 .asBestLineFinder .asAvailability:empty{display:none!important}
#as5 .asBestLineFinder [data-line-finder-value]{font-variant-numeric:tabular-nums!important}
`;

function replaceOnce(source,label,needle,replacement){
 const first=source.indexOf(needle);
 if(first<0)throw new Error(`Best Line Finder patch could not locate ${label}.`);
 if(source.indexOf(needle,first+needle.length)>=0)throw new Error(`Best Line Finder patch found more than one ${label}.`);
 return source.slice(0,first)+replacement+source.slice(first+needle.length);
}

export function patchBestLineFinderUi(source){
 if(typeof source!=='string')throw new TypeError('Best Line Finder patch requires JavaScript source.');
 let output=source;
 const importAnchor="var {compareResearchQuotes}=await import('/assets/lib/ui/line-comparison.mjs');";
 output=replaceOnce(output,'line comparison import',importAnchor,importAnchor+`
;(function(){var s=document.getElementById('as-best-line-finder-style');if(!s){s=document.createElement('style');s.id='as-best-line-finder-style';s.textContent=${JSON.stringify(PATCH_CSS)};(document.head||document.documentElement).appendChild(s);}})();`);
 const anchor='function consensus(g){var byBook=new Map();g.rows.forEach(r=>{if(!byBook.has(r.sportsbookKey))byBook.set(r.sportsbookKey,[]);byBook.get(r.sportsbookKey).push(r.line);});return median(Array.from(byBook.values()).map(median));}';
 const helper=`${anchor}\nfunction bestLineFinderQuotes(g,line,side){
 var now=Date.now(),rows=dedupeOffers((g&&g.comparisonOffers)||g.rows||[]).filter(function(r){
  var at=Date.parse(r.providerUpdatedAt||r.updatedAt||r.ingestedAt||'');
  return ['OVER','UNDER'].includes(r.side)&&num(r.line)!=null&&r.stale!==true&&r.archived!==true&&r.completed!==true&&(!Number.isFinite(at)||now-at<=30*60000);
 });
 var scoped={...g,rows:rows,comparisonOffers:rows};
 var cmp=compareResearchQuotes(scoped,{line:line,side:side||defaultSide(g),now:now});
 function direction(which){var quotes=cmp.offers.filter(function(q){return q.fresh&&q.side===which;});if(!quotes.length)return null;var target=which==='OVER'?Math.min.apply(null,quotes.map(function(q){return q.line;})):Math.max.apply(null,quotes.map(function(q){return q.line;}));var candidates=quotes.filter(function(q){return q.line===target;});return candidates.sort(function(a,b){return num(b.price)-num(a.price);})[0]||null;}
 var over=direction('OVER'),under=direction('UNDER'),selected=num(line),same=cmp.offers.filter(function(q){return q.fresh&&q.side==='OVER'&&q.line===selected&&num(q.price)!=null;});
 same.sort(function(a,b){return num(b.price)-num(a.price);});
 var books=new Set(cmp.offers.filter(function(q){return q.fresh&&(side||defaultSide(g))===q.side;}).map(function(q){return q.bookKey;}));
 return {comparison:cmp,over:over,under:under,bestOverPrice:same[0]||null,consensus:books.size>=2?cmp.consensus:null};
}`;
 output=replaceOnce(output,'line-finder quote helper anchor',anchor,helper);
 // Existing Best Line Finder markup calls compareResearchQuotes directly. Swap
 // only those drawer-time calls to the tolerant helper while preserving the
 // stricter analytics module for EV/arbitrage logic.
 output=output.replace(/compareResearchQuotes\(g,\{line:([^,}]+),side:([^,}]+)(?:,now:[^}]+)?\}\)/g,'bestLineFinderQuotes(g,$1,$2).comparison');
 return output;
}
