import { number, timestamp, sample, lineSensitivity, bookDistribution, dataQuality, scenarioLab, intelligenceTimeline, dependencyGraph, createChangeRadar, researchBrief } from './intelligence.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => number(value) === null ? 'Unavailable' : Number(Number(value).toFixed(2)).toLocaleString();
const sign = value => number(value) === null ? 'Unavailable' : `${value > 0 ? '+' : ''}${fmt(value)}`;
const date = value => timestamp(value) === null ? 'Time unavailable' : new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const tabs = [['brief','Research brief'],['sensitivity','Line sensitivity'],['evidence','Evidence quality'],['timeline','Timeline'],['market','Book map'],['scenario','Scenario Lab'],['dependencies','Player dependencies']];
const windows = [['l5','L5'],['l10','L10'],['l15','L15'],['l20','L20'],['season','Season'],['h2h','H2H']];
const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 19 5M12 3v2M21 12h-2M12 21v-2M3 12h2"/></svg>';
const empty = (heading,detail) => `<div class="aiEmpty"><span>${icon}</span><h4>${esc(heading)}</h4><p>${esc(detail)}</p></div>`;
const button = (action,label,extra='') => `<button type="button" class="aiButton" data-ai-action="${action}" ${extra}>${label}</button>`;

/** All requests are delegated to the existing history cache; this module adds no poller. */
export function createIntelligenceUI({ openProp, changeLine, openPanel, loadHistory, notify = () => {} } = {}) {
  const radar = createChangeRadar();
  const states = new Map(); let current = null, latestGroups = [], latestMeta = {}, latestSport = null;
  function state(ctx) {
    if (!states.has(ctx.group.key)) states.set(ctx.group.key,{ tab:'brief',window:'l10',step:1,adjustment:0,targetMinutes:null,history:new Map(),historyLoading:new Set(),historyError:new Set(),observations:[],lastContext:{},brief:null,teammate:null });
    while (states.size > 40) states.delete(states.keys().next().value);
    return states.get(ctx.group.key);
  }
  function facts(ctx) {
    const base = ctx.base || {}, distribution = bookDistribution(ctx.group.rows,{side:ctx.side});
    const quality = dataQuality({...base,line:ctx.line,side:ctx.side},distribution);
    const s=state(ctx), key=`${ctx.propId}|${ctx.book}|${ctx.side}`, stored=s.history.get(key);
    const timeline=intelligenceTimeline({history:stored?.rows || [],propId:ctx.propId,book:ctx.book,side:ctx.side,observations:s.observations});
    return {base,distribution,quality,timeline,stored,historyKey:key};
  }
  function observeContext(ctx) {
    const s=state(ctx), c=ctx.base?.context || {}, now=new Date().toISOString();
    const values={Injury:c.injuryStatus,Lineup:c.lineupVerified===true?c.starter===true?'Verified starter':c.starter===false?'Verified non-starter':null:null,
      Projection:ctx.projection?.available===true?number(ctx.projection.projection):number(ctx.base?.projectedStat?.value),Game:ctx.group.live===true?'Live status supplied':null};
    for (const [kind,value] of Object.entries(values)) {
      if (value == null || value === '' || value === s.lastContext[kind]) continue;
      s.observations.unshift({kind,at:now,label:`${kind === 'Projection' ? 'Estimate' : kind}: ${value}${s.lastContext[kind] == null ? ' (first seen here)' : ` (previously ${s.lastContext[kind]})`}`});
      s.lastContext[kind]=value;
    }
    s.observations=s.observations.slice(0,60);
  }
  function header(ctx,s) {
    return `<header class="aiHeader"><div class="aiMark">${icon}</div><div><p class="aiEyebrow">AUTO SCOUT / INTELLIGENCE</p><h3>Go beyond the line.</h3><p>Inspect the evidence. Explore the assumptions.</p></div><span class="aiContext">${esc(ctx.side)} ${esc(fmt(ctx.line))}</span></header>
    <nav class="aiTabs" aria-label="Intelligence tools">${tabs.map(([id,label])=>`<button type="button" data-ai-tab="${id}" aria-pressed="${id===s.tab}" class="${id===s.tab?'on':''}">${label}</button>`).join('')}</nav>`;
  }
  function evidence(ctx,f) {
    const q=f.quality;
    return `<div class="aiSectionHead"><div><p class="aiEyebrow">EVIDENCE, NOT CERTAINTY</p><h4>How much do we actually know?</h4></div><span class="aiPill">${q.label}</span></div>
      <div class="aiEvidenceHero"><div class="aiScore" style="--score:${q.percent}%"><b>${q.passed}<small>/${q.total}</small></b></div><div><strong>Evidence checks met</strong><p>This measures data coverage. It is not a probability of winning or a recommendation.</p></div></div>
      <div class="aiChecks">${q.checks.map(c=>`<article class="aiCheck"><span class="aiCheckIcon ${c.pass?'yes':''}">${c.pass?'✓':'?'}</span><div><b>${esc(c.label)}</b><p>${esc(c.detail)}</p></div><span class="aiCheckStatus">${c.pass?'Met':'Not verified'}</span></article>`).join('')}</div>`;
  }
  function sensitivity(ctx,s) {
    const rows=lineSensitivity(ctx.base,ctx.line,ctx.side,{window:s.window,step:s.step});
    return `<div class="aiSectionHead"><div><p class="aiEyebrow">THRESHOLD ANALYSIS</p><h4>A small line change can matter.</h4></div></div>
      <div class="aiControls"><label>History window<select id="aiWindow">${windows.map(([id,label])=>`<option value="${id}" ${s.window===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Line spacing<select id="aiStep">${[.5,1,2,5].map(v=>`<option value="${v}" ${s.step===v?'selected':''}>${v}</option>`).join('')}</select></label></div>
      ${rows.some(r=>r.hitRate!==null)?`<div class="aiSensitivity">${rows.map(r=>`<button type="button" class="aiSensitivityCell ${r.active?'active':''}" data-ai-line="${r.line}" aria-label="Research ${ctx.side} ${r.line}: ${r.hitRate??'unavailable'} percent historical hit rate" aria-pressed="${r.active}"><small>${ctx.side}</small><b>${esc(fmt(r.line))}</b><div class="aiTrack"><i style="height:${r.hitRate??0}%"></i></div><strong>${r.hitRate===null?'N/A':fmt(r.hitRate)+'%'}</strong><span>${r.hits??0}/${r.games} hits</span><em>${r.pushes??0} pushes</em></button>`).join('')}</div><p class="aiNote">${rows[4]?.games||0} eligible games${rows[4]?.partial?' · Partial season coverage':''}. Pushes remain in the denominator and are not hits. Select a cell to change your research line, not the sportsbook’s offer.</p>`:empty('No history for this window','Choose another window or open the game log. Missing values are not treated as zero.')}
      ${button('games','Inspect source game log →')}`;
  }
  function market(ctx,f) {
    const d=f.distribution, range=(d.max??0)-(d.min??0), position=q=>range>0?Math.max(0,Math.min(100,(q.line-d.min)/range*100)):50;
    return `<div class="aiSectionHead"><div><p class="aiEyebrow">CROSS-BOOK DISTRIBUTION</p><h4>One player. Different lines.</h4></div><span class="aiPill">${ctx.side} only</span></div>
      <div class="aiStats"><div><small>Comparable books</small><b>${d.books}</b></div><div><small>Median line</small><b>${fmt(d.median)}</b></div><div><small>Line spread</small><b>${fmt(d.spread)}</b></div></div>
      ${d.quotes.length?`<div class="aiBookMap">${d.quotes.map(q=>`<article class="${q.stale?'stale':''}"><div><b>${esc(q.name)}</b><small>${q.stale?'Stale; excluded from summary':q.timestampKnown?date(q.at):'Update time unknown'}</small></div><div class="aiBookRange"><i style="left:${position(q)}%"></i></div><strong>${fmt(q.line)}</strong></article>`).join('')}</div>`:empty('No comparable quotes','Current main-line book quotes are required.')}
      <p class="aiNote">One main quote per book and side, for this event and market only. Quotes older than three hours are excluded from the summary. A missing timestamp is disclosed, not assumed fresh. Different lines do not establish value or a guaranteed execution price.</p>`;
  }
  function timeline(ctx,s,f) {
    const options=[...new Map(ctx.group.rows.map(q=>[q.sportsbookKey,q.sportsbook||q.sportsbookKey])).entries()];
    return `<div class="aiSectionHead"><div><p class="aiEyebrow">OBSERVED, NOT EXPLAINED AWAY</p><h4>What changed around this prop?</h4></div></div>
      <div class="aiControls"><label>History book<select id="aiHistoryBook">${options.map(([id,name])=>`<option value="${esc(id)}" ${ctx.book===id?'selected':''}>${esc(name)}</option>`).join('')}</select></label>${button('history',s.historyLoading.has(f.historyKey)?'Loading…':'Load stored timeline',s.historyLoading.has(f.historyKey)||!ctx.propId?'disabled':'')}</div>
      <p class="aiNote">${ctx.propId?'Line observations come from the existing stored history. Injury, lineup, estimate and game-status entries are recorded only when supplied and observed during this visit.':'This selection has no persisted prop ID. Stored line history cannot be requested.'}</p>
      ${s.historyError.has(f.historyKey)?'<p class="aiWarning" role="alert">Stored history could not load. Retry when the connection is available.</p>':''}
      ${f.stored&&!f.stored.configured?'<p class="aiNote">Stored history is not available for this selection.</p>':''}
      ${f.timeline.length?`<ol class="aiTimeline">${f.timeline.map(e=>`<li><span class="aiTimelineDot"></span><div><div class="aiTimelineMeta"><b>${esc(e.kind)}</b><time datetime="${esc(e.at)}">${date(e.at)}</time></div><strong>${esc(e.label)}</strong><p>${esc(e.detail)}</p></div></li>`).join('')}</ol>`:empty('No timeline observations yet','Load the stored line history. New verified context will appear when observed; an empty timeline is not evidence that nothing changed.')}
      <p class="aiDisclaimer">Events appearing near each other are correlated in time, not proven causes.</p>`;
  }
  function baseline(ctx) {
    const model=ctx.projection, estimate=ctx.base?.projectedStat;
    const value=model?.available?number(model.projection):number(estimate?.value);
    const rows=sample(ctx.base,ctx.line,ctx.side,'l20').rows;
    const basketball=['NBA','WNBA','NCAAB'].includes(ctx.group.sport);
    const countMarket=/^player_(points|rebounds|assists|threes|blocks|steals|turnovers|points_rebounds_assists|points_rebounds|points_assists|rebounds_assists|blocks_steals)$/.test(ctx.group.marketId||'');
    const minutes=basketball&&countMarket&&rows.length>=4&&rows.every(g=>number(g.minutes)!==null&&number(g.minutes)>0)?rows.reduce((a,g)=>a+number(g.minutes),0)/rows.length:null;
    return {value,label:model?.available?'Existing AI estimate':estimate?.source||'Existing recent-form estimate',minutes};
  }
  function scenario(ctx,s) {
    const b=baseline(ctx), result=scenarioLab({baseline:b.value,adjustmentPercent:s.adjustment,baselineMinutes:b.minutes,targetMinutes:b.minutes===null?null:s.targetMinutes});
    return `<div class="aiSectionHead"><div><p class="aiEyebrow">TRANSPARENT WHAT-IF</p><h4>Change the assumption. See the arithmetic.</h4></div><span class="aiPill">Hypothetical</span></div>
      ${b.value===null?empty('A baseline is required','Load verified game history or use the existing explicit projection action. A sportsbook line is never substituted for a projection.'):`<div class="aiStats"><div><small>${esc(b.label)}</small><b>${fmt(b.value)}</b></div><div><small>What-if output</small><output id="aiScenarioOutput">${fmt(result.adjusted)}</output></div><div><small>Change from baseline</small><output id="aiScenarioDelta">${sign(result.delta)}</output></div></div>
      <div class="aiScenarioControls"><label for="aiAdjustment">User-assumed rate adjustment <output id="aiAdjustmentLabel">${sign(s.adjustment)}%</output></label><input id="aiAdjustment" type="range" min="-50" max="50" step="1" value="${s.adjustment}"><div class="aiRangeLabels"><span>−50%</span><span>No change</span><span>+50%</span></div>
      ${b.minutes===null?'<p class="aiNote">Minutes scaling is available only for supported basketball counting stats with at least four complete minutes records.</p>':`<label for="aiMinutes">Hypothetical minutes <output id="aiMinutesLabel">${fmt(s.targetMinutes??b.minutes)}</output></label><input id="aiMinutes" type="range" min="0" max="60" step="0.5" value="${s.targetMinutes??b.minutes}"><p class="aiNote">Observed sample average: ${fmt(b.minutes)} minutes. Constant production per minute is an explicit simplifying assumption.</p>`}</div>
      <div class="aiFormula">baseline × (1 + adjustment ÷ 100)${b.minutes!==null?' × (target minutes ÷ baseline minutes)':''}</div>${button('reset-scenario','Reset assumptions')}`}
      <p class="aiDisclaimer">No automatic injury or teammate adjustment is inferred. This is a deterministic sensitivity calculation, not a new model prediction. It never changes sportsbook lines or game-log hit rates.</p>`;
  }
  function dependencies(ctx,s) {
    const rows=dependencyGraph(ctx.base), chosen=rows.find(r=>r.id===s.teammate)||rows[0];
    return `<div class="aiSectionHead"><div><p class="aiEyebrow">WITH / WITHOUT</p><h4>Teammate context, with receipts.</h4></div></div>
      ${!rows.length?empty('Verified participation history is missing','This response does not include game-by-game, explicitly verified teammate participation with both with/without samples. A current injury list cannot answer this question.'):`<div class="aiDependencyGraph"><div class="aiPlayerNode">${icon}<b>${esc(ctx.group.playerName)}</b></div><div class="aiConnections">${rows.slice(0,12).map(r=>`<button type="button" class="aiDependencyNode ${r.id===chosen.id?'on':''}" data-ai-mate="${esc(r.id)}"><b>${esc(r.name)}</b><span>${sign(r.delta)} without − with</span><small>${r.withGames} with / ${r.withoutGames} without</small></button>`).join('')}</div></div><div class="aiStats"><div><small>With ${esc(chosen.name)}</small><b>${fmt(chosen.withAverage)}</b><span>${chosen.withGames} games</span></div><div><small>Without</small><b>${fmt(chosen.withoutAverage)}</b><span>${chosen.withoutGames} games</span></div><div><small>Difference in averages</small><b>${sign(chosen.delta)}</b></div></div>${chosen.smallSample?'<p class="aiWarning">Small sample: fewer than five games in at least one group. Treat this comparison cautiously.</p>':''}`}
      <p class="aiNote">Only exact player IDs and explicit played/not-played observations qualify. Missing data is not absence. Minutes, opponent and role differences can confound this association.</p>${button('games','Inspect source game log →')}`;
  }
  function brief(ctx,s,f) {
    // A changed line/side must never leave a report about the old selection on screen.
    const sig=JSON.stringify([ctx.group.key,ctx.line,ctx.side,ctx.base?.coverage?.gamesReturned,ctx.base?.projectedStat?.value,f.timeline.length]);
    if(s.brief?.signature!==sig)s.brief=null;
    const report=s.brief?.report;
    return `<div class="aiSectionHead"><div><p class="aiEyebrow">TRACEABLE RESEARCH</p><h4>A brief you can check, not just trust.</h4></div></div>
      <p class="aiIntro">Summarize the loaded game logs, line comparisons and missing evidence. Each statement links to its source view. No AI credit or external request is used.</p>
      <div class="aiStats"><div><small>Usable game logs</small><b>${f.quality.games}</b></div><div><small>Evidence checks</small><b>${f.quality.passed}<small> / ${f.quality.total}</small></b></div><div><small>Comparable books</small><b>${f.distribution.books}</b></div></div>
      <div class="aiActions">${button('brief','Generate research brief →')}${report?button('copy','Copy brief'):''}</div>
      ${report?`<section class="aiReport" aria-label="Generated evidence brief"><h4>${esc(report.title)}</h4>${report.facts.map(x=>`<p><button type="button" class="aiCitation" data-ai-source="${x.section}">[${x.id}]</button> ${esc(x.text)}</p>`).join('')}<details open><summary>Missing evidence (${report.gaps.length})</summary><ul>${report.gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul></details><p class="aiDisclaimer">${esc(report.disclaimer)}</p></section>`:empty('Evidence first. Conclusions second.','Generate the brief after loading a player’s research. Missing inputs will be listed explicitly.')}`;
  }
  function body(ctx,s,f) {
    return ({brief:()=>brief(ctx,s,f),sensitivity:()=>sensitivity(ctx,s),evidence:()=>evidence(ctx,f),timeline:()=>timeline(ctx,s,f),market:()=>market(ctx,f),scenario:()=>scenario(ctx,s),dependencies:()=>dependencies(ctx,s)})[s.tab]();
  }
  function render(ctx) {
    current=ctx; observeContext(ctx);
    const s=state(ctx), f=facts(ctx);
    return `<section id="asIntelligence" class="aiWorkspace" aria-label="Auto Scout intelligence tools">${header(ctx,s)}<div class="aiContent">${body(ctx,s,f)}</div></section>`;
  }
  function repaint() {
    const root=document.getElementById('asIntelligence'); if(!root||!current)return;
    const active=document.activeElement, token=active?.id, tab=active?.dataset?.aiTab;
    const parent=root.parentElement; const holder=document.createElement('div');holder.innerHTML=render(current);root.replaceWith(holder.firstElementChild);bind(current);
    if(token)document.getElementById(token)?.focus({preventScroll:true});
    else if(tab)parent.querySelector(`[data-ai-tab="${tab}"]`)?.focus({preventScroll:true});
  }
  function updateScenario(ctx,s) {
    const b=baseline(ctx), result=scenarioLab({baseline:b.value,adjustmentPercent:s.adjustment,baselineMinutes:b.minutes,targetMinutes:b.minutes===null?null:s.targetMinutes});
    for(const [id,text] of [['aiScenarioOutput',fmt(result.adjusted)],['aiScenarioDelta',sign(result.delta)],['aiAdjustmentLabel',sign(s.adjustment)+'%'],['aiMinutesLabel',fmt(s.targetMinutes??b.minutes)]]){const el=document.getElementById(id);if(el)el.textContent=text;}
  }
  function bind(ctx) {
    current=ctx; const root=document.getElementById('asIntelligence');if(!root)return;
    const s=state(ctx);
    root.onclick=async e=>{
      const tab=e.target.closest('[data-ai-tab]');if(tab){s.tab=tab.dataset.aiTab;repaint();return;}
      const line=e.target.closest('[data-ai-line]');if(line){changeLine?.(number(line.dataset.aiLine));return;}
      const mate=e.target.closest('[data-ai-mate]');if(mate){s.teammate=mate.dataset.aiMate;repaint();return;}
      const source=e.target.closest('[data-ai-source]');if(source){if(source.dataset.aiSource==='games')openPanel?.('games');else{s.tab=source.dataset.aiSource;repaint();}return;}
      const action=e.target.closest('[data-ai-action]')?.dataset.aiAction;if(!action)return;
      if(action==='games'){openPanel?.('games');return;}
      if(action==='reset-scenario'){s.adjustment=0;s.targetMinutes=null;repaint();return;}
      if(action==='brief'){
        const f=facts(ctx);s.brief={signature:JSON.stringify([ctx.group.key,ctx.line,ctx.side,ctx.base?.coverage?.gamesReturned,ctx.base?.projectedStat?.value,f.timeline.length]),report:researchBrief({group:ctx.group,base:ctx.base,line:ctx.line,side:ctx.side,...f})};
        repaint();return;
      }
      if(action==='copy'){
        try{await navigator.clipboard.writeText(s.brief?.report.text||'');notify('Research brief copied.');}
        catch{notify('Clipboard unavailable. Select the report text to copy it.');}return;
      }
      if(action==='history'&&ctx.propId&&loadHistory){
        const key=facts(ctx).historyKey;if(s.historyLoading.has(key))return;
        s.historyLoading.add(key);s.historyError.delete(key);repaint();
        try{s.history.set(key,await loadHistory(ctx));}catch{s.historyError.add(key);}
        finally{s.historyLoading.delete(key);if(current?.group.key===ctx.group.key&&facts(current).historyKey===key&&s.tab==='timeline')repaint();}
      }
    };
    root.onchange=e=>{
      if(e.target.id==='aiWindow'){s.window=e.target.value;repaint();}
      if(e.target.id==='aiStep'){s.step=Number(e.target.value);repaint();}
      if(e.target.id==='aiHistoryBook'){current={...current,book:e.target.value};repaint();}
    };
    root.oninput=e=>{
      if(e.target.id==='aiAdjustment'){s.adjustment=Number(e.target.value);updateScenario(ctx,s);}
      if(e.target.id==='aiMinutes'){s.targetMinutes=Number(e.target.value);updateScenario(ctx,s);}
    };
    root.querySelector('.aiTabs').onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      const target=e.target.closest('[data-ai-tab]');if(!target)return;e.preventDefault();
      const i=tabs.findIndex(t=>t[0]===target.dataset.aiTab), next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
      s.tab=tabs[next][0];repaint();document.querySelector(`[data-ai-tab="${s.tab}"]`)?.focus();
    };
  }
  function renderRadar(groups = latestGroups, { sport = latestSport, stale = latestMeta.stale } = {}) {
    const root=document.getElementById('asIntelligenceRadar');if(!root)return;
    const allowed=new Set(groups.map(g=>g.key));
    const events=radar.events(sport).filter(e=>allowed.has(e.groupKey)).slice(0,6);
    const disagreements=groups.map(g=>({g,d:bookDistribution(g.rows,{side:g.rows.some(r=>r.side==='OVER')?'OVER':'UNDER'})})).filter(x=>x.d.available&&x.d.spread>0).slice(0,6);
    root.innerHTML=`<details class="aiRadar" ${root.dataset.expanded==='true'?'open':''}><summary><span class="aiMark">${icon}</span><div><p class="aiEyebrow">AUTO SCOUT INTELLIGENCE</p><h2>Prop Change Radar <span>${events.length} recent changes</span></h2></div><span class="aiRadarStatus">${stale?'Stale snapshot':'Observed snapshots'}</span><span class="aiRadarChevron">⌄</span></summary>
    <div class="aiRadarBody"><p>Changes seen during this visit, plus current cross-book differences. Refresh uses the existing board request; there is no new background polling.</p>
    ${stale?'<p class="aiWarning">The latest refresh failed or returned a stale snapshot. No new change is inferred.</p>':''}
    ${events.length?`<div class="aiRadarGrid">${events.map(e=>`<button type="button" data-ai-open="${esc(e.groupKey)}"><small>${esc(e.kind)} · ${esc(e.book)}</small><b>${esc(e.player)}</b><span>${esc(e.market)} · ${esc(e.side)}</span><strong>${e.from===null?'New':fmt(e.from)} → ${e.to===null?'Not returned':fmt(e.to)}</strong><time>${date(e.at)}</time><em>Inspect change →</em></button>`).join('')}</div>`:'<p class="aiRadarEmpty">No line changes have been observed during this visit yet. Current differences below are comparisons, not movement alerts.</p>'}
    ${disagreements.length?`<h3>Books disagree now</h3><div class="aiRadarGrid">${disagreements.map(({g,d})=>`<button type="button" data-ai-open="${esc(g.key)}"><small>Snapshot comparison · ${d.books} books</small><b>${esc(g.playerName)}</b><span>${esc(g.market)} · ${d.side}</span><strong>${fmt(d.min)} – ${fmt(d.max)}</strong><em>Inspect book map →</em></button>`).join('')}</div>`:empty('No cross-book spread in this selection','Try another market or keep researching. Equal lines and limited book coverage are not errors.')}
    <p class="aiNote">The radar does not rank props by win probability. New entries mean newly returned by this feed, not necessarily newly created by a bookmaker. Missing offers from partial snapshots are never reported as removals.</p></div></details>`;
    const details=root.querySelector('details');details.ontoggle=()=>{root.dataset.expanded=String(details.open);};
    root.onclick=e=>{const b=e.target.closest('[data-ai-open]');if(!b)return;const g=groups.find(g=>g.key===b.dataset.aiOpen);if(g){const s=state({group:g});s.tab=b.textContent.includes('Snapshot comparison')?'market':'timeline';openProp?.(g);}};
  }
  return { render,bind,renderRadar,
    observe(groups,meta={}){latestGroups=groups;latestSport=meta.sport;latestMeta=meta;radar.observe(groups,meta);},
    close(){current=null;},reset(){current=null;states.clear();radar.clear();},
  };
}
