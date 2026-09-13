import { sensitivityMap, disagreementMap, evidenceQuality, propTimeline, scenarioLab, playerDependencies,
  createChangeRadar, researchBrief, verifiedGames } from '../autoscout/intelligence.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(v):'Unavailable';
const signed=v=>v===null?'Unavailable':`${v>0?'+':''}${fmt(v)}`;
const at=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString():'Time unavailable';
const note=v=>`<p class="asi-note">${esc(v)}</p>`;
const empty=v=>`<div class="asi-empty">${esc(v)}</div>`;
const radar=createChangeRadar();
let boardRoot=null, openResearch=null, latestGroups=[], sequence=0;
const detailStates=new Map();
const STYLE=`
#as5 .asi{--asi-panel:#101b29;--asi-line:#293c50;--asi-text:#eaf2f8;--asi-muted:#a4b4c5;--asi-mint:#69e7ba;color:var(--asi-text);font:inherit;line-height:1.5;min-width:0}
#as5 .asi *{box-sizing:border-box}#as5 .asi button,#as5 .asi input,#as5 .asi select{font:inherit}
#as5 .asi button:focus-visible,#as5 .asi a:focus-visible,#as5 .asi input:focus-visible,#as5 .asi select:focus-visible,#as5 .asi summary:focus-visible{outline:2px solid var(--asi-mint);outline-offset:3px}
#as5 .asi-studio{position:relative;overflow:hidden;border:1px solid var(--asi-line);border-radius:18px;background:radial-gradient(ellipse at 95% 0%,#19403b70,transparent 55%),linear-gradient(120deg,#111d2d,#0b1320);padding:22px;margin:0 0 18px;box-shadow:0 15px 40px #02060c30}
#as5 .asi-eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--asi-mint);font-weight:750;margin:0 0 7px}
#as5 .asi-head{display:flex;align-items:center;justify-content:space-between;gap:16px}#as5 .asi h2{font-size:clamp(20px,2vw,27px);letter-spacing:-.035em;margin:0 0 5px}#as5 .asi-lede{color:var(--asi-muted);font-size:12px;margin:0;max-width:650px}
#as5 .asi-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 14px;background:#16273a;border:1px solid #38526b;color:#edf7fc;border-radius:10px;cursor:pointer;font-size:12px;font-weight:650;text-decoration:none;white-space:nowrap}
#as5 .asi-button.primary{background:#70e9bc;color:#06291f;border-color:#70e9bc}#as5 .asi-button:disabled{opacity:.5;cursor:not-allowed}
#as5 .asi-tags{display:flex;flex-wrap:wrap;gap:7px;margin-top:16px}#as5 .asi-tag{padding:5px 9px;border:1px solid #284337;border-radius:7px;background:#0c241e;color:#a5efd4;font-size:10px}
#as5 .asi-note{font-size:11px;color:var(--asi-muted);margin:10px 0;line-height:1.6}#as5 .asi-empty{border:1px dashed #385068;background:#0c1522;border-radius:10px;padding:14px;color:#afbdce;font-size:12px}
#as5 .asi-radar{border-top:1px solid #2a3b4d;margin-top:16px;padding-top:13px}#as5 .asi-radar summary{cursor:pointer;font-size:12px;font-weight:700;display:list-item}#as5 .asi-radar-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}
#as5 .asi-radar-card{border:1px solid #2c4259;border-radius:11px;background:#0c1624;padding:12px;text-align:left;color:#e5edf6;cursor:pointer;min-width:0}#as5 .asi-radar-card strong,#as5 .asi-radar-card small{display:block;overflow-wrap:anywhere}#as5 .asi-radar-card b{display:block;color:#85e8c5;margin:6px 0}#as5 .asi-radar-card small{font-size:10px;color:#a8b8cc}
#as5 .asi-detail{padding:14px 0}#as5 .asi-detail h2{font-size:22px}#as5 .asi-menu{display:flex;flex-wrap:wrap;gap:6px;margin:15px 0}#as5 .asi-menu button{background:#142134;color:#c5d5e7;border:1px solid #30465f;padding:7px 10px;font-size:11px;min-height:36px;border-radius:8px;cursor:pointer}
#as5 .asi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}#as5 .asi-panel{border:1px solid #2b3e53;background:linear-gradient(145deg,#132033,#0e1826);border-radius:13px;overflow:hidden;min-width:0;scroll-margin-top:90px}#as5 .asi-panel.wide{grid-column:1/-1}#as5 .asi-panel>summary{cursor:pointer;padding:14px 16px;font-size:13px;font-weight:700;color:#e8f0f8}#as5 .asi-panel>summary span{float:right;color:#7ee6c2;font-size:10px;font-weight:500;margin-top:2px}#as5 .asi-panel-body{padding:0 16px 16px}
#as5 .asi .asi-big{font-size:29px;letter-spacing:-.04em;line-height:1.25;font-weight:750;color:#b4f7dd;margin:3px 0}#as5 .asi-kpis{display:flex;gap:22px;flex-wrap:wrap}#as5 .asi-kpis small{font-size:10px;color:#a1b6cd}
#as5 .asi-table-wrap{overflow:auto;max-width:100%;border:1px solid #2a3e55;border-radius:9px}#as5 .asi table{border-collapse:collapse;width:100%;font-size:11px;text-align:left;font-variant-numeric:tabular-nums}#as5 .asi th{font-weight:600;color:#a2b6cd;background:#0c1624;white-space:nowrap}#as5 .asi td,#as5 .asi th{padding:9px 10px;border-bottom:1px solid #26394e}#as5 .asi tr:last-child td{border:0}#as5 .asi tr.active{background:#143a3060}#as5 .asi td:last-child{white-space:nowrap}
#as5 .asi-rate{min-width:80px;display:flex;align-items:center;gap:6px}#as5 .asi-bar{height:5px;width:55px;background:#26394f;border-radius:9px;display:inline-block;overflow:hidden}#as5 .asi-bar i{display:block;height:100%;background:#66dbb1}
#as5 .asi label{display:block;color:#b7c9dc;font-size:11px;margin-bottom:9px}#as5 .asi select,#as5 .asi input{display:block;width:100%;min-height:40px;background:#0c1827;color:#e7f2fb;border:1px solid #38516e;border-radius:8px;padding:8px;margin-top:5px;min-width:0}#as5 .asi-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#as5 .asi-checks{list-style:none;padding:0;margin:12px 0}#as5 .asi-checks li{font-size:12px;border-bottom:1px solid #26384c;padding:9px 0}#as5 .asi-checks li:last-child{border:0}#as5 .asi-checks b{color:#81e1bb;margin-right:6px}#as5 .asi-checks small{display:block;color:#a6b7ca;font-size:10px;margin-top:3px}
#as5 .asi-book{display:grid;grid-template-columns:minmax(75px,1fr) 2fr 48px;gap:10px;align-items:center;margin:14px 0;font-size:11px}#as5 .asi-book-track{height:4px;background:#2e4561;border-radius:3px;position:relative}#as5 .asi-book-dot{position:absolute;top:-3px;width:10px;height:10px;transform:translateX(-50%);background:#70e9bc;border-radius:50%}#as5 .asi-book-meta{grid-column:1/-1;color:#98abc2;font-size:10px;margin-top:-8px}
#as5 .asi-timeline{list-style:none;margin:15px 0;padding:0 0 0 12px;border-left:1px solid #426a68}#as5 .asi-timeline li{padding:0 0 18px 13px;position:relative;font-size:12px}#as5 .asi-timeline li:before{content:'';position:absolute;left:-16px;top:5px;width:6px;height:6px;border-radius:50%;background:#6be5b5}#as5 .asi-timeline time,#as5 .asi-timeline small{display:block;color:#a1b5cb;font-size:10px}
#as5 .asi-graph{width:100%;height:auto;background:#0b1421;border-radius:10px;border:1px solid #2d425a}#as5 .asi-brief{font-size:12px;line-height:1.7}#as5 .asi-evidence{margin:12px 0;border-top:1px solid #2e4259;padding-top:12px}#as5 .asi-evidence small{display:block;color:#a7bbcf;font-size:10px}#as5 .asi-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
@media(max-width:700px){#as5 .asi-studio{padding:16px;border-radius:13px}#as5 .asi-head{align-items:flex-start;flex-direction:column;gap:12px}#as5 .asi-head>.asi-button{width:100%}#as5 .asi-radar-grid,#as5 .asi-grid{grid-template-columns:1fr}#as5 .asi-panel.wide{grid-column:auto}#as5 .asi h2{font-size:23px}#as5 .asi-detail{padding-top:8px}#as5 .asi-panel>summary{padding:14px}#as5 .asi-panel-body{padding:0 12px 14px}#as5 .asi-menu button{min-height:40px}#as5 .asi th,#as5 .asi td{padding:8px}#as5 .asi-tags{gap:5px}#as5 .asi-tag{font-size:9px}}
@media(prefers-reduced-motion:reduce){#as5 .asi *{scroll-behavior:auto!important;transition:none!important}}
`;
const panel=(id,title,body,{wide=false,open=false,badge=''}={})=>`<details class="asi-panel ${wide?'wide':''}" id="asi-${id}" ${open?'open':''} data-intelligence="${id}"><summary>${esc(title)}${badge?`<span>${esc(badge)}</span>`:''}</summary><div class="asi-panel-body">${body}</div></details>`;
const shortTime=v=>{if(!v)return'Time unavailable';return new Date(v).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};

export function mountBoard({ root, onOpen }) {
  if(!root || boardRoot?.isConnected)return;
  openResearch=onOpen;
  if(!document.getElementById('asi-style')){const style=document.createElement('style');style.id='asi-style';style.textContent=STYLE;document.head.append(style);}
  boardRoot=document.createElement('section');boardRoot.className='asi asi-studio';boardRoot.setAttribute('aria-label','Auto Scout intelligence studio');
  boardRoot.innerHTML=`<div class="asi-head"><div><p class="asi-eyebrow">Auto Scout / Intelligence studio</p><h2>See the evidence. Understand the change.</h2><p class="asi-lede">Eight research tools. One workspace. Explore the numbers behind a prop without leaving Auto Scout.</p></div><button class="asi-button primary" id="asi-open">Open research studio <span aria-hidden="true">↗</span></button></div><div class="asi-tags"><span class="asi-tag">Real game-log calculations</span><span class="asi-tag">Transparent assumptions</span><span class="asi-tag">No automatic AI requests</span></div><details class="asi-radar" data-intelligence="radar"><summary>Prop Change Radar <span id="asi-radar-count"></span></summary><p class="asi-note">Changes observed during this visit. Uses existing board refreshes, not a new live feed. No claims about why a line moved.</p><div id="asi-radar-content"></div></details>`;
  root.querySelector('.asHero')?.after(boardRoot);
  boardRoot.addEventListener('click',event=>{
    const button=event.target.closest('[data-radar-key],#asi-open');if(!button)return;
    const group=button.id==='asi-open'?latestGroups[0]:latestGroups.find(g=>g.key===button.dataset.radarKey);
    if(group)openResearch(group);
  });
}

export function updateBoard({ groups=[], allGroups=groups, scope, at:timestamp, stale=false }) {
  if(!boardRoot?.isConnected)return;
  latestGroups=groups;
  radar.observe(allGroups,{scope,at:timestamp,stale});
  const changes=radar.current(new Set(groups.map(g=>g.key)));
  boardRoot.querySelector('#asi-open').disabled=!groups.length;
  boardRoot.querySelector('#asi-radar-count').textContent=changes.length?`· ${changes.length} observed changes`:'· collecting observations';
  const html=changes.length?`<div class="asi-radar-grid">${changes.slice(0,6).map(e=>`<button class="asi-radar-card" data-radar-key="${esc(e.groupKey)}"><strong>${esc(e.player)}</strong><small>${esc(e.market)} · ${esc(e.side)}</small><b>${fmt(e.from)} → ${fmt(e.to)} <span>(${signed(e.delta)})</span></b><small>${esc(e.book)} · observed ${esc(shortTime(e.at))}</small></button>`).join('')}</div>`:empty('No verified movement observed yet. Refresh the board later to compare the same player, market, event, book and side. Newly missing props are not assumed withdrawn.');
  if(boardRoot.querySelector('#asi-radar-content').innerHTML!==html)boardRoot.querySelector('#asi-radar-content').innerHTML=html;
}

function sensitivityHTML(base,line,side,window,venue) {
  const map=sensitivityMap(base,{line,side,window,venue});
  const selector=`<label>Research sample<select id="asi-window">${['l5','l10','l15','l20','season','h2h'].map(w=>`<option value="${w}" ${w===window?'selected':''}>${w.toUpperCase()}</option>`).join('')}</select></label>`;
  if(!map.available)return selector+empty('No verified sample is available for this selection. Change the research window or check the Game log tab.');
  return selector+`<div class="asi-table-wrap"><table><caption class="asSrOnly">Historical sensitivity to hypothetical lines, ${esc(side)}</caption><thead><tr><th>Line</th><th>Hit rate</th><th>Hits / games</th><th>Pushes</th></tr></thead><tbody>${map.rows.map(r=>`<tr class="${r.active?'active':''}"><td>${fmt(r.line)}${r.active?' · active':''}</td><td><span class="asi-rate"><span class="asi-bar" aria-hidden="true"><i style="width:${r.rate===null?0:Math.max(0,Math.min(100,r.rate))}%"></i></span>${r.rate===null?'N/A':Math.round(r.rate)+'%'}</span></td><td>${r.hits??'—'} / ${r.games}</td><td>${r.pushes??'—'}</td></tr>`).join('')}</tbody></table></div>`+note(map.note)+note(`Side: ${side}. Venue: ${venue}. ${map.rows.some(r=>r.partial)?'Current season sample is partial.':''}`);
}
function qualityHTML(base,g,side){const q=evidenceQuality(base,g,side);return `<div class="asi-big">${q.passed}<small> / ${q.total}</small></div><strong>${esc(q.label)}</strong><ul class="asi-checks">${q.checks.map(c=>`<li><b>${c.met?'✓':'—'}</b>${esc(c.label)}<small>${esc(c.detail)}</small></li>`).join('')}</ul>`+note(q.note);}
function disagreementHTML(g,side){const d=disagreementMap(g,side);if(!d.available)return empty('Comparable regular lines have not been supplied.');return `<div class="asi-kpis"><div><small>Comparable books</small><div class="asi-big">${d.books.length}</div></div><div><small>Line range</small><div class="asi-big">${fmt(d.min)}–${fmt(d.max)}</div></div></div>${d.books.map(b=>`<div class="asi-book"><span>${esc(b.name)}</span><span class="asi-book-track" aria-hidden="true"><i class="asi-book-dot" style="left:${d.spread?((b.line-d.min)/d.spread*90+5):50}%"></i></span><strong>${fmt(b.line)}</strong><small class="asi-book-meta">${b.stale?'Older than 30 minutes · ':''}${b.freshnessKnown?esc(at(b.at)):'Provider timestamp unavailable'}</small></div>`).join('')}`+note(d.note)+(!d.comparable?note('At least two books are needed to measure disagreement.'):'')+(d.omitted.length?note(`${d.omitted.length} books omitted because simultaneous regular lines were ambiguous.`):'');}
function scenarioHTML(base,g,state){const result=scenarioLab(base,{sport:g.sport,targetMinutes:state.minutes,usagePercent:state.usage});return `<form id="asi-scenario-form"><div class="asi-fields"><label>Assumed minutes<input id="asi-minutes" type="number" min="0" max="60" step="0.5" value="${esc(state.minutes)}" required></label><label>Assumed usage change (%)<input id="asi-usage" type="number" min="-50" max="50" step="1" value="${esc(state.usage)}" required></label></div><button class="asi-button" type="submit">Calculate what-if</button></form><div id="asi-scenario-result" aria-live="polite">${scenarioResultHTML(result)}</div>`;}
function scenarioResultHTML(r){return r.available?`<div class="asi-kpis"><div><small>Hypothetical stat</small><div class="asi-big">${fmt(r.adjusted)}</div></div><div><small>Historical average</small><div class="asi-big">${fmt(r.baseline)}</div></div></div>`+note(`${r.games} games · ${fmt(r.rate)} per minute · baseline ${fmt(r.baselineMinutes)} minutes. Delta: ${signed(r.delta)}.`)+note(r.formula)+note(r.note):empty(r.reason);}
function dependencyHTML(base,g){const data=playerDependencies(base),comparable=data.filter(r=>r.difference!==null);if(!data.length)return empty('Verified game-by-game teammate participation is unavailable. A current roster or injury list cannot establish historical with/without effects. No relationship is inferred.');
  const visible=comparable.slice(0,6),height=Math.max(110,visible.length*50+24);
  const graph=visible.length?`<svg class="asi-graph" viewBox="0 0 500 ${height}" role="img" aria-label="Historical teammate associations. Values and sample counts are available in the following table."><circle cx="60" cy="${height/2}" r="20" fill="#153c32" stroke="#71e9bb"/><text x="60" y="${height/2+4}" fill="#e8f9f3" text-anchor="middle" font-size="11">Player</text>${visible.map((r,i)=>`<path d="M 80 ${height/2} C 160 ${height/2} 130 ${35+i*50} 210 ${35+i*50}" fill="none" stroke="${r.limited?'#52657a':'#66cbaa'}" stroke-dasharray="${r.limited?'4 4':'0'}"/><circle cx="215" cy="${35+i*50}" r="5" fill="#70d4ae"/><text x="233" y="${39+i*50}" fill="#d7e6f5" font-size="12">${esc(r.name.slice(0,24))} · ${signed(r.difference)}</text>`).join('')}</svg>`:'';
  return graph+`<div class="asi-table-wrap"><table><thead><tr><th>Teammate</th><th>With: avg (g)</th><th>Without: avg (g)</th><th>Difference</th></tr></thead><tbody>${data.map(r=>`<tr><td>${esc(r.name)}${r.limited?' · small sample':''}</td><td>${fmt(r.withAverage)} (${r.withGames})</td><td>${fmt(r.withoutAverage)} (${r.withoutGames})</td><td>${signed(r.difference)}</td></tr>`).join('')}</tbody></table></div>`+note('Association is not causation. Dashed connections have fewer than five games in at least one bucket. Missing participation is never treated as absence.');}
function timelineHTML(events){return events.length?`<ol class="asi-timeline">${events.map(e=>`<li><time datetime="${esc(e.at)}">${esc(at(e.at))}</time><strong>${esc(e.label)}</strong><small>${esc(e.detail)} · ${esc(e.source)}</small></li>`).join('')}</ol>`:empty('No timestamped events are available for this selection. Loading an empty response does not establish that nothing changed.');}
function briefHTML(brief){return `<div class="asi-brief"><strong>${esc(brief.title)}</strong>${brief.evidence.map(e=>`<div class="asi-evidence" id="asi-${e.id}"><b>[${e.id}] ${esc(e.label)}</b><div>${esc(e.text)}</div><small>Source: ${esc(e.source)}</small></div>`).join('')}${brief.gaps.map(g=>note(g)).join('')}${note(brief.note)}</div><div class="asi-actions"><button class="asi-button" id="asi-copy">Copy brief</button><button class="asi-button" id="asi-download">Save as text</button></div><p class="asi-note" role="status" id="asi-copy-status"></p>`;}

export function renderDetails(root,{group:g,base={},line,side,venue='all',getHistory}){
  if(!root)return;
  const token=++sequence,key=g.key+'|'+line+'|'+side;
  if(!detailStates.has(key)){
    const minuteRows=verifiedGames(base).slice(0,10).filter(r=>typeof r.minutes==='number'&&r.minutes>0);
    detailStates.set(key,{window:'l10',minutes:minuteRows.length?Math.round(minuteRows.reduce((s,r)=>s+r.minutes,0)/minuteRows.length):30,usage:0,timeline:[],book:null});
    while(detailStates.size>40)detailStates.delete(detailStates.keys().next().value);
  }
  const state=detailStates.get(key),books=disagreementMap(g,side).books;
  if(!state.book||!books.some(b=>b.key===state.book))state.book=books[0]?.key||'';
  const stillCurrent=()=>root.isConnected&&token===sequence;
  const q=evidenceQuality(base,g,side),changes=radar.current(new Set([g.key]));
  const kinds=[['sensitivity','Line sensitivity'],['quality','Data quality'],['scenario','Scenario lab'],['disagreement','Book disagreement'],['timeline','Timeline'],['dependencies','Player dependencies'],['brief','Research brief'],['radar-detail','Change radar']];
  root.className='asi asi-detail';
  root.innerHTML=`<p class="asi-eyebrow">Research, with its workings shown</p><h2>Intelligence studio</h2><p class="asi-lede">${esc(g.playerName)} · ${esc(g.market)} · ${esc(side)} ${fmt(line)}. These tools reuse your existing board and game logs.</p><div class="asi-menu" aria-label="Intelligence tools">${kinds.map(([id,label])=>`<button data-asi-section="${id}">${label}</button>`).join('')}</div><div class="asi-grid">`+
    panel('sensitivity','Line Sensitivity Map',sensitivityHTML(base,line,side,state.window,venue),{open:true,wide:true,badge:'Shared calculation engine'})+
    panel('quality','Research Data Quality',qualityHTML(base,g,side),{open:true,badge:`${q.passed}/${q.total} checks`})+
    panel('disagreement','Sportsbook Disagreement Map',disagreementHTML(g,side),{open:true,badge:`${books.length} books`})+
    panel('scenario','Scenario Lab',scenarioHTML(base,g,state),{wide:true,badge:'Explicit what-if assumptions'})+
    panel('timeline','Prop Intelligence Timeline',`<label>Observed book<select id="asi-history-book">${books.map(b=>`<option value="${esc(b.key)}" ${b.key===state.book?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label><button class="asi-button" id="asi-history-load" ${!books.length?'disabled':''}>Load observed timeline</button>${note('On-demand stored line history. Timestamped injury, lineup and projection event feeds are not yet supplied; current status is not a change history.')}<div id="asi-timeline-output" aria-live="polite">${timelineHTML(state.timeline)}</div>`,{wide:true})+
    panel('dependencies','Player Dependency Graph',dependencyHTML(base,g),{wide:true,badge:'Measured association only'})+
    panel('brief','Auto Scout Research Brief',`<button class="asi-button primary" id="asi-brief-build">Generate evidence brief</button>${note('Deterministic summary with numbered evidence. No paid AI request.')}<div id="asi-brief-output"></div>`,{wide:true})+
    panel('radar-detail','Prop Change Radar',changes.length?`<ol class="asi-timeline">${changes.map(e=>`<li><time>${esc(at(e.at))}</time><strong>${esc(e.book)}: ${fmt(e.from)} → ${fmt(e.to)}</strong><small>${esc(e.side)} · ${esc(e.label)}</small></li>`).join('')}</ol>`:empty('No change for this prop has been observed during this visit. Refreshing the existing board collects the next comparable observation.'),{wide:true})+'</div>';
  root.querySelectorAll('[data-asi-section]').forEach(button=>button.onclick=()=>{const section=root.querySelector('#asi-'+button.dataset.asiSection);section.open=true;section.querySelector('summary').focus({preventScroll:true});section.scrollIntoView({block:'nearest',behavior:'auto'});});
  root.querySelector('#asi-window').onchange=event=>{state.window=event.target.value;renderDetails(root,{group:g,base,line,side,venue,getHistory});root.querySelector('#asi-window').focus();};
  root.querySelector('#asi-scenario-form').onsubmit=event=>{event.preventDefault();state.minutes=root.querySelector('#asi-minutes').value;state.usage=root.querySelector('#asi-usage').value;root.querySelector('#asi-scenario-result').innerHTML=scenarioResultHTML(scenarioLab(base,{sport:g.sport,targetMinutes:state.minutes,usagePercent:state.usage}));};
  root.querySelector('#asi-history-book').onchange=event=>{state.book=event.target.value;state.timeline=[];root.querySelector('#asi-timeline-output').innerHTML=empty('Load the selected book to view its own observations.');};
  root.querySelector('#asi-history-load').onclick=async event=>{
    const button=event.currentTarget,book=state.book;button.disabled=true;button.textContent='Loading observations…';
    try{const response=await getHistory(book);if(!stillCurrent()||state.book!==book)return;
      state.timeline=propTimeline({history:response.rows||[],propId:response.propId,book,side,groupKey:g.key});
      root.querySelector('#asi-timeline-output').innerHTML=response.configured===false?empty('Stored line history is unavailable for this selection.'):timelineHTML(state.timeline);
    }catch{if(stillCurrent())root.querySelector('#asi-timeline-output').innerHTML=empty('History could not load. Retry without leaving the page.');}
    finally{if(stillCurrent()){button.disabled=false;button.textContent='Load observed timeline';}}
  };
  root.querySelector('#asi-brief-build').onclick=()=>{
    const brief=researchBrief({base,group:g,line,side,timeline:state.timeline}),output=root.querySelector('#asi-brief-output');output.innerHTML=briefHTML(brief);
    output.querySelector('#asi-copy').onclick=async()=>{try{await navigator.clipboard.writeText(brief.text);if(stillCurrent())output.querySelector('#asi-copy-status').textContent='Copied.';}catch{if(stillCurrent())output.querySelector('#asi-copy-status').textContent='Clipboard unavailable. Use Save as text instead.';}};
    output.querySelector('#asi-download').onclick=()=>{const url=URL.createObjectURL(new Blob([brief.text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='autoscout-research-brief.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  };
}

export function disposeDetails(){sequence++;}
export function clearSession(){radar.clear();detailStates.clear();sequence++;}
