const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const fmt = (value, suffix = '') => value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${value}${suffix}`;

let authMode = 'login';
let user = null;
let status = null;
let latest = null;
let rules = null;
let presets = {};
let history = [];
let currentFilter = 'qualified';
let searchQuery = '';
let sportFilter = 'ALL';
let liveSportFilter = 'ALL';
let livePayload = null;
let statusTimer = null;
let liveTimer = null;
let booted = false;

function toast(message, ms = 3200) {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove('show'), ms);
}

async function request(url, options = {}, { authRedirect = true } = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: options.body ? { 'content-type':'application/json', ...(options.headers || {}) } : options.headers,
    ...options,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (response.status === 401 && authRedirect) {
    showAuth();
    throw new Error(data.message || 'Sign in to AutoProp.');
  }
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

function showAuth() {
  user = null;
  clearTimeout(statusTimer);
  clearTimeout(liveTimer);
  $('authView').classList.remove('hidden');
  $('app').classList.add('hidden');
}
function showApp() {
  $('authView').classList.add('hidden');
  $('app').classList.remove('hidden');
}

function setAuthMode(mode) {
  authMode = mode;
  $('loginTab').classList.toggle('active', mode === 'login');
  $('registerTab').classList.toggle('active', mode === 'register');
  $('authTitle').textContent = mode === 'login' ? 'Welcome back.' : 'Create your private workspace.';
  $('authSubtitle').textContent = mode === 'login' ? 'Sign in to your private research workspace.' : 'Your PickFinder connection will be isolated from every other user.';
  $('authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authError').classList.add('hidden');
}

async function bootAuth() {
  try {
    const auth = await request('/api/auth/status', {}, { authRedirect: false });
    if (!auth.authenticated) return showAuth();
    user = auth.user;
    showApp();
    startApp();
  } catch {
    showAuth();
  }
}

function startApp() {
  if (user) {
    $('userMenuBtn').textContent = String(user.email || 'U').charAt(0).toUpperCase();
    $('accountEmail').textContent = user.email || 'Your AutoProp account';
  }
  if (!booted) bindAppEvents();
  booted = true;
  getStatus({ quiet: true });
  loadLiveScores(true);
}

function updateConnectionUI(data) {
  const connection = data.connection || {};
  const connected = Boolean(connection.configured && connection.sessionSaved);
  $('connectionDot').classList.toggle('online', connected);
  $('connectionPill').textContent = connected ? `PickFinder • ${connection.maskedEmail || 'connected'}` : 'PickFinder not connected';
  $('connectBtn').textContent = connected ? 'Reconnect PickFinder' : 'Connect PickFinder';
  $('manageConnectionBtn').textContent = connected ? 'Reconnect / change account' : 'Connect your account';
  $('connectionSummary').innerHTML = connected
    ? `<b>Connected to your account</b><span>${esc(connection.maskedEmail || '')} • private encrypted session ready</span>`
    : `<b>Not connected</b><span>${esc(connection.connectionError || 'Only this AutoProp account can access the PickFinder session you connect here.')}</span>`;
}

function updateRulesMini() {
  if (!rules) return;
  $('ruleProfileName').textContent = `${String(rules.preset || 'custom').replace(/^./, (c) => c.toUpperCase())} profile`;
  $('miniL5').textContent = `${rules.minL5}%+`;
  $('miniL10').textContent = `${rules.minL10}%+`;
  $('miniL15').textContent = `${rules.minL15}%+`;
  $('miniH2H').textContent = rules.useH2H === false ? 'Off' : `${rules.minH2H}%+`;
}

function updateProgress(data) {
  const progress = data.progress || {};
  const panel = $('progressPanel');
  if (!data.running && progress.stage !== 'error') panel.classList.add('hidden'); else panel.classList.remove('hidden');
  const total = Number(progress.total || 0);
  const reviewed = Number(progress.reviewed || 0);
  const percent = total ? Math.min(100, Math.round(reviewed / total * 100)) : data.running ? 8 : progress.stage === 'complete' ? 100 : 0;
  $('progressMessage').textContent = progress.message || (data.running ? 'Scanning…' : 'Ready');
  $('progressCount').textContent = total ? `${reviewed} / ${total}` : data.running ? 'Discovering…' : '—';
  $('progressBar').style.width = `${percent}%`;
  $('progressStage').textContent = String(progress.stage || 'idle').toUpperCase();
  $('progressQualified').textContent = `${Number(progress.qualifiedSoFar || 0)} qualified`;
}

async function getStatus({ quiet = true } = {}) {
  try {
    const data = await request('/api/status');
    status = data;
    user = data.user || user;
    rules = data.rules || rules;
    latest = data.latest || null;
    updateConnectionUI(data);
    updateRulesMini();
    updateProgress(data);
    $('scanBtn').disabled = Boolean(data.running);
    $('scannerState').textContent = data.running ? 'Scanning your PickFinder data…' : data.lastError ? 'Needs attention' : 'Ready';
    if (data.latest?.scannedAt) {
      const when = new Date(data.latest.scannedAt);
      $('scanMeta').textContent = `${Number.isNaN(when.getTime()) ? 'Last scan' : `Last scan ${when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`} • ${data.latest.totalReviewed ?? 0} reviewed`;
    } else if (data.lastError) $('scanMeta').textContent = data.lastError;
    else $('scanMeta').textContent = data.connection?.configured ? 'Connected • ready to scan' : 'Connect your own PickFinder account';
    renderDashboard();
    if (!data.running || !history.length) loadHistory();
    if (data.lastError && !quiet) toast(data.lastError, 5000);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => getStatus({ quiet: true }), data.running ? 1600 : 8500);
  } catch (error) {
    if (!quiet) toast(error.message);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => getStatus({ quiet: true }), 10000);
  }
}

async function loadHistory() {
  try { history = await request('/api/history'); renderHistory(); } catch {}
}

function metric(label, value, floor = 75) {
  const pass = Number.isFinite(Number(value)) && Number(value) >= Number(floor);
  return `<div class="metric ${pass ? 'pass' : ''}"><small>${esc(label)}</small><b>${fmt(value,'%')}</b></div>`;
}

function visiblePicks() {
  if (!latest) return [];
  let picks = [...(latest.picks || [])];
  if (currentFilter === 'qualified') {
    const qualified = picks.filter((pick) => pick.qualified);
    picks = qualified.length ? qualified : [...(latest.bestAvailable || [])];
  } else if (currentFilter === 'rejected') picks = picks.filter((pick) => !pick.qualified);
  if (sportFilter !== 'ALL') picks = picks.filter((pick) => String(pick.sport || '').toUpperCase() === sportFilter);
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    picks = picks.filter((pick) => [pick.player,pick.prop,pick.opponent,pick.sport,pick.pick].some((value) => String(value || '').toLowerCase().includes(query)));
  }
  return picks.sort((a,b) => Number(b.qualified)-Number(a.qualified) || Number(b.confidence || b.researchScore || 0)-Number(a.confidence || a.researchScore || 0));
}

function renderDashboard() {
  const picks = latest?.picks || [];
  $('reviewedCount').textContent = latest ? latest.totalReviewed ?? 0 : '—';
  $('qualifiedCount').textContent = latest ? latest.qualifiedCount ?? 0 : '—';
  $('rejectedCount').textContent = latest ? latest.rejectedCount ?? 0 : '—';
  const best = picks.filter((pick) => pick.qualified).sort((a,b) => Number(b.confidence)-Number(a.confidence))[0];
  $('bestConfidence').textContent = best ? `${best.confidence}%` : '—';
  renderWarnings();
  renderSportFilter();
  renderPicks();
  renderCard();
}

function renderWarnings() {
  const node = $('warningBox');
  const warnings = [];
  if (status?.lastError) warnings.push(status.lastError);
  warnings.push(...(latest?.warnings || []));
  if (latest?.suppressedMalformedCount) warnings.push(`${latest.suppressedMalformedCount} malformed scraper records were hidden.`);
  if (!warnings.length) { node.classList.add('hidden'); return; }
  node.textContent = [...new Set(warnings)].join(' • ');
  node.classList.remove('hidden');
}

function renderSportFilter() {
  const sports = [...new Set((latest?.picks || []).concat(latest?.bestAvailable || []).map((pick) => String(pick.sport || '').toUpperCase()).filter(Boolean))].sort();
  const node = $('sportFilter');
  const signature = sports.join('|');
  if (node.dataset.signature === signature) return;
  node.dataset.signature = signature;
  node.innerHTML = '<option value="ALL">All sports</option>' + sports.map((sport) => `<option value="${esc(sport)}">${esc(sport)}</option>`).join('');
  if (!sports.includes(sportFilter)) sportFilter = 'ALL';
  node.value = sportFilter;
}

function renderPicks() {
  const node = $('pickList');
  if (!latest) {
    node.innerHTML = '<div class="empty"><span>◎</span><h3>No scan loaded</h3><p>Connect your PickFinder account and run tonight’s scan.</p></div>';
    return;
  }
  const rows = visiblePicks();
  if (!rows.length) {
    node.innerHTML = `<div class="empty"><span>◎</span><h3>No matching props</h3><p>${currentFilter === 'qualified' ? 'Nothing cleared the active rules, and no hard-eligible Best Available props were found.' : 'Change the filters or run a new scan.'}</p></div>`;
    return;
  }
  const floors = { L5: rules?.minL5 ?? 80, L10: rules?.minL10 ?? 75, L15: rules?.minL15 ?? 75, H2H: rules?.minH2H ?? 75, 'W/L': rules?.minExpectedOutcome ?? 75 };
  node.innerHTML = rows.map((pick, index) => {
    const near = !pick.qualified && Boolean(pick.bestAvailable || pick.researchScore);
    const score = near ? pick.researchScore : pick.confidence;
    return `<article class="pick-row" data-row="${index}">
      <div class="pick-main"><b>${esc(pick.player)}</b><span>${esc(pick.sport)} • vs ${esc(pick.opponent || '—')} ${pick.qualified ? '<em class="pass-tag">QUALIFIED</em>' : near ? '<em class="near-tag">BEST AVAILABLE</em>' : '<em class="reject-tag">REJECTED</em>'}</span></div>
      <div class="pick-line"><b>${esc(pick.prop)} ${fmt(pick.line)}</b><span class="${String(pick.pick).toLowerCase() === 'over' ? 'over' : String(pick.pick).toLowerCase() === 'under' ? 'under' : ''}">${esc(pick.pick || '—')}</span></div>
      ${metric('L5',pick.l5,floors.L5)}${metric('L10',pick.l10,floors.L10)}${metric('L15',pick.l15,floors.L15)}${metric('H2H',pick.h2h,floors.H2H)}${metric('W/L',pick.expectedOutcomeRate,floors['W/L'])}
      <div class="conf"><strong>${fmt(score,'%')}</strong><span>${near ? 'near-miss rank' : 'confidence'}</span></div>
    </article>`;
  }).join('');
  node.querySelectorAll('[data-row]').forEach((row) => row.addEventListener('click', () => openPickDetails(rows[Number(row.dataset.row)])));
}

function renderCard() {
  const node = $('cardList');
  const card = latest?.diversifiedCard || [];
  if (!card.length) { node.innerHTML = '<p class="muted">No independently qualified legs available.</p>'; return; }
  node.innerHTML = card.map((pick,index) => `<div class="card-leg"><i>${index+1}</i><div><b>${esc(pick.player)} ${esc(pick.pick)} ${fmt(pick.line)}</b><span>${esc(pick.sport)} • ${esc(pick.prop)}</span></div><strong>${fmt(pick.confidence,'%')}</strong></div>`).join('');
}

function renderHistory() {
  const node = $('historyList');
  const rows = (Array.isArray(history) ? history : []).slice(0,6);
  if (!rows.length) { node.innerHTML = '<p class="muted">No completed scans yet.</p>'; return; }
  node.innerHTML = rows.map((row) => {
    const when = new Date(row.scannedAt);
    const label = Number.isNaN(when.getTime()) ? 'Unknown time' : when.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    return `<div class="history-row"><div><b>${esc(label)}</b><span>${fmt(row.totalReviewed)} reviewed${row.suppressedMalformedCount ? ` • ${row.suppressedMalformedCount} hidden` : ''}</span></div><strong>${fmt(row.qualifiedCount)}</strong></div>`;
  }).join('');
}

function delta(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value); return `${n > 0 ? '+' : ''}${n}%`;
}

async function openPickDetails(pick) {
  const dialog = $('detailsDialog');
  const audit = pick.filterAudit || [];
  const near = !pick.qualified && Boolean(pick.bestAvailable || pick.researchScore);
  $('detailsBody').innerHTML = `<span class="eyebrow">${pick.qualified ? 'QUALIFIED' : near ? 'BEST AVAILABLE • NOT QUALIFIED' : 'REJECTED'} • ${esc(pick.sport)}</span>
    <h2>${esc(pick.player)} — ${esc(pick.pick)} ${fmt(pick.line)}</h2>
    <p>${esc(pick.prop)} • vs ${esc(pick.opponent || '—')} • ${near ? `research rank ${fmt(pick.researchScore,'%')}` : `confidence ${fmt(pick.confidence,'%')}`}</p>
    <div id="livePlayerSlot" class="live-player-card"><span class="eyebrow">LIVE PLAYER DATA</span><h3>Checking current game…</h3><p class="fine">Live box-score data loads separately from PickFinder.</p></div>
    <div class="detail-score"><div><small>L5</small><b>${fmt(pick.l5,'%')}</b></div><div><small>L10</small><b>${fmt(pick.l10,'%')}</b></div><div><small>L15</small><b>${fmt(pick.l15,'%')}</b></div><div><small>H2H</small><b>${fmt(pick.h2h,'%')}</b></div><div><small>W/L</small><b>${fmt(pick.expectedOutcomeRate,'%')}</b></div></div>
    ${(pick.failures || pick.nearMisses || []).length ? `<div class="warning">${(pick.failures || pick.nearMisses).map(esc).join(' • ')}</div>` : ''}
    <h3>Filter audit</h3><div class="audit-wrap"><table class="audit-table"><thead><tr><th>Filter</th><th>Value</th><th>Before</th><th>After</th><th>Δ</th><th>Status</th></tr></thead><tbody>${audit.map((row) => {
      const after = row.afterHitRate ?? row.hitRate;
      const floor = Number(row.floor ?? rules?.minFilterHitRate ?? 75);
      const pass = row.verified && (row.enforceFloor === false || Number(after) >= floor);
      const removed = row.removedBecauseDataDisappeared;
      return `<tr><td>${esc(row.label)}</td><td>${esc(row.value)}</td><td>${fmt(row.beforeHitRate,'%')}</td><td>${fmt(after,'%')}</td><td>${delta(row.delta)}</td><td class="${pass ? 'ok' : removed ? '' : 'bad'}">${removed ? 'Reverted — data disappeared' : pass ? 'Pass' : 'Fail / unverified'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  dialog.showModal();
  loadLivePlayer(pick).catch(() => {});
}

async function loadLivePlayer(pick) {
  const slot = $('livePlayerSlot');
  if (!slot) return;
  try {
    const data = await request(`/api/live/player?sport=${encodeURIComponent(String(pick.sport || '').toUpperCase())}&name=${encodeURIComponent(pick.player)}`);
    if (!slot.isConnected) return;
    if (!data.supported) {
      slot.innerHTML = '<span class="eyebrow">LIVE PLAYER DATA</span><h3>Live box scores are not connected for this sport yet.</h3><p class="fine">PickFinder research remains available; the live-data provider currently covers major U.S. leagues.</p>';
      return;
    }
    if (!data.player) {
      slot.innerHTML = '<span class="eyebrow">LIVE PLAYER DATA</span><h3>No active box-score match found.</h3><p class="fine">The player may not be in a game right now, or the live provider has not posted a box score yet.</p>';
      return;
    }
    const stats = Object.entries(data.player.stats || {}).filter(([,value]) => value !== null && value !== '').slice(0,14);
    slot.innerHTML = `<span class="eyebrow">${data.live ? 'LIVE NOW' : 'LATEST GAME'} • ${esc(data.game?.status || '')}</span><h3>${esc(data.player.name)} • ${esc(data.player.team || '')}</h3><p class="fine">${esc(data.game?.away?.shortName || '')} ${fmt(data.game?.away?.score)} — ${esc(data.game?.home?.shortName || '')} ${fmt(data.game?.home?.score)}</p><div class="live-player-stats">${stats.map(([label,value]) => `<div class="live-stat"><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('') || '<span class="fine">Player is listed, but no live stat line has been posted yet.</span>'}</div>`;
  } catch (error) {
    if (slot?.isConnected) slot.innerHTML = `<span class="eyebrow">LIVE PLAYER DATA</span><h3>Live player feed unavailable.</h3><p class="fine">${esc(error.message)}</p>`;
  }
}

async function loadLiveScores(force = false) {
  try {
    const sports = liveSportFilter === 'ALL' ? '' : `?sports=${encodeURIComponent(liveSportFilter)}`;
    livePayload = await request(`/api/live/scores${sports}`);
    renderLiveScores();
    $('liveProviderNote').textContent = `Live provider: ${livePayload.provider || 'sports feed'} • refreshed ${new Date(livePayload.generatedAt || Date.now()).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}${livePayload.errors?.length ? ` • ${livePayload.errors.length} feed warning${livePayload.errors.length === 1 ? '' : 's'}` : ''}`;
  } catch (error) {
    $('liveProviderNote').textContent = `Live scores unavailable: ${error.message}`;
    if (force) $('liveGames').innerHTML = '<div class="empty"><h3>Live feed unavailable</h3><p>The prop scanner still works independently.</p></div>';
  } finally {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => loadLiveScores(false), 15000);
  }
}

function renderLiveScores() {
  const node = $('liveGames');
  const games = livePayload?.games || [];
  if (!games.length) { node.innerHTML = '<div class="empty"><h3>No supported games on the board right now.</h3><p>Pregame, live and final games will appear here automatically.</p></div>'; return; }
  node.innerHTML = games.map((game) => `<article class="game-card">
    <div class="game-top"><span>${esc(game.league)}</span><span class="game-state ${esc(game.state)}">${esc(game.status)}</span></div>
    <div class="team-row"><div class="team">${game.away.logo ? `<img src="${esc(game.away.logo)}" alt="" loading="lazy">` : ''}<b>${esc(game.away.shortName)}</b></div><strong>${fmt(game.away.score)}</strong></div>
    <div class="team-row"><div class="team">${game.home.logo ? `<img src="${esc(game.home.logo)}" alt="" loading="lazy">` : ''}<b>${esc(game.home.shortName)}</b></div><strong>${fmt(game.home.score)}</strong></div>
    <div class="game-bottom"><span>${game.displayClock ? `${esc(game.displayClock)}${game.period ? ` • P${esc(game.period)}` : ''}` : esc(game.venue || '')}</span><span>${(game.broadcasts || []).slice(0,2).map(esc).join(', ')}</span></div>
  </article>`).join('');
}

async function openRules() {
  try {
    const data = await request('/api/rules');
    rules = data.rules;
    presets = data.presets || {};
    fillRules(rules);
    $('rulesDialog').showModal();
  } catch (error) { toast(error.message); }
}

function fillRules(value) {
  const sliders = ['minL5','minL10','minL15','minH2H','minExpectedOutcome','minFilterHitRate'];
  const toggles = ['useH2H','requireWinLoss','requireOpponent','requireSeason','requireHomeAway','requireTeam','requireAdvancedAvailable','bestAvailable'];
  sliders.forEach((id) => { if ($(id)) { $(id).value = value?.[id] ?? 75; $(`${id}Value`).textContent = `${$(id).value}%`; } });
  toggles.forEach((id) => { if ($(id)) $(id).checked = value?.[id] !== false; });
  document.querySelectorAll('[data-preset]').forEach((button) => button.classList.toggle('active', button.dataset.preset === value?.preset));
}

function collectRules() {
  const value = { ...(rules || {}) };
  ['minL5','minL10','minL15','minH2H','minExpectedOutcome','minFilterHitRate'].forEach((id) => { value[id] = Number($(id).value); });
  ['useH2H','requireWinLoss','requireOpponent','requireSeason','requireHomeAway','requireTeam','requireAdvancedAvailable','bestAvailable'].forEach((id) => { value[id] = Boolean($(id).checked); });
  value.preset = 'custom';
  return value;
}

function openConnection() {
  $('pickfinderEmail').value = '';
  $('pickfinderPassword').value = '';
  $('connectState').classList.add('hidden');
  $('connectDialog').showModal();
}

function bindAppEvents() {
  $('scanBtn').addEventListener('click', async () => {
    try {
      const data = await request('/api/scan', { method:'POST' });
      toast(data.message || 'Scan started');
      getStatus({ quiet: true });
    } catch (error) { toast(error.message, 5000); }
  });
  [$('connectBtn'),$('manageConnectionBtn'),$('connectionPill')].forEach((button) => button?.addEventListener('click', openConnection));
  [$('rulesBtn'),$('sideRulesBtn')].forEach((button) => button?.addEventListener('click', openRules));
  $('userMenuBtn').addEventListener('click', () => $('accountDialog').showModal());
  $('logoutBtn').addEventListener('click', async () => { try { await request('/api/auth/logout',{method:'POST'}); } catch {} $('accountDialog').close(); showAuth(); });
  $('connectForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('connectSubmit');
    button.disabled = true;
    button.textContent = 'Opening PickFinder…';
    $('connectState').classList.remove('hidden');
    $('connectState').textContent = 'AutoProp is signing into your private PickFinder worker and proving a player detail page is actually unlocked.';
    try {
      const data = await request('/api/connect',{method:'POST',body:JSON.stringify({email:$('pickfinderEmail').value,password:$('pickfinderPassword').value})});
      $('connectState').textContent = data.connection?.verifiedByDetailPage ? 'Connected. A real player detail page was verified as unlocked.' : 'Connected.';
      $('pickfinderPassword').value = '';
      toast('Your PickFinder account is connected.');
      await getStatus({quiet:true});
      setTimeout(() => $('connectDialog').close(), 900);
    } catch (error) {
      $('connectState').textContent = error.message;
    } finally { button.disabled = false; button.textContent = 'Connect & verify detail page'; }
  });
  $('rulesForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await request('/api/rules',{method:'PUT',body:JSON.stringify({rules:collectRules()})});
      rules = data.rules; updateRulesMini(); $('rulesDialog').close(); toast('Rule profile saved.'); renderDashboard();
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => { const preset = presets[button.dataset.preset]; if (preset) fillRules(preset); }));
  ['minL5','minL10','minL15','minH2H','minExpectedOutcome','minFilterHitRate'].forEach((id) => $(id).addEventListener('input', () => $(`${id}Value`).textContent = `${$(id).value}%`));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close)?.close()));
  document.querySelectorAll('.segment').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.segment').forEach((row) => row.classList.remove('active')); button.classList.add('active'); currentFilter = button.dataset.filter; renderPicks(); }));
  $('propSearch').addEventListener('input', (event) => { searchQuery = event.target.value.trim(); renderPicks(); });
  $('sportFilter').addEventListener('change', (event) => { sportFilter = event.target.value; renderPicks(); });
  $('liveSportFilter').addEventListener('change', (event) => { liveSportFilter = event.target.value; loadLiveScores(true); });
  $('refreshLiveBtn').addEventListener('click', () => loadLiveScores(true));
}

$('loginTab').addEventListener('click', () => setAuthMode('login'));
$('registerTab').addEventListener('click', () => setAuthMode('register'));
$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorNode = $('authError');
  const submit = $('authSubmit');
  submit.disabled = true;
  errorNode.classList.add('hidden');
  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const data = await request(endpoint,{method:'POST',body:JSON.stringify({email:$('authEmail').value,password:$('authPassword').value})},{authRedirect:false});
    user = data.user;
    $('authPassword').value = '';
    showApp();
    startApp();
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.classList.remove('hidden');
  } finally { submit.disabled = false; submit.textContent = authMode === 'login' ? 'Sign in' : 'Create account'; }
});

setAuthMode('login');
bootAuth();
