const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=v=>typeof v==='string'&&v.trim();
const identity=g=>g&&['sport','eventId','homeTeam','awayTeam','gameStartTime'].every(k=>text(g[k]))?JSON.stringify(['sport','eventId','homeTeam','awayTeam','gameStartTime'].map(k=>g[k])):null;
const unavailable=message=>({available:false,message});
export function researchWithMatchupContext(base,value,now=Date.now()){
 const playerId=base?.player?.providerPlayerId;
 if(!base||!value?.available||Date.parse(value.expiresAt)<=now||!/^history:[A-Z]+:\d+$/.test(playerId||''))return base;
 const injuries=(value.teams||[]).flatMap(t=>t.injuries?.rows||[]).filter(r=>r.playerId===playerId);
 const starters=(value.teams||[]).flatMap(t=>t.lineup?.starters||[]).filter(r=>r.playerId===playerId);
 return {...base,context:{...base.context,...(injuries.length===1?{injuryStatus:injuries[0].status,injuryDetail:injuries[0].detail}:{}),...(starters.length===1?{isStarter:true}:{})}};
}
export function createMatchupClient({fetcher=globalThis.fetch,clock=Date.now}={}){
 const cache=new Map(),pending=new Map();
 function peek(g){const key=identity(g);if(!key||g.archived)return unavailable('Current game context requires a verified active game.');const hit=cache.get(key);return hit&&hit.until>clock()?hit.value:null;}
 async function lookup(g,{force=false}={}){
  const key=identity(g);
  if(!key||g.archived)return unavailable('Current game context requires a verified active game.');
  if(pending.has(key))return pending.get(key);
  if(!force&&peek(g))return peek(g);
  const job=(async()=>{
   let value;
   try{
    const params=new URLSearchParams(Object.fromEntries(['sport','eventId','homeTeam','awayTeam','gameStartTime'].map(k=>[k,g[k]])));
    const response=await fetcher('/api/apex/research-matchup?'+params,{credentials:'same-origin',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('http');value=await response.json();
    if(value?.available===true&&(value.eventId!==g.eventId||value.sport!==g.sport||Date.parse(value.gameStartTime)!==Date.parse(g.gameStartTime)
      ||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=clock()||!Array.isArray(value.teams)||value.teams.length!==2))throw Error('identity');
    if(typeof value?.available!=='boolean')throw Error('shape');
   }catch{value=unavailable('Game context could not load. Try again shortly.');}
   cache.set(key,{value,until:clock()+(value.available?120000:30000)});
   while(cache.size>100)cache.delete(cache.keys().next().value);
   return value;
  })().finally(()=>pending.delete(key));
  pending.set(key,job);return job;
 }
 return {peek,lookup};
}
function stateHtml(value){
 if(!value)return '<p class="asNotice" role="status">Loading verified game context…</p>';
 if(!value.available||Date.parse(value.expiresAt)<=Date.now())return '<p class="asAvailability">'+esc(value.message||'This game context has expired. Refresh to check the latest report.')+'</p><button type="button" class="asBtn" data-refresh-matchup>Retry game context</button>';
 return '';
}
function evidence(value){
 const url=/^https:\/\/www\.espn\.com\/[a-z0-9-]+\/game\/_\/gameId\/\d+$/.test(value.sourceUrl||'')?value.sourceUrl:null;
 return '<p class="asNotice">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">ESPN game report ↗</a>':'ESPN game report')+' · Retrieved '+esc(new Date(value.retrievedAt).toLocaleString())+'</p><button type="button" class="asBtn" data-refresh-matchup>Refresh game context</button>';
}
export function winPredictorHtml(value){
 const state=stateHtml(value);if(state)return state;
 const p=value.prediction,ready=p?.available===true&&Date.parse(p.expiresAt)>Date.now()&&Date.parse(value.gameStartTime)>Date.now();
 return '<div class="asWinPredictor">'+(ready?'<p class="asNotice">ESPN Matchup Predictor · Pre-game win estimates</p><div class="asProCards">'+value.teams.map(t=>'<article class="asProCard" data-win-status="'+esc(t.side)+'"><h4>'+esc(t.name)+'</h4><strong>'+esc(t.side==='home'?p.homePercent:p.awayPercent)+'%</strong><p>'+esc(t.side==='home'?'Home':'Away')+'</p></article>').join('')+'</div><p class="asNotice">'+esc(p.note)+'</p>':'<p class="asAvailability" data-win-status="unavailable">'+esc(p?.message||'A current pre-game estimate is not available.')+'</p>')
  +'<details><summary>Prediction source and limits</summary><p>These are the source’s published game estimates, separate from prop hit rates and sportsbook-implied probabilities. The source does not provide a generation timestamp or a calibration report in this feed; the retrieval time is shown below.</p><p>No prediction is manufactured when the source omits it. A missing draw estimate is not treated as zero. Adjusting a player prop line does not change the game forecast.</p></details>'+evidence(value)+'</div>';
}
export function gameContextHtml(value){
 const state=stateHtml(value);if(state)return state;
 const section=(title,body)=>'<section class="asProSection"><h3>'+title+'</h3>'+body+'</section>';
 const cards=fn=>'<div class="asProCards">'+value.teams.map(t=>'<article class="asProCard"><h4>'+esc(t.name)+'</h4>'+fn(t)+'</article>').join('')+'</div>';
 const table=(head,rows)=>'<div class="asTableWrap"><table class="asTable"><thead><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
 const injuries=cards(t=>!t.injuries?.available?'<p>No current injury report was returned for this team.</p>':!t.injuries.rows.length?'<p>No players are listed in the returned report. This does not confirm everyone is healthy.</p>':table(['Player','Status','Reported'],t.injuries.rows.map(r=>'<tr><td>'+esc(r.playerName)+'<small>'+esc(r.position||'')+'</small></td><td>'+esc(r.status)+'<small>'+esc(r.detail||'')+'</small></td><td>'+esc(r.reportedAt?new Date(r.reportedAt).toLocaleDateString():'Date not reported')+'</td></tr>').join('')));
 const lineups=cards(t=>{
  const lineup=t.lineup||{},rows=[...(lineup.starters||[]),...(lineup.probables||[])];
  return (!lineup.available?'<p>Confirmed starters have not been published.</p>':'')+(rows.length?table(['Player','Position','Designation'],rows.map(r=>'<tr><td>'+esc(r.playerName)+'</td><td>'+esc(r.position||'—')+'</td><td>'+esc(r.status)+'</td></tr>').join('')):'');
 });
 const weather=value.weather?.available?'<p><strong>'+esc(value.weather.temperature)+esc(value.weather.unit)+'</strong> · '+esc(value.venue?.name||'Game venue')+'</p><p>'+esc(value.weather.note)+'</p>':'<p>'+esc(value.weather?.message||'No weather report is available.')+'</p>';
 return '<div class="asProTools" id="asGameContext">'+section('Injuries',injuries)+section('Lineups and probable starters',lineups)+section('Game weather',weather)
  +section('Team records and published rankings',cards(t=>'<p>Record: <strong>'+esc(t.record||'Not reported')+'</strong></p>'+(['NCAAF','NCAAB'].includes(value.sport)?'<p>Published Top 25 rank: '+esc(t.rank??'Not reported')+'</p>':'' )))
  +'<p class="asNotice">Team records and published rankings are not opponent defensive ranks. Injury reports do not establish historical with/without-player effects.</p>'+evidence(value)+'</div>';
}
