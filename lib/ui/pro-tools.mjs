const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=v=>(Math.abs(v)<.00005?0:v).toFixed(2)+'%';
const signed=v=>(v>0?'+':'')+percent(v);
const quote=q=>'<b>'+esc(q.sportsbook||q.sportsbookKey)+'</b> · '+esc(q.side)+' '+esc(q.line)+' · '+esc(q.price>0?'+'+q.price:q.price);
const observed=q=>'<time datetime="'+esc(new Date(q.at).toISOString())+'">'+esc(new Date(q.at).toLocaleString())+'</time>';
function pairCard(pair){
  return '<article class="asProCard"><h4>Theoretical '+(pair.priceArbitrage?'arbitrage':'middle')+' candidate</h4><p>'+quote(pair.over)+'<br>'+quote(pair.under)+'</p>'
    +'<dl><div><dt>Lowest scenario return</dt><dd>'+signed(pair.minimumReturnPercent)+'</dd></div><div><dt>Highest scenario return</dt><dd>'+signed(pair.maximumReturnPercent)+'</dd></div>'
    +(pair.middle?'<div><dt>Both sides win at</dt><dd>'+esc(pair.middle.minimum===pair.middle.maximum?pair.middle.minimum:pair.middle.minimum+'–'+pair.middle.maximum)+'</dd></div>':'')+'</dl>'
    +'<details><summary>Settlement scenarios and assumptions</summary><p>Illustrative allocation: Over '+percent(pair.weightOver*100)+' / Under '+percent(pair.weightUnder*100)+'. Returns are net percentages of the combined allocation.</p>'
    +'<div class="asTableWrap"><table class="asTable"><caption>Distinct settlement outcomes</caption><thead><tr><th>Example stat</th><th>Over</th><th>Under</th><th>Net return</th></tr></thead><tbody>'
    +pair.scenarios.map(s=>'<tr><td>'+esc(s.exampleOutcome)+'</td><td>'+esc(s.overResult)+'</td><td>'+esc(s.underResult)+'</td><td>'+signed(s.returnPercent)+'</td></tr>').join('')+'</tbody></table></div>'
    +'<p>'+esc(pair.assumptions)+'</p><p>Over observed: '+observed(pair.over)+'<br>Under observed: '+observed(pair.under)+'</p><p>Execution and matching settlement rules have not been verified.</p></details></article>';
}
function evCard(result){
  return '<article class="asProCard"><p>'+quote(result.quote)+'</p>'+(result.available?'<h4>'+ (result.qualifiesEVPlus?'EV+':result.evidence==='adaptive-estimate'?'Exploratory model EV':'Model EV')+' · '+signed(result.evPercent)+'</h4><p>Win '+percent(result.win*100)+' · Loss '+percent(result.loss*100)+' · Push '+percent(result.push*100)+'</p><p>'+esc(result.note)+'</p>':'<p class="asAvailability">Unavailable: '+esc(result.reason)+'</p>')+'<p>Quote observed: '+observed(result.quote)+'</p></article>';
}
export function proToolsHtml(result){
  const section=(id,title,body)=>'<section class="asProSection" data-pro-tool="'+id+'"><h3>'+title+'</h3>'+body+'</section>';
  const empty=text=>'<p class="asNotice">'+esc(text)+'</p>';
  const pairReason=result.reason||result.domainReason;
  return '<div class="asProTools"><p class="asNotice">Research from verified pre-game quotes observed within 5 minutes. Paired quotes must be within 60 seconds of each other. Adjusting the research line does not change these offers.</p>'
    +section('ev','EV+',result.reason?empty(result.reason):(result.evPlus.length?'':empty('No qualifying positive EV forecast is available. Historical hit rates are not win probabilities.'))+'<div class="asProCards">'+result.evPlus.map(evCard).join('')+'</div>'
      +(result.ev.some(r=>!r.qualifiesEVPlus)?'<details><summary>Other estimates and forecast availability</summary><div class="asProCards">'+result.ev.filter(r=>!r.qualifiesEVPlus).map(evCard).join('')+'</div></details>':''))
    +section('arbitrage','Arbitrage',pairReason?empty(pairReason):result.arbitrage.length?'<div class="asProCards">'+result.arbitrage.map(pairCard).join('')+'</div>':empty('No theoretical arbitrage candidates match the available quotes.'))
    +section('middles','Middles',pairReason?empty(pairReason):result.middles.length?'<div class="asProCards">'+result.middles.map(pairCard).join('')+'</div>':empty('No attainable middle matches the available quotes.'))+'</div>';
}
