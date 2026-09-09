import {
  display,
  esc,
  finiteOrNull,
  fmtDateTime,
  fmtTime,
  renderPropCardsMarkup,
} from './props-presenter.mjs';

const $ = (id) => document.getElementById(id);
const RULES_PREF = 'scout-pro:rules';
const LIMIT_PREF = 'scout-pro:page-size';
const PAGE_SIZES = new Set([25, 50, 100]);
const paramsAtLoad = new URLSearchParams(location.search);

function storedRules() {
  try { return localStorage.getItem(RULES_PREF) === '1'; } catch { return false; }
}
function storedLimit() {
  try {
    const value = Number(localStorage.getItem(LIMIT_PREF));
    return PAGE_SIZES.has(value) ? value : 25;
  } catch { return 25; }
}
function readFiltersFromUrl() {
  const p = new URLSearchParams(location.search);
  const list = (key) => String(p.get(key) || '').split(',').map((value) => value.trim()).filter(Boolean);
  const number = (key) => p.get(key) === null || p.get(key) === '' ? null : finiteOrNull(p.get(key));
  return {
    search: p.get('q') || '', sports: list('sports'), markets: list('markets'),
    side: ['OVER','UNDER'].includes(String(p.get('side') || '').toUpperCase()) ? String(p.get('side')).toUpperCase() : 'ALL',
    timeWindow: p.get('timeWindow') || 'TODAY', minScore: number('minScore'), minHitRate: number('minHitRate'),
    hitRateWindow: p.get('hitRateWindow') || 'l10', minProjectionEdge: number('minProjectionEdge'),
    minExpectedMinutes: number('minExpectedMinutes'), startersOnly: p.get('startersOnly') === '1',
    excludeInjured: p.get('excludeInjured') === '1', applyScoutRules: p.has('rules') ? p.get('rules') === '1' : storedRules(),
  };
}

const requestedLimit = Number(paramsAtLoad.get('limit'));
const initialLimit = PAGE_SIZES.has(requestedLimit) ? requestedLimit : storedLimit();
const initialPage = Math.max(1, Number(paramsAtLoad.get('page')) || 1);
const state = {
  mode: paramsAtLoad.get('mode') === 'best' ? 'best' : 'all', sort: paramsAtLoad.get('sort') || 'score-desc',
  filters: readFiltersFromUrl(), limit: initialLimit, page: initialPage, offset: (initialPage - 1) * initialLimit,
  loading: false, lastPayload: null, sports: new Set(), debounce: null,
};

function savePreferences() {
  try {
    localStorage.setItem(RULES_PREF, state.filters.applyScoutRules ? '1' : '0');
    localStorage.setItem(LIMIT_PREF, String(state.limit));
  } catch {}
}
function buildQuery({ includePaging = true } = {}) {
  const p = new URLSearchParams(); const f = state.filters;
  if (f.search) p.set('q', f.search);
  if (f.sports?.length) p.set('sports', f.sports.join(','));
  if (f.markets?.length) p.set('markets', f.markets.join(','));
  if (f.side && f.side !== 'ALL') p.set('side', f.side);
  if (f.timeWindow && f.timeWindow !== 'ALL') p.set('timeWindow', f.timeWindow);
  if (Number.isFinite(f.minScore)) p.set('minScore', String(f.minScore));
  if (Number.isFinite(f.minHitRate)) p.set('minHitRate', String(f.minHitRate));
  if (f.hitRateWindow && f.hitRateWindow !== 'l10') p.set('hitRateWindow', f.hitRateWindow);
  if (Number.isFinite(f.minProjectionEdge)) p.set('minProjectionEdge', String(f.minProjectionEdge));
  if (Number.isFinite(f.minExpectedMinutes)) p.set('minExpectedMinutes', String(f.minExpectedMinutes));
  if (f.startersOnly) p.set('startersOnly', '1');
  if (f.excludeInjured) p.set('excludeInjured', '1');
  if (f.applyScoutRules) p.set('rules', '1');
  if (state.mode === 'all') p.set('sort', state.sort);
  if (includePaging) { p.set('limit', String(state.limit)); if (state.offset > 0) p.set('offset', String(state.offset)); }
  return p;
}
function syncUrl() {
  const p = buildQuery({ includePaging: false });
  if (state.mode === 'best') p.set('mode', 'best');
  if (state.mode === 'all' && state.sort !== 'score-desc') p.set('sort', state.sort);
  if (state.limit !== 25) p.set('limit', String(state.limit));
  if (state.page > 1) p.set('page', String(state.page));
  history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
}
async function api(url) {
  const response = await fetch(url, { credentials:'same-origin', headers:{accept:'application/json'} });
  const body = await response.json().catch(() => null);
  if (response.status === 401) { location.href='/'; throw new Error('Authentication required'); }
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body;
}
function providerLabel(data) {
  const universe = data?.universe;
  if (universe?.sourceMode === 'provider-native') return `SportsDataIO · ${(finiteOrNull(universe.providerNative) ?? 0).toLocaleString()} rows`;
  if (universe?.sourceMode === 'pickfinder-fallback') return 'Fallback research board';
  return 'Checking source';
}
async function loadProviders() {
  try {
    const data = await api('/api/providers'); const provider = (data.providers || []).find((row) => row.id === 'sportsdataio');
    const pill = $('providerPill'); const status = String(provider?.status || '').toLowerCase();
    pill.textContent = status === 'active' ? 'SportsDataIO · live' : `Sports data · ${status || 'checking'}`;
    pill.classList.toggle('active', status === 'active');
  } catch { $('providerPill').textContent = 'Sports data · checking'; }
}
function resetPage() { state.page = 1; state.offset = 0; }
function setMode(mode, { load = true } = {}) {
  state.mode = mode === 'best' ? 'best' : 'all'; resetPage();
  document.querySelectorAll('.mode-tab').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
  $('resultLabel').textContent = state.mode === 'best' ? 'AUTO PROP FINDER' : 'ALL PROPS';
  $('sortSelect').disabled = state.mode === 'best'; syncUrl(); if (load) loadProps({ reset:true });
}

async function loadProps({ reset = false } = {}) {
  if (state.loading) return;
  if (reset) resetPage();
  state.loading = true; $('refreshBtn').disabled = true; renderLoading();
  try {
    const endpoint = state.mode === 'best' ? '/api/props/best' : '/api/props';
    const data = await api(`${endpoint}?${buildQuery()}`);
    const rows = state.mode === 'best' ? (data.ranked || []) : (data.props || []);
    state.lastPayload = data;
    for (const prop of rows) if (prop?.sport) state.sports.add(String(prop.sport).toUpperCase());
    for (const row of data?.universe?.providerCoverage || []) if ((finiteOrNull(row.offerCount) ?? 0) > 0 && row.sport) state.sports.add(String(row.sport).toUpperCase());
    renderSportChips(); renderSummary(data, rows); renderProps(rows); renderFilterChips(); renderPagination(data, rows); syncUrl();
  } catch (error) {
    showNotice(error?.message || 'Props could not be loaded.', true);
    $('propGrid').innerHTML = '<div class="empty-state"><b>Prop board unavailable</b>Retry or check provider health.</div>';
    $('pagination').hidden = true;
  } finally { state.loading = false; $('refreshBtn').disabled = false; }
}
function renderLoading() {
  $('notice').hidden = true;
  $('propGrid').innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  $('resultCount').textContent = 'Loading…'; $('showingCount').textContent = '—';
}
function renderSummary(data, rows) {
  const counts = data?.counts || {}; const available = finiteOrNull(counts.matching) ?? 0; const qualified = finiteOrNull(counts.qualifiers) ?? 0; const filtered = finiteOrNull(counts.filtered) ?? rows.length;
  $('availableCount').textContent = available.toLocaleString(); $('qualifiedCount').textContent = qualified.toLocaleString();
  $('resultCount').textContent = `${filtered.toLocaleString()} ${filtered === 1 ? 'prop' : 'props'}`; $('showingCount').textContent = rows.length.toLocaleString();
  $('sourceStatus').textContent = providerLabel(data); $('lastScan').textContent = data?.universe?.providerFetchedAt ? fmtTime(data.universe.providerFetchedAt) : (data?.scannedAt ? fmtTime(data.scannedAt) : '—');
  $('dataSummary').textContent = state.filters.applyScoutRules ? `${qualified.toLocaleString()} pass Scout Rules` : `${available.toLocaleString()} valid main-line props`;
  if (state.filters.applyScoutRules && available > 0 && filtered === 0) return showNotice(`${available.toLocaleString()} props are available. 0 currently pass Scout Rules. Turn Rules OFF to browse the full board.`, false, true);
  if (data?.emptyReason && filtered === 0) return showNotice('No props match these filters.', false);
  if (data?.universe?.providerError) return showNotice('Provider data is partially degraded. Showing available verified rows.', false);
  $('notice').hidden = true;
}
function renderPagination(data, rows) {
  const total = finiteOrNull(data?.counts?.filtered) ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / state.limit));
  state.page = Math.min(Math.max(1, Math.floor(state.offset / state.limit) + 1), pages);
  $('pagination').hidden = state.mode === 'best' || total <= state.limit;
  $('pageLabel').textContent = `Page ${state.page} of ${pages}`;
  $('prevPageBtn').disabled = state.page <= 1;
  $('nextPageBtn').disabled = state.page >= pages || rows.length === 0;
}
function showNotice(message, isError = false, offerRulesOff = false) {
  const node = $('notice'); node.hidden = false; node.dataset.kind = isError ? 'error' : 'info';
  node.innerHTML = `${esc(message)}${offerRulesOff ? ' <button class="notice-action" id="viewAllPropsAction" type="button">View All Props</button>' : ''}`;
  $('viewAllPropsAction')?.addEventListener('click', () => { state.filters.applyScoutRules=false; savePreferences(); syncControlsFromState(); loadProps({reset:true}); });
}
function renderSportChips() {
  const selected = new Set((state.filters.sports || []).map((sport) => String(sport).toUpperCase())); const sports = [...state.sports].sort();
  $('sportChips').innerHTML = `<button class="quick-chip ${selected.size===0?'active':''}" data-sport="" type="button">All</button>` + sports.map((sport)=>`<button class="quick-chip ${selected.has(sport)?'active':''}" data-sport="${esc(sport)}" type="button">${esc(sport)}</button>`).join('');
}
function renderProps(rows) {
  const grid = $('propGrid');
  if (!rows.length) { grid.innerHTML='<div class="empty-state"><b>No props to show</b>Change a filter, turn Scout Rules off, or refresh the board.</div>'; return; }
  grid.innerHTML = renderPropCardsMarkup(rows, { mode:state.mode, offset:state.offset });
}
function renderFilterChips() {
  const chips=[]; const f=state.filters;
  if(f.search)chips.push(['search',`“${f.search}”`]); for(const sport of f.sports||[])chips.push(['sports',sport,sport]); if(f.side!=='ALL')chips.push(['side',f.side]); if(f.timeWindow==='TODAY')chips.push(['timeWindow','Today']); if(Number.isFinite(f.minScore))chips.push(['minScore',`Score ${f.minScore}+`]); if(Number.isFinite(f.minHitRate))chips.push(['minHitRate',`${String(f.hitRateWindow).toUpperCase()} ${f.minHitRate}%+`]); if(Number.isFinite(f.minProjectionEdge))chips.push(['minProjectionEdge',`Projection edge ${f.minProjectionEdge}+`]); if(Number.isFinite(f.minExpectedMinutes))chips.push(['minExpectedMinutes',`${f.minExpectedMinutes}+ min`]); if(f.startersOnly)chips.push(['startersOnly','Starters']); if(f.excludeInjured)chips.push(['excludeInjured','No out/doubtful']); if(f.applyScoutRules)chips.push(['applyScoutRules','Scout Rules ON']);
  const container=$('activeChips'); container.hidden=chips.length===0; container.innerHTML=chips.map(([id,label,value])=>`<span class="active-chip">${esc(label)}<button type="button" data-clear-filter="${esc(id)}" ${value?`data-clear-value="${esc(value)}"`:''}>×</button></span>`).join(''); $('filterCount').textContent=String(chips.filter(([id])=>!['timeWindow','applyScoutRules'].includes(id)).length);
}
function clearFilter(id,value=null){if(id==='sports')state.filters.sports=value?state.filters.sports.filter((sport)=>String(sport).toUpperCase()!==String(value).toUpperCase()):[];else if(id==='search'){state.filters.search='';$('searchInput').value='';}else if(id==='side')state.filters.side='ALL';else if(id==='timeWindow')state.filters.timeWindow='ALL';else if(id==='minScore')state.filters.minScore=null;else if(id==='minHitRate')state.filters.minHitRate=null;else if(id==='minProjectionEdge')state.filters.minProjectionEdge=null;else if(id==='minExpectedMinutes')state.filters.minExpectedMinutes=null;else if(id==='startersOnly')state.filters.startersOnly=false;else if(id==='excludeInjured')state.filters.excludeInjured=false;else if(id==='applyScoutRules')state.filters.applyScoutRules=false;savePreferences();syncControlsFromState();loadProps({reset:true});}
function openSheet(){syncControlsFromState();$('filterSheet').classList.add('open');$('filterSheet').setAttribute('aria-hidden','false');document.body.style.overflow='hidden';}
function closeSheet(){$('filterSheet').classList.remove('open');$('filterSheet').setAttribute('aria-hidden','true');document.body.style.overflow='';}
function syncControlsFromState(){ $('searchInput').value=state.filters.search||'';$('rulesToggle').checked=Boolean(state.filters.applyScoutRules);$('rulesState').textContent=state.filters.applyScoutRules?'ON':'OFF';$('sideFilter').value=state.filters.side||'ALL';$('minScoreFilter').value=state.filters.minScore??'';$('minHitRateFilter').value=state.filters.minHitRate??'';$('hitWindowFilter').value=state.filters.hitRateWindow||'l10';$('minProjectionEdgeFilter').value=state.filters.minProjectionEdge??'';$('minMinutesFilter').value=state.filters.minExpectedMinutes??'';$('excludeInjuredFilter').checked=Boolean(state.filters.excludeInjured);$('startersOnlyFilter').checked=Boolean(state.filters.startersOnly);$('todayOnlyFilter').checked=state.filters.timeWindow==='TODAY';$('sortSelect').value=state.sort;$('resultLimit').value=String(state.limit);renderFilterChips();renderSportChips(); }
function readSheetIntoState(){const n=(id)=>finiteOrNull($(id).value.trim());state.filters.side=$('sideFilter').value;state.filters.minScore=n('minScoreFilter');state.filters.minHitRate=n('minHitRateFilter');state.filters.hitRateWindow=$('hitWindowFilter').value;state.filters.minProjectionEdge=n('minProjectionEdgeFilter');state.filters.minExpectedMinutes=n('minMinutesFilter');state.filters.excludeInjured=$('excludeInjuredFilter').checked;state.filters.startersOnly=$('startersOnlyFilter').checked;state.filters.timeWindow=$('todayOnlyFilter').checked?'TODAY':'ALL';}
function resetFilters(){state.filters={search:'',sports:[],markets:[],side:'ALL',timeWindow:'TODAY',minScore:null,minHitRate:null,hitRateWindow:'l10',minProjectionEdge:null,minExpectedMinutes:null,startersOnly:false,excludeInjured:false,applyScoutRules:false};savePreferences();syncControlsFromState();closeSheet();loadProps({reset:true});}

async function openDetail(id){const dialog=$('detailDialog');$('detailBody').innerHTML='<div class="detail-loading">Loading player intelligence…</div>';if(!dialog.open)dialog.showModal();try{renderDetail(await api(`/api/props/detail?id=${encodeURIComponent(id)}`));}catch(error){$('detailBody').innerHTML=`<div class="empty-state"><b>Detail unavailable</b>${esc(error?.message||'Try again.')}</div>`;}}
function renderDetail(data){const prop=data?.prop||{};const breakdown=data?.scoreBreakdown||prop.scoreBreakdown||{};const factors=Array.isArray(breakdown.factors)?breakdown.factors:[];const analytics=data?.analytics||null;const windows=analytics?.windows||{};const gameLog=Array.isArray(analytics?.gameLog)?analytics.gameLog:[];const failures=Array.isArray(prop?.ruleResults?.failures)?prop.ruleResults.failures:[];const source=prop.sourceLabel||prop.sportsbook||prop.provider||'Source unavailable';$('detailBody').innerHTML=`<div class="detail-hero"><span class="eyebrow">${esc(prop.sport||'PROP')} · ${prop.gameStartTime?esc(fmtDateTime(prop.gameStartTime)):'TIME —'}</span><h2>${esc(prop.playerName||'Player')}</h2><p>${esc(prop.marketDisplayName||prop.market||'Prop')} ${display(prop.line)} · ${esc(prop.side||'')}${prop.opponent?` · vs ${esc(prop.opponent)}`:''}</p><small>${esc(source)} · updated ${prop.updatedAt?esc(fmtDateTime(prop.updatedAt)):'—'}</small></div><div class="detail-score-row"><div class="detail-score"><strong>${display(prop.score)}</strong><span>Scout Score</span></div><div><b>${esc(prop.qualityTier||'Evidence incomplete')}</b><p>${breakdown.dataCoverage!==null&&breakdown.dataCoverage!==undefined?`${esc(breakdown.dataCoverage)}% model coverage`:'Coverage unavailable'}</p></div></div>${analytics?`<section class="detail-section"><h3>Historical performance vs this line</h3><div class="window-grid">${['l5','l10','l15','l20','season'].map((id)=>{const row=windows[id];return `<div><span>${esc(row?.label||id.toUpperCase())}</span><b>${row?.hitRate===null||row?.hitRate===undefined?'N/A':`${esc(row.hitRate)}%`}</b><small>${row?.average===null||row?.average===undefined?'No average':`Avg ${esc(row.average)} · ${esc(row.sampleSize??row.games??0)} games`}</small></div>`;}).join('')}</div>${gameLog.length?`<div class="game-log">${gameLog.slice(0,20).map((game)=>`<div><span>${esc(game.date||'Game')} ${game.opponent?`· ${esc(game.opponent)}`:''}</span><b>${display(game.value)}</b><small>${game.hit===true?'HIT':game.hit===false?'MISS':'PUSH'}</small></div>`).join('')}</div>`:''}</section>`:''}<section class="detail-section"><h3>Scout Rules audit</h3>${prop.ruleResults?.qualified===true?'<p class="muted">This prop passed the active Scout evidence requirements.</p>':failures.length?`<div class="factor-list">${failures.map((reason)=>`<div class="factor-row"><div><b>Not qualified</b><small>${esc(reason)}</small></div><span>FAIL</span></div>`).join('')}</div>`:'<p class="muted">Rule evidence is incomplete for this source.</p>'}</section><section class="detail-section"><h3>Why this score</h3><div class="factor-list">${factors.length?factors.map((factor)=>`<div class="factor-row"><div><b>${esc(factor.label||factor.id)}</b><small>${esc(factor.explanation||factor.detail||'')}${factor.source?` · ${esc(factor.source)}`:''}</small></div><span>${factor.available===false?'N/A':display(factor.contribution??factor.points)}</span></div>`).join(''):'<p class="muted">No score breakdown is available.</p>'}</div></section>`;}

function goPage(delta){const total=finiteOrNull(state.lastPayload?.counts?.filtered)??0;const pages=Math.max(1,Math.ceil(total/state.limit));const next=Math.max(1,Math.min(pages,state.page+delta));if(next===state.page)return;state.page=next;state.offset=(next-1)*state.limit;loadProps().then(()=>window.scrollTo({top:document.querySelector('.results-head')?.offsetTop-90||0,behavior:'smooth'}));}
function bind(){document.querySelectorAll('.mode-tab').forEach((button)=>button.addEventListener('click',()=>setMode(button.dataset.mode)));$('sortSelect').addEventListener('change',()=>{state.sort=$('sortSelect').value;loadProps({reset:true});});$('resultLimit').addEventListener('change',()=>{const value=Number($('resultLimit').value);state.limit=PAGE_SIZES.has(value)?value:25;savePreferences();loadProps({reset:true});});$('searchInput').addEventListener('input',()=>{state.filters.search=$('searchInput').value.trim();clearTimeout(state.debounce);state.debounce=setTimeout(()=>loadProps({reset:true}),220);});$('rulesToggle').addEventListener('change',()=>{state.filters.applyScoutRules=$('rulesToggle').checked;$('rulesState').textContent=state.filters.applyScoutRules?'ON':'OFF';savePreferences();loadProps({reset:true});});$('sportChips').addEventListener('click',(event)=>{const button=event.target.closest('[data-sport]');if(!button)return;const sport=String(button.dataset.sport||'').toUpperCase();state.filters.sports=sport?[sport]:[];loadProps({reset:true});});$('activeChips').addEventListener('click',(event)=>{const button=event.target.closest('[data-clear-filter]');if(button)clearFilter(button.dataset.clearFilter,button.dataset.clearValue||null);});[$('openFiltersBtn'),$('mobileFiltersBtn')].forEach((button)=>button.addEventListener('click',openSheet));document.querySelectorAll('[data-close-sheet]').forEach((button)=>button.addEventListener('click',closeSheet));$('applyFiltersBtn').addEventListener('click',()=>{readSheetIntoState();closeSheet();loadProps({reset:true});});$('resetFiltersBtn').addEventListener('click',resetFilters);$('refreshBtn').addEventListener('click',()=>{loadProviders();loadProps({reset:true});});$('prevPageBtn').addEventListener('click',()=>goPage(-1));$('nextPageBtn').addEventListener('click',()=>goPage(1));$('propGrid').addEventListener('click',(event)=>{const card=event.target.closest('[data-prop-id]');if(card)openDetail(card.dataset.propId);});$('propGrid').addEventListener('keydown',(event)=>{if(!['Enter',' '].includes(event.key))return;const card=event.target.closest('[data-prop-id]');if(card){event.preventDefault();openDetail(card.dataset.propId);}});$('detailClose').addEventListener('click',()=>$('detailDialog').close());$('detailDialog').addEventListener('click',(event)=>{if(event.target===$('detailDialog'))$('detailDialog').close();});}

bind();savePreferences();syncControlsFromState();setMode(state.mode,{load:false});loadProviders();loadProps();
