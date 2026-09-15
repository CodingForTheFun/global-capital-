const PICKER_CSS = `
#as5 .asPropBookStrip{display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:wrap!important;padding:11px 13px!important;border-top:1px solid rgba(55,91,133,.35)!important;background:rgba(2,9,20,.58)!important;overflow:visible!important}
#as5 .asPropBookPicker{position:relative!important;display:flex!important;align-items:center!important;min-width:220px!important;max-width:310px!important;height:46px!important;padding:0 13px!important;border:1px solid rgba(77,118,166,.52)!important;border-radius:15px!important;background:linear-gradient(180deg,rgba(12,28,49,.98),rgba(6,17,33,.98))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)!important}
#as5 .asPropBookPicker:after{content:"⌄";position:absolute;right:12px;top:50%;transform:translateY(-55%);pointer-events:none;color:#90a8c6;font-size:17px;font-weight:900}
#as5 .asPropBookSelect{appearance:none!important;-webkit-appearance:none!important;width:100%!important;height:100%!important;padding:0 30px 0 0!important;border:0!important;outline:0!important;background:transparent!important;color:#f4f8ff!important;font-size:14px!important;font-weight:900!important;letter-spacing:-.01em!important;cursor:pointer!important}
#as5 .asPropBookSelect:focus-visible{outline:2px solid #3f8cff!important;outline-offset:4px!important;border-radius:8px!important}
#as5 .asPropBookValues{display:flex!important;align-items:center!important;gap:12px!important;min-height:46px!important;padding:0 2px!important;font-variant-numeric:tabular-nums!important}
#as5 .asPropBookQuote{display:flex!important;align-items:baseline!important;gap:5px!important;white-space:nowrap!important;font-style:normal!important}
#as5 .asPropBookQuote b{font-size:15px!important;font-weight:950!important}
#as5 .asPropBookQuote em{font-size:12px!important;font-style:normal!important;font-weight:850!important;color:#8093ac!important}
#as5 .asPropBookQuote.o b{color:#70e7bd!important}
#as5 .asPropBookQuote.u b{color:#ff8793!important}
#as5 .asPropBookMeta{margin-left:auto!important;color:#7288a3!important;font-size:10px!important;font-weight:750!important;white-space:nowrap!important}
@media(max-width:700px){
 #as5 .asPropBookStrip{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:8px 10px!important;padding:9px 11px 11px!important}
 #as5 .asPropBookPicker{min-width:0!important;max-width:none!important;width:100%!important;height:44px!important;border-radius:14px!important}
 #as5 .asPropBookSelect{font-size:13px!important}
 #as5 .asPropBookValues{min-height:44px!important;gap:9px!important}
 #as5 .asPropBookQuote b{font-size:13px!important}
 #as5 .asPropBookQuote em{font-size:10px!important}
 #as5 .asPropBookMeta{grid-column:1/-1!important;margin-left:0!important;font-size:9px!important}
}
@media(max-width:360px){
 #as5 .asPropBookStrip{grid-template-columns:1fr!important}
 #as5 .asPropBookValues{justify-content:space-between!important}
 #as5 .asPropBookMeta{grid-column:auto!important}
}
`;

function replaceOnce(source, label, needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Prop sportsbook selector patch could not locate ${label}.`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Prop sportsbook selector patch found more than one ${label}.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function replaceBlock(source, label, startNeedle, endNeedle, replacement) {
  const start = source.indexOf(startNeedle);
  if (start < 0) throw new Error(`Prop sportsbook selector patch could not locate ${label} start.`);
  if (source.indexOf(startNeedle, start + startNeedle.length) >= 0) {
    throw new Error(`Prop sportsbook selector patch found more than one ${label} start.`);
  }
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`Prop sportsbook selector patch could not locate ${label} end.`);
  return source.slice(0, start) + replacement + source.slice(end);
}

export function patchPropBookSelectorUi(source) {
  if (typeof source !== 'string') throw new TypeError('Prop sportsbook selector patch requires JavaScript source.');

  const stateAnchor = 'var playerChoices=new Map();';
  const stateReplacement = `var playerChoices=new Map();\nvar propBookChoices=new Map();\nfunction propBookFor(g){\n var wanted=g&&propBookChoices.get(g.key);if(!wanted||!g||!Array.isArray(g.rows))return null;\n var target=bookId(wanted);\n return g.rows.some(function(row){return bookId(row.sportsbookKey||row.sportsbook)===target;})?target:null;\n}\nfunction rowMatchesPropBook(g,row){var selected=propBookFor(g);return !selected||bookId(row.sportsbookKey||row.sportsbook)===selected;}\n;(function(){var s=document.getElementById('as-prop-book-selector-style');if(!s){s=document.createElement('style');s.id='as-prop-book-selector-style';s.textContent=${JSON.stringify(PICKER_CSS)};(document.head||document.documentElement).appendChild(s);}})();`;
  let output = replaceOnce(source, 'player-choice state', stateAnchor, stateReplacement);

  output = replaceOnce(
    output,
    'best-price function',
    "function bestPrice(g,side,line,allBooks=false){var selected=num(line==null?boardLine(g):line);return sideRows(g,side).filter(r=>num(r.price)!=null&&num(r.line)===selected&&(allBooks||bookFilter==='all'||r.sportsbookKey===bookFilter)).sort((a,b)=>num(b.price)-num(a.price))[0]||null;}",
    "function bestPrice(g,side,line,allBooks=false){var selected=num(line==null?boardLine(g):line);return sideRows(g,side).filter(r=>num(r.price)!=null&&num(r.line)===selected&&(allBooks||rowMatchesPropBook(g,r))).sort((a,b)=>num(b.price)-num(a.price))[0]||null;}",
  );

  output = replaceOnce(
    output,
    'board-line function',
    "function boardLine(g){var side=defaultSide(g),rows=sideRows(g,side).filter(r=>num(r.line)!=null&&(bookFilter==='all'||r.sportsbookKey===bookFilter));if(!rows.length)return null;return rows.reduce((best,row)=>side==='UNDER'?Math.max(best,num(row.line)):Math.min(best,num(row.line)),num(rows[0].line));}",
    "function boardLine(g){var side=defaultSide(g),rows=sideRows(g,side).filter(r=>num(r.line)!=null&&rowMatchesPropBook(g,r));if(!rows.length)return null;return rows.reduce((best,row)=>side==='UNDER'?Math.max(best,num(row.line)):Math.min(best,num(row.line)),num(rows[0].line));}",
  );

  output = replaceOnce(
    output,
    'default-side function',
    "function defaultSide(g){return sideFilter!=='all'?sideFilter:sideRows(g,'OVER').length?'OVER':'UNDER';}",
    "function defaultSide(g){if(sideFilter!=='all')return sideFilter;var rows=g.rows.filter(function(r){return rowMatchesPropBook(g,r);});return rows.some(function(r){return r.side==='OVER';})?'OVER':'UNDER';}",
  );

  output = replaceOnce(
    output,
    'ML target book scope',
    "var q=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&(bookFilter==='all'||x.sportsbookKey===bookFilter));",
    "var q=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&rowMatchesPropBook(g,x));",
  );

  output = replaceOnce(
    output,
    'card quote book scope',
    "var quote=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&(bookFilter==='all'||x.sportsbookKey===bookFilter));",
    "var quote=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&rowMatchesPropBook(g,x));",
  );

  const oddsStrip = `function oddsStrip(g){\n var map=new Map();\n g.rows.forEach(function(r){\n  var key=bookId(r.sportsbookKey||r.sportsbook);if(!key)return;\n  if(!map.has(key))map.set(key,{key:key,name:r.sportsbook||bookInfo(key).name||key,rows:[]});\n  map.get(key).rows.push(r);\n });\n var choices=Array.from(map.values()).sort(function(a,b){return String(a.name).localeCompare(String(b.name));});\n if(!choices.length)return '';\n function currentSide(item,side){\n  var rows=(item&&item.rows||[]).filter(function(r){return r.side===side&&num(r.line)!=null;});if(!rows.length)return null;\n  var latest=Math.max.apply(null,rows.map(function(r){var t=Date.parse(r.providerUpdatedAt||r.updatedAt||r.ingestedAt||'');return Number.isFinite(t)?t:0;}));\n  var current=rows.filter(function(r){var t=Date.parse(r.providerUpdatedAt||r.updatedAt||r.ingestedAt||'');return (Number.isFinite(t)?t:0)===latest;});\n  var signatures=new Set(current.map(function(r){return JSON.stringify([num(r.line),num(r.price)]);}));\n  return signatures.size===1?current[0]:null;\n }\n var selected=propBookFor(g)||'',active=selected?map.get(selected):null;\n var over=active?currentSide(active,'OVER'):bestLine(g,'OVER');\n var under=active?currentSide(active,'UNDER'):bestLine(g,'UNDER');\n var options='<option value="">All books · best line</option>'+choices.map(function(item){return '<option value="'+esc(item.key)+'" '+(item.key===selected?'selected':'')+'>'+esc(item.name)+'</option>';}).join('');\n function quote(row,side){var line=row&&num(row.line)!=null?dec(row.line):'—',price=row&&num(row.price)!=null?money(row.price):'—';return '<span class="asPropBookQuote '+side.toLowerCase()+'"><b>'+side.charAt(0)+' '+esc(line)+'</b><em>'+esc(price)+'</em></span>';}\n return '<div class="asOddsStrip asPropBookStrip" aria-label="Sportsbook lines">'\n  +'<label class="asPropBookPicker"><span class="asSrOnly">Sportsbook for '+esc(g.playerName+' '+g.market)+'</span><select class="asPropBookSelect" data-prop-book="'+esc(g.key)+'" aria-label="Choose sportsbook for '+esc(g.playerName+' '+g.market)+'">'+options+'</select></label>'\n  +'<div class="asPropBookValues">'+quote(over,'OVER')+quote(under,'UNDER')+'</div>'\n  +'<small class="asPropBookMeta">'+esc(selected?'Selected sportsbook':choices.length+' live book'+(choices.length===1?'':'s')+' · tap to choose')+'</small>'\n  +'</div>';\n}\n`;
  output = replaceBlock(
    output,
    'sportsbook strip',
    'function oddsStrip(g){',
    '// Sharp fair value for a DFS leg.',
    oddsStrip,
  );

  const bindAnchor = "document.querySelectorAll('[data-card-choice]').forEach(select=>{select.onclick=e=>e.stopPropagation();select.onkeydown=e=>e.stopPropagation();select.onchange=e=>{e.stopPropagation();playerChoices.set(select.dataset.cardChoice,select.value);renderListLight();};});";
  const bindReplacement = bindAnchor + "\n document.querySelectorAll('[data-prop-book]').forEach(select=>{select.onclick=e=>e.stopPropagation();select.onkeydown=e=>e.stopPropagation();select.onchange=e=>{e.stopPropagation();var key=select.dataset.propBook;if(select.value)propBookChoices.set(key,bookId(select.value));else propBookChoices.delete(key);staleCache.delete(key);renderListLight();};});";
  output = replaceOnce(output, 'card selector bindings', bindAnchor, bindReplacement);

  return output;
}
