const $ = (id) => document.getElementById(id);

const state = {
  mode: new URLSearchParams(location.search).get('mode') === 'best' ? 'best' : 'all',
  sort: new URLSearchParams(location.search).get('sort') || 'score-desc',
  filters: readFiltersFromUrl(),
  offset: 0,
  limit: 100,
  loading: false,
  lastPayload: null,
  sports: new Set(),
  debounce: null,
};

function readFiltersFromUrl() {
  const p = new URLSearchParams(location.search);
  const list = (key) => String(p.get(key) || '').split(',').map((v) => v.trim()).filter(Boolean);
  const number = (key) => p.get(key) === null || p.get(key) === '' ? null : Number(p.get(key));
  const hasAnyFilter = [...p.keys()].some((key) => !['mode', 'sort'].includes(key));
  return {
    search: p.get('q') || '',
    sports: list('sports'),
    markets: list('markets'),
    side: ['OVER', 'UNDER'].includes(String(p.get('side') || '').toUpperCase()) ? String(p.get('side')).toUpperCase() : 'ALL',
    timeWindow: p.get('timeWindow') || (hasAnyFilter ? 'ALL' : 'TODAY'),
    minScore: finiteOrNull(number('minScore')),
    minHitRate: finiteOrNull(number('minHitRate')),
    hitRateWindow: p.get('hitRateWindow') || 'l10',
    minProjectionEdge: finiteOrNull(number('minProjectionEdge')),
    minExpectedMinutes: finiteOrNull(number('minExpectedMinutes')),
    startersOnly: p.get('startersOnly') === '1',
    excludeInjured: p.get('excludeInjured') === '1',
    applyScoutRules: p.get('rules') === '1',
  };
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function display(value, suffix = '') {
  return value === null || value === undefined || value === '' ? '—' : `${esc(value)}${suffix}`;
}

function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
}

function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

function bestHitRate(prop) {
  const values = Object.values(prop?.hitRates || {}).map(finiteOrNull).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

function projectionEdge(prop) {
  const projection = finiteOrNull(prop?.projection);
  const line = finiteOrNull(prop?.line);
  if (projection === null || line === null) return null;
  return String(prop.side).toUpperCase() === 'UNDER' ? line - projection : projection - line;
}

function setMode(mode, { load = true } = {}) {
  state.mode = mode === 'best' ? 'best' : 'all';
  state.offset = 0;
  document.querySelectorAll('.mode-tab').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
  $('resultLabel').textContent = state.mode === 'best' ? 'AUTO PROP FINDER' : 'ALL PROPS';
  $('sortSelect').disabled = state.mode === 'best';
  syncUrl();
  if (load) loadProps({ reset: true });
}

function buildQuery({ includePaging = true } = {}) {
  const p = new URLSearchParams();
  const f = state.filters;
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
  if (includePaging) {
    p.set('limit', String(state.limit));
    if (state.offset > 0) p.set('offset', String(state.offset));
  }
  return p;
}

function syncUrl() {
  const p = buildQuery({ includePaging: false });
  if (state.mode === 'best') p.set('mode', 'best');
  if (state.mode === 'all' && state.sort !== 'score-desc') p.set('sort', state.sort);
  const next = `${location.pathname}${p.toString() ? `?${p}` : ''}`;
  history.replaceState(null, '', next);
}

async function api(url) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.status === 401) {
    location.href = '/';
    throw new Error('Authentication required');
  }
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body;
}

async function loadProviders() {
  try {
    const data = await api('/api/providers');
    const provider = (data.providers || []).find((row) => row.id === 'sportsdataio');
    const status = String(provider?.status || '').toLowerCase();
    const pill = $('providerPill');
    if (!provider) {
      pill.textContent = 'Sports data · unavailable';
      pill.classList.remove('active');
      return;
    }
    if (status === 'active') {
      pill.textContent = 'SportsDataIO · live';
      pill.classList.add('active');
    } else if (status === 'not-configured') {
      pill.textContent = 'Sports data · not connected';
      pill.classList.remove('active');
    } else {
      pill.textContent = `Sports data · ${status || 'checking'}`;
      pill.classList.remove('active');
    }
  } catch {
    $('providerPill').textContent = 'Sports data · checking';
  }
}

async function loadProps({ reset = false, append = false } = {}) {
  if (state.loading) return;
  if (reset) state.offset = 0;
  state.loading = true;
  $('refreshBtn').disabled = true;
  if (reset) renderLoading();
  try {
    const endpoint = state.mode === 'best' ? '/api/props/best' : '/api/props';
    const data = await api(`${endpoint}?${buildQuery()}`);
    const rows = state.mode === 'best' ? (data.ranked || []) : (data.props || []);
    state.lastPayload = data;
    rows.forEach((prop) => { if (prop.sport) state.sports.add(String(prop.sport).toUpperCase()); });
    renderSportChips();
    renderSummary(data);
    renderProps(rows, { append });
    renderFilterChips();
    syncUrl();
    const totalFiltered = finiteOrNull(data?.counts?.filtered) ?? rows.length;
    const shown = state.offset + rows.length;
    $('loadMoreBtn').hidden = state.mode === 'best' || shown >= totalFiltered || rows.length === 0;
  } catch (error) {
    showNotice(error?.message || 'Props could not be loaded.', true);
    if (reset) $('propGrid').innerHTML = '<div class="empty-state"><b>Props unavailable</b>Refresh the page or return to the dashboard and run a scan.</div>';
  } finally {
    state.loading = false;
    $('refreshBtn').disabled = false;
  }
}

function renderLoading() {
  $('notice').hidden = true;
  $('propGrid').innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  $('resultCount').textContent = 'Loading…';
}

function renderSummary(data) {
  const counts = data?.counts || {};
  const count = finiteOrNull(counts.filtered ?? counts.matching) ?? 0;
  $('resultCount').textContent = `${count.toLocaleString()} ${count === 1 ? 'prop' : 'props'}`;
  $('lastScan').textContent = data?.scannedAt ? fmtTime(data.scannedAt) : '—';
  const qualifiers = finiteOrNull(counts.qualifiers) ?? 0;
  $('dataSummary').textContent = state.filters.applyScoutRules ? `${qualifiers.toLocaleString()} Scout qualifiers` : `${qualifiers.toLocaleString()} pass Scout Rules`;

  if (data?.emptyReason && count === 0) {
    const suggestions = (data.emptyReason.suggestions || []).map((row) => row.id).slice(0, 2);
    showNotice(suggestions.length ? `No props match. Try relaxing ${suggestions.join(' or ')}.` : 'No props match these filters.', false);
  } else {
    $('notice').hidden = true;
  }
}

function renderSportChips() {
  const container = $('sportChips');
  const selected = new Set((state.filters.sports || []).map((s) => String(s).toUpperCase()));
  const sports = [...state.sports].sort();
  container.innerHTML = `<button class="quick-chip ${selected.size === 0 ? 'active' : ''}" data-sport="" type="button">All</button>` +
    sports.map((sport) => `<button class="quick-chip ${selected.has(sport) ? 'active' : ''}" data-sport="${esc(sport)}" type="button">${esc(sport)}</button>`).join('');
}

function renderProps(rows, { append = false } = {}) {
  const grid = $('propGrid');
  if (!rows.length && !append) {
    grid.innerHTML = '<div class="empty-state"><b>No props found</b>Change a filter, turn Scout Rules off, or run a fresh scan from the dashboard.</div>';
    return;
  }
  const html = rows.map((prop, index) => propCard(prop, state.mode === 'best' ? (prop.rank || state.offset + index + 1) : null)).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html); else grid.innerHTML = html;
}

function propCard(prop, rank) {
  const hit = bestHitRate(prop);
  const projEdge = projectionEdge(prop);
  const score = finiteOrNull(prop.score);
  const tier = String(prop.qualityTier || '').toLowerCase();
  const badges = [];
  if (prop.injuryStatus) badges.push(`<span class="context-badge ${String(prop.injuryStatus).toUpperCase() === 'ACTIVE' ? 'good' : ''}">${esc(prop.injuryStatus)}</span>`);
  if (prop.lineupStatus) badges.push(`<span class="context-badge good">${esc(prop.lineupStatus)} lineup</span>`);
  if (prop.liveStatus === 'LIVE') badges.push('<span class="context-badge good">LIVE</span>');
  if (prop.ruleResults?.qualified === true) badges.push('<span class="context-badge good">Rules pass</span>');
  return `<article class="prop-card" tabindex="0" role="button" data-prop-id="${esc(prop.id)}" aria-label="Open ${esc(prop.playerName)} ${esc(prop.market)} details">
    ${rank ? `<span class="rank-badge">#${rank}</span>` : ''}
    <div class="prop-top">
      <div class="player-block"><small>${esc(prop.sport || 'SPORT')} · ${prop.gameStartTime ? fmtTime(prop.gameStartTime) : 'TODAY'}</small><h3>${esc(prop.playerName || 'Player')}</h3><p>${prop.team ? esc(prop.team) : 'Team unavailable'}${prop.opponent ? ` · vs ${esc(prop.opponent)}` : ''}</p></div>
      <div class="score-badge ${tier === 'elite' || tier === 'strong' ? 'elite' : ''}"><strong>${score ?? '—'}</strong><small>Scout</small></div>
    </div>
    <div class="market-line"><div><b>${esc(prop.market || 'Prop')} · ${display(prop.line)}</b><small>${prop.projection !== null && prop.projection !== undefined ? `Projection ${display(prop.projection)} · ${esc(prop.projectionSource || 'provider')}` : 'Projection unavailable'}</small></div><span class="side-pill ${String(prop.side).toLowerCase()}">${esc(prop.side || '—')}</span></div>
    <div class="metrics">
      <div class="metric"><span>Best hit</span><b>${hit === null ? '—' : `${hit}%`}</b></div>
      <div class="metric"><span>Proj edge</span><b>${projEdge === null ? '—' : `${projEdge > 0 ? '+' : ''}${projEdge.toFixed(1)}`}</b></div>
      <div class="metric"><span>Minutes</span><b>${display(prop.expectedMinutes)}</b></div>
    </div>
    <div class="card-foot"><div class="context-badges">${badges.join('')}</div><span class="details-link">Details ›</span></div>
  </article>`;
}

function renderFilterChips() {
  const chips = [];
  const f = state.filters;
  if (f.search) chips.push(['search', `“${f.search}”`]);
  for (const sport of f.sports || []) chips.push(['sports', sport, sport]);
  if (f.side !== 'ALL') chips.push(['side', f.side]);
  if (f.timeWindow === 'TODAY') chips.push(['timeWindow', 'Today']);
  if (Number.isFinite(f.minScore)) chips.push(['minScore', `Score ${f.minScore}+`]);
  if (Number.isFinite(f.minHitRate)) chips.push(['minHitRate', `${String(f.hitRateWindow).toUpperCase()} ${f.minHitRate}%+`]);
  if (Number.isFinite(f.minProjectionEdge)) chips.push(['minProjectionEdge', `Projection edge ${f.minProjectionEdge}+`]);
  if (Number.isFinite(f.minExpectedMinutes)) chips.push(['minExpectedMinutes', `${f.minExpectedMinutes}+ min`]);
  if (f.startersOnly) chips.push(['startersOnly', 'Starters']);
  if (f.excludeInjured) chips.push(['excludeInjured', 'No out/doubtful']);
  if (f.applyScoutRules) chips.push(['applyScoutRules', 'Scout Rules ON']);
  const container = $('activeChips');
  container.hidden = chips.length === 0;
  container.innerHTML = chips.map(([id, label, value]) => `<span class="active-chip">${esc(label)}<button type="button" data-clear-filter="${esc(id)}" ${value ? `data-clear-value="${esc(value)}"` : ''} aria-label="Remove ${esc(label)}">×</button></span>`).join('');
  $('filterCount').textContent = String(chips.filter(([id]) => !['timeWindow', 'applyScoutRules'].includes(id)).length);
}

function clearFilter(id, value = null) {
  if (id === 'sports') state.filters.sports = value ? state.filters.sports.filter((sport) => String(sport).toUpperCase() !== String(value).toUpperCase()) : [];
  else if (id === 'search') { state.filters.search = ''; $('searchInput').value = ''; }
  else if (id === 'side') state.filters.side = 'ALL';
  else if (id === 'timeWindow') state.filters.timeWindow = 'ALL';
  else if (id === 'minScore') state.filters.minScore = null;
  else if (id === 'minHitRate') state.filters.minHitRate = null;
  else if (id === 'minProjectionEdge') state.filters.minProjectionEdge = null;
  else if (id === 'minExpectedMinutes') state.filters.minExpectedMinutes = null;
  else if (id === 'startersOnly') state.filters.startersOnly = false;
  else if (id === 'excludeInjured') state.filters.excludeInjured = false;
  else if (id === 'applyScoutRules') state.filters.applyScoutRules = false;
  syncControlsFromState();
  loadProps({ reset: true });
}

function openSheet() {
  syncControlsFromState();
  $('filterSheet').classList.add('open');
  $('filterSheet').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('filterSheet').classList.remove('open');
  $('filterSheet').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function syncControlsFromState() {
  $('searchInput').value = state.filters.search || '';
  $('rulesToggle').checked = Boolean(state.filters.applyScoutRules);
  $('rulesState').textContent = state.filters.applyScoutRules ? 'ON' : 'OFF';
  $('sideFilter').value = state.filters.side || 'ALL';
  $('minScoreFilter').value = state.filters.minScore ?? '';
  $('minHitRateFilter').value = state.filters.minHitRate ?? '';
  $('hitWindowFilter').value = state.filters.hitRateWindow || 'l10';
  $('minProjectionEdgeFilter').value = state.filters.minProjectionEdge ?? '';
  $('minMinutesFilter').value = state.filters.minExpectedMinutes ?? '';
  $('excludeInjuredFilter').checked = Boolean(state.filters.excludeInjured);
  $('startersOnlyFilter').checked = Boolean(state.filters.startersOnly);
  $('todayOnlyFilter').checked = state.filters.timeWindow === 'TODAY';
  $('sortSelect').value = state.sort;
  renderFilterChips();
  renderSportChips();
}

function readSheetIntoState() {
  const n = (id) => finiteOrNull($(id).value.trim());
  state.filters.side = $('sideFilter').value;
  state.filters.minScore = n('minScoreFilter');
  state.filters.minHitRate = n('minHitRateFilter');
  state.filters.hitRateWindow = $('hitWindowFilter').value;
  state.filters.minProjectionEdge = n('minProjectionEdgeFilter');
  state.filters.minExpectedMinutes = n('minMinutesFilter');
  state.filters.excludeInjured = $('excludeInjuredFilter').checked;
  state.filters.startersOnly = $('startersOnlyFilter').checked;
  state.filters.timeWindow = $('todayOnlyFilter').checked ? 'TODAY' : 'ALL';
}

function resetFilters() {
  state.filters = {
    search: '', sports: [], markets: [], side: 'ALL', timeWindow: 'TODAY',
    minScore: null, minHitRate: null, hitRateWindow: 'l10', minProjectionEdge: null,
    minExpectedMinutes: null, startersOnly: false, excludeInjured: false, applyScoutRules: false,
  };
  syncControlsFromState();
}

function showNotice(message, isError = false) {
  const node = $('notice');
  node.hidden = false;
  node.textContent = message;
  node.dataset.kind = isError ? 'error' : 'info';
}

async function openDetail(id) {
  const dialog = $('detailDialog');
  $('detailBody').innerHTML = '<div class="detail-loading">Loading analysis…</div>';
  if (!dialog.open) dialog.showModal();
  try {
    const data = await api(`/api/props/detail?id=${encodeURIComponent(id)}`);
    renderDetail(data);
  } catch (error) {
    $('detailBody').innerHTML = `<div class="empty-state"><b>Detail unavailable</b>${esc(error?.message || 'Try again.')}</div>`;
  }
}

function renderDetail(data) {
  const prop = data?.prop || {};
  const breakdown = data?.scoreBreakdown || prop.scoreBreakdown || {};
  const factors = Array.isArray(breakdown.factors) ? breakdown.factors : [];
  const analytics = data?.analytics || null;
  const windows = analytics?.windows || {};
  const gameLog = Array.isArray(analytics?.gameLog) ? analytics.gameLog : [];
  $('detailBody').innerHTML = `
    <div class="detail-hero"><span class="eyebrow">${esc(prop.sport || 'PROP')} · ${prop.gameStartTime ? fmtDateTime(prop.gameStartTime) : 'TODAY'}</span><h2>${esc(prop.playerName || 'Player')}</h2><p>${esc(prop.market || 'Prop')} ${display(prop.line)} · ${esc(prop.side || '')}${prop.opponent ? ` · vs ${esc(prop.opponent)}` : ''}</p></div>
    <div class="detail-score-row"><div class="detail-score"><strong>${display(prop.score)}</strong><span>Scout Score</span></div><div><b>${esc(prop.qualityTier || 'Unranked')}</b><p>${breakdown.dataCoverage !== null && breakdown.dataCoverage !== undefined ? `${esc(breakdown.dataCoverage)}% model coverage` : 'Coverage unavailable'}</p></div></div>
    <section class="detail-section"><h3>Current intelligence</h3><div class="detail-metrics">
      <div><span>Projection</span><b>${display(prop.projection)}</b><small>${esc(prop.projectionSource || 'Unavailable')}</small></div>
      <div><span>Expected minutes</span><b>${display(prop.expectedMinutes)}</b><small>${esc(prop.lineupStatus || 'Lineup unknown')}</small></div>
      <div><span>Injury</span><b>${display(prop.injuryStatus)}</b><small>${esc(prop.injuryDetail || prop.injuryNotes || '')}</small></div>
      <div><span>Live</span><b>${display(prop.liveStat)}</b><small>${esc(prop.liveStatus || '')}</small></div>
    </div></section>
    ${analytics ? `<section class="detail-section"><h3>Game-log hit rates</h3><div class="window-grid">${['l5','l10','l20','season'].map((id) => { const row = windows[id]; return `<div><span>${esc(row?.label || id.toUpperCase())}</span><b>${row?.hitRate === null || row?.hitRate === undefined ? '—' : `${esc(row.hitRate)}%`}</b><small>${row?.average === null || row?.average === undefined ? 'No average' : `Avg ${esc(row.average)} · ${esc(row.sampleSize ?? row.games ?? 0)} games`}</small></div>`; }).join('')}</div>${gameLog.length ? `<div class="game-log">${gameLog.slice(0,10).map((game) => `<div><span>${esc(game.date || 'Game')} ${game.opponent ? `· ${esc(game.opponent)}` : ''}</span><b>${display(game.value)}</b><small>${game.hit === true ? 'HIT' : game.hit === false ? 'MISS' : 'PUSH'}</small></div>`).join('')}</div>` : ''}</section>` : ''}
    <section class="detail-section"><h3>Why this score</h3><div class="factor-list">${factors.length ? factors.map((factor) => `<div class="factor-row"><div><b>${esc(factor.label || factor.id)}</b><small>${esc(factor.explanation || factor.detail || '')}${factor.source ? ` · ${esc(factor.source)}` : ''}</small></div><span>${factor.available === false ? 'N/A' : display(factor.contribution ?? factor.points)}</span></div>`).join('') : '<p class="muted">No score breakdown is available.</p>'}</div></section>
  `;
}

function bind() {
  document.querySelectorAll('.mode-tab').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('sortSelect').addEventListener('change', () => { state.sort = $('sortSelect').value; loadProps({ reset: true }); });
  $('searchInput').addEventListener('input', () => {
    state.filters.search = $('searchInput').value.trim();
    clearTimeout(state.debounce);
    state.debounce = setTimeout(() => loadProps({ reset: true }), 300);
  });
  $('rulesToggle').addEventListener('change', () => {
    state.filters.applyScoutRules = $('rulesToggle').checked;
    $('rulesState').textContent = state.filters.applyScoutRules ? 'ON' : 'OFF';
    loadProps({ reset: true });
  });
  $('sportChips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sport]');
    if (!button) return;
    const sport = String(button.dataset.sport || '').toUpperCase();
    state.filters.sports = sport ? [sport] : [];
    loadProps({ reset: true });
  });
  $('activeChips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear-filter]');
    if (button) clearFilter(button.dataset.clearFilter, button.dataset.clearValue || null);
  });
  [$('openFiltersBtn'), $('mobileFiltersBtn')].forEach((button) => button.addEventListener('click', openSheet));
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', closeSheet));
  $('applyFiltersBtn').addEventListener('click', () => { readSheetIntoState(); closeSheet(); loadProps({ reset: true }); });
  $('resetFiltersBtn').addEventListener('click', resetFilters);
  $('refreshBtn').addEventListener('click', () => { loadProviders(); loadProps({ reset: true }); });
  $('loadMoreBtn').addEventListener('click', async () => { state.offset += state.limit; await loadProps({ append: true }); });
  $('propGrid').addEventListener('click', (event) => { const card = event.target.closest('[data-prop-id]'); if (card) openDetail(card.dataset.propId); });
  $('propGrid').addEventListener('keydown', (event) => { if (!['Enter', ' '].includes(event.key)) return; const card = event.target.closest('[data-prop-id]'); if (card) { event.preventDefault(); openDetail(card.dataset.propId); } });
  $('detailClose').addEventListener('click', () => $('detailDialog').close());
  $('detailDialog').addEventListener('click', (event) => { if (event.target === $('detailDialog')) $('detailDialog').close(); });
}

bind();
syncControlsFromState();
setMode(state.mode, { load: false });
loadProviders();
loadProps({ reset: true });