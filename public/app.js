const $ = (id) => document.getElementById(id);
let latest = null;
let status = null;
let currentFilter = 'qualified';
let payoutMultiplier = null;
let pollingTimer = null;
let searchQuery = '';
let sportFilter = 'ALL';
let history = [];

const fmt = (v, suffix = '') => v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${v}${suffix}`;
const escapeHtml = (s = '') => String(s).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
    ...options
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (response.status === 401) {
    toSignIn();
    throw new Error(data.message || 'Sign in to continue.');
  }
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

let currentUser = null;

function toSignIn() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/auth.html?next=${next}`);
}

async function bootAuth() {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    const auth = await response.json();
    if (!auth.authenticated) { toSignIn(); return false; }
    currentUser = auth.user;
    renderAccount(auth.user);
    $('app').classList.remove('hidden');
    return true;
  } catch {
    toSignIn();
    return false;
  }
}

function renderAccount(user) {
  if (!user) return;
  const label = user.displayName || user.email || 'Account';
  const button = $('accountBtn');
  if (button) {
    button.textContent = label.length > 22 ? `${label.slice(0, 21)}…` : label;
    button.title = `${user.email} · ${user.role}`;
  }
  // Connection and rule changes are admin-only server-side; hide them otherwise.
  if (!user.isAdmin) {
    for (const id of ['connectBtn', 'manageConnectionBtn', 'ruleFiltersBtn', 'sideRuleFiltersBtn']) {
      const element = $(id);
      if (element) element.classList.add('hidden');
    }
  }
}

function updateConnectionUI(data) {
  const connection = data.connection || {};
  const connected = Boolean(connection.configured && (connection.sessionSaved || connection.credentialSource === 'environment'));
  const badge = $('connectionBadge');
  const dot = $('connectionDot');
  const summary = $('connectionSummary');
  const manage = $('manageConnectionBtn');
  const heroConnect = $('connectBtn');

  if (data.demoMode) {
    badge.className = 'badge badge-demo badge-button';
    badge.textContent = 'Demo worker';
    $('modeChip').textContent = 'DEMO';
  } else if (connected) {
    badge.className = 'badge badge-live badge-button';
    badge.textContent = connection.maskedEmail ? `Connected • ${connection.maskedEmail}` : 'PickFinder connected';
    $('modeChip').textContent = 'LIVE';
  } else {
    badge.className = 'badge badge-muted badge-button';
    badge.textContent = 'Connect PickFinder';
    $('modeChip').textContent = 'LIVE';
  }

  dot.classList.toggle('online', connected);
  dot.classList.toggle('offline', !connected);
  summary.innerHTML = connected
    ? `<b>Connected</b><span>${escapeHtml(connection.maskedEmail || 'PickFinder session saved')} • ${connection.sessionSaved ? 'encrypted browser session ready' : 'environment credentials ready'}</span>`
    : '<b>Not connected</b><span>Connect once so the live worker can sign in and save an encrypted session.</span>';
  manage.textContent = connected ? 'Manage connection' : 'Connect account';
  heroConnect.textContent = connected ? 'Manage PickFinder' : 'Connect PickFinder';
}

function updateProgressUI(data) {
  const progress = data.progress || {};
  const panel = $('progressPanel');
  if (!data.running && !['error'].includes(progress.stage)) panel.classList.add('hidden');
  else panel.classList.remove('hidden');
  const total = Number(progress.total || 0);
  const reviewed = Number(progress.reviewed || 0);
  const percent = total > 0 ? Math.min(100, Math.round(reviewed / total * 100)) : data.running ? 8 : 0;
  $('progressMessage').textContent = progress.message || (data.running ? 'Scanning…' : 'Ready');
  $('progressCount').textContent = total ? `${reviewed} / ${total}` : data.running ? 'Discovering props…' : '—';
  $('progressBar').style.width = `${percent}%`;
  $('progressStage').textContent = String(progress.stage || 'idle').toUpperCase();
  $('progressQualified').textContent = `${Number(progress.qualifiedSoFar || 0)} qualified so far`;
}

async function getStatus({ quiet = true } = {}) {
  try {
    const data = await request('/api/status');
    status = data;
    payoutMultiplier = data.payoutMultiplier;
    updateConnectionUI(data);
    updateProgressUI(data);
    const scanButtons = [$('scanBtn'), $('heroScanBtn')];
    scanButtons.forEach((button) => { button.disabled = Boolean(data.running); });
    $('scannerState').textContent = data.running ? 'Scanning live data…' : data.lastError ? 'Needs attention' : 'Ready';
    $('scanBtn').querySelector('span:last-child').textContent = data.running ? 'Scanning' : 'Run Full Scan';
    if (data.latest) {
      const changed = !latest || latest.scannedAt !== data.latest.scannedAt;
      latest = data.latest;
      renderAll();
      if (changed && !data.running && latest.mode === 'live') toast(`Scan complete: ${latest.qualifiedCount} qualified`);
    }
    if (!data.running || !history.length) request('/api/history').then((rows) => { history = Array.isArray(rows) ? rows : []; renderHistory(); }).catch(() => {});
    if (data.lastError && !quiet) toast(data.lastError);
    schedulePoll(data.running ? 1800 : 9000);
  } catch (error) {
    if (!quiet) toast(error.message || 'Could not reach scanner server');
    schedulePoll(10000);
  }
}

function schedulePoll(delay) {
  clearTimeout(pollingTimer);
  pollingTimer = setTimeout(() => getStatus(), delay);
}

function renderAll() {
  if (!latest) return;
  $('reviewedCount').textContent = latest.totalReviewed ?? '—';
  $('qualifiedCount').textContent = latest.qualifiedCount ?? '—';
  $('rejectedCount').textContent = latest.rejectedCount ?? '—';
  const best = (latest.picks || []).filter((p) => p.qualified).sort((a,b) => b.confidence - a.confidence)[0];
  $('bestConfidence').textContent = best ? `${best.confidence}%` : '—';
  const when = new Date(latest.scannedAt);
  $('lastScanText').textContent = `Last scan ${when.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })} • ${latest.mode}`;
  renderWarnings();
  renderPicks();
  renderCard();
}

function renderWarnings() {
  const box = $('warningBox');
  const items = [...(latest?.warnings || [])];
  if (status?.lastError) items.unshift(status.lastError);
  if (!items.length) { box.classList.add('hidden'); return; }
  box.textContent = items.join(' • ');
  box.classList.remove('hidden');
}

function metric(label, value) {
  const pass = Number.isFinite(Number(value)) && Number(value) >= (label === 'L5' ? 80 : 75);
  return `<div class="metric ${pass ? 'metric-pass' : ''}"><small>${label}</small><b>${fmt(value, '%')}</b></div>`;
}

function renderPicks() {
  const list = $('pickList');
  let picks = [...(latest?.picks || [])];
  if (currentFilter === 'qualified') picks = picks.filter((p) => p.qualified);
  if (currentFilter === 'rejected') picks = picks.filter((p) => !p.qualified);
  if (sportFilter !== 'ALL') picks = picks.filter((p) => String(p.sport || '').toUpperCase() === sportFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    picks = picks.filter((p) => [p.player,p.prop,p.opponent,p.sport,p.pick].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  picks.sort((a,b) => (Number(b.qualified) - Number(a.qualified)) || (b.confidence - a.confidence));

  const sports = [...new Set((latest?.picks || []).map((p) => String(p.sport || '').toUpperCase()).filter(Boolean))].sort();
  const select = $('sportFilter');
  if (select && select.dataset.signature !== sports.join('|')) {
    select.dataset.signature = sports.join('|');
    select.innerHTML = '<option value="ALL">All sports</option>' + sports.map((sport) => `<option value="${escapeHtml(sport)}">${escapeHtml(sport)}</option>`).join('');
    select.value = sports.includes(sportFilter) ? sportFilter : 'ALL';
    if (!sports.includes(sportFilter)) sportFilter = 'ALL';
  }

  if (!picks.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-orbit">◎</div><h3>No ${currentFilter === 'qualified' ? 'qualified ' : ''}props</h3><p>${currentFilter === 'qualified' ? 'Nothing cleared every strict rule in this scan. That is a valid result.' : 'Nothing to show here.'}</p></div>`;
    return;
  }

  list.innerHTML = picks.map((p) => `
    <article class="pick-row" data-index="${(latest.picks || []).indexOf(p)}">
      <div class="pick-main"><b>${escapeHtml(p.player)}</b><span>${escapeHtml(p.sport)} • vs ${escapeHtml(p.opponent || '—')} ${p.qualified ? '<em class="pass-tag">VERIFIED</em>' : '<em class="reject-tag">REJECTED</em>'}</span></div>
      <div class="pick-line"><b>${escapeHtml(p.prop)} ${fmt(p.line)}</b><span class="${String(p.pick).toLowerCase() === 'under' ? 'under' : String(p.pick).toLowerCase() === 'over' ? 'over' : 'neutral'}">${escapeHtml(p.pick)}</span></div>
      ${metric('L5',p.l5)}${metric('L10',p.l10)}${metric('L15',p.l15)}${metric('H2H',p.h2h)}${metric('W/L',p.expectedOutcomeRate)}
      <div class="conf"><strong>${fmt(p.confidence, '%')}</strong><span>confidence</span></div>
    </article>`).join('');
  list.querySelectorAll('.pick-row').forEach((row) => row.addEventListener('click', () => openDetails(Number(row.dataset.index))));
}

function renderCard() {
  const card = $('cardList');
  const legs = latest?.diversifiedCard || [];
  if (!legs.length) {
    card.innerHTML = '<p class="muted">No independently verified legs available yet.</p>';
    $('payoutBox').classList.add('hidden');
    return;
  }
  card.innerHTML = legs.map((p,i) => `<div class="card-leg"><span class="leg-num">${i+1}</span><div><b>${escapeHtml(p.player)} ${escapeHtml(p.pick)} ${fmt(p.line)}</b><span>${escapeHtml(p.sport)} • ${escapeHtml(p.prop)}</span></div><strong>${p.confidence}%</strong></div>`).join('');
  renderPayout();
}

function renderPayout() {
  const payout = $('payoutBox');
  if (!payout) return;
  const entry = Number($('entryAmount')?.value || 0);
  const multiplier = Number(payoutMultiplier || 0);
  if (multiplier > 0) {
    const returnAmount = entry > 0 ? entry * multiplier : null;
    payout.textContent = returnAmount !== null ? `Estimated return: $${returnAmount.toFixed(2)} (${multiplier}×)` : `Configured payout: ${multiplier}× • enter an amount to calculate return.`;
    payout.classList.remove('hidden');
  } else {
    payout.textContent = 'Set PAYOUT_MULTIPLIER on the server to enable payout calculations.';
    payout.classList.remove('hidden');
  }
}

function renderHistory() {
  const box = $('historyList');
  if (!box) return;
  const rows = history.slice(0, 6);
  if (!rows.length) { box.innerHTML = '<p class="muted">No completed scans yet.</p>'; return; }
  box.innerHTML = rows.map((row) => {
    const when = new Date(row.scannedAt);
    const time = Number.isNaN(when.getTime()) ? 'Unknown time' : when.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
    return `<div class="history-row"><div><b>${escapeHtml(time)}</b><span>${escapeHtml(String(row.mode || '').toUpperCase())} • ${fmt(row.totalReviewed)} reviewed</span></div><div class="history-score"><strong>${fmt(row.qualifiedCount)}</strong><span>qualified</span></div></div>`;
  }).join('');
}

function openDetails(index) {
  const p = latest?.picks?.[index];
  if (!p) return;
  const audit = p.filterAudit || [];
  $('detailsBody').innerHTML = `<div class="detail-wrap">
    <span class="eyebrow">${p.qualified ? 'QUALIFIED' : 'REJECTED'} • ${escapeHtml(p.sport)}</span>
    <h2>${escapeHtml(p.player)} — ${escapeHtml(p.pick)} ${fmt(p.line)}</h2>
    <div class="detail-meta">${escapeHtml(p.prop)} • vs ${escapeHtml(p.opponent || '—')} • confidence ${fmt(p.confidence, '%')}</div>
    <div class="detail-score"><div><small>L5</small><b>${fmt(p.l5,'%')}</b></div><div><small>L10</small><b>${fmt(p.l10,'%')}</b></div><div><small>L15</small><b>${fmt(p.l15,'%')}</b></div><div><small>H2H</small><b>${fmt(p.h2h,'%')}</b></div><div><small>Expected W/L</small><b>${fmt(p.expectedOutcomeRate,'%')}</b></div></div>
    ${p.failures?.length ? `<div class="warning">${p.failures.map(escapeHtml).join(' • ')}</div>` : ''}
    <h3>Full filter audit</h3>
    <table class="audit-table"><thead><tr><th>Filter</th><th>Value</th><th>Hit rate</th><th>Status</th></tr></thead><tbody>
      ${audit.map((a) => {
        const floor = Number(a.floor ?? 75);
        const passed = a.verified && a.hitRate !== null && (a.enforceFloor === false || Number(a.hitRate) >= floor);
        const missingRequired = a.required && !a.verified;
        const checkedFailure = a.verified && a.enforceFloor !== false && (a.hitRate === null || Number(a.hitRate) < floor);
        const statusText = passed ? 'Pass' : (missingRequired || checkedFailure) ? 'Fail / unverified' : 'Not available';
        return `<tr><td>${escapeHtml(a.label)}</td><td>${escapeHtml(a.value)}</td><td>${fmt(a.hitRate,'%')}</td><td class="${passed ? 'ok' : (missingRequired || checkedFailure) ? 'bad' : ''}">${statusText}</td></tr>`;
      }).join('')}
    </tbody></table>
    ${(p.tabAudit || []).length ? `<h3>Swarm tab audit ${p.strongestTab ? `<span class="subtle-badge">Strongest: ${escapeHtml(p.strongestTab)} ${fmt(p.strongestTabScore,'%')}</span>` : ''}</h3>
    <table class="audit-table tab-table"><thead><tr><th>Tab</th><th>L5</th><th>L10</th><th>L15</th><th>H2H</th><th>Score</th></tr></thead><tbody>
      ${(p.tabAudit || []).map((t) => `<tr><td>${escapeHtml(t.tab)}</td><td>${fmt(t.l5,'%')}</td><td>${fmt(t.l10,'%')}</td><td>${fmt(t.l15,'%')}</td><td>${fmt(t.h2h,'%')}</td><td>${fmt(t.score,'%')}</td></tr>`).join('')}
    </tbody></table>` : ''}
    ${p.sourceUrl ? `<p class="fineprint">Source: ${escapeHtml(p.sourceUrl)}</p>` : ''}
  </div>`;
  $('detailsDialog').showModal();
}

function openConnectionDialog() {
  const connected = Boolean(status?.connection?.configured && (status?.connection?.sessionSaved || status?.connection?.credentialSource === 'environment'));
  if (connected) {
    $('disconnectSummary').textContent = `${status.connection.maskedEmail || 'Your PickFinder account'} is connected. Disconnecting erases the encrypted credentials and saved browser session from this worker.`;
    $('disconnectDialog').showModal();
  } else {
    $('connectState').classList.add('hidden');
    $('connectState').textContent = '';
    $('pickfinderPassword').value = '';
    $('connectDialog').showModal();
    setTimeout(() => $('pickfinderEmail').focus(), 50);
  }
}

async function startScan() {
  if (status?.running) return;
  if (!status?.demoMode && !status?.connection?.configured) {
    openConnectionDialog();
    toast('Connect PickFinder before running a live scan.');
    return;
  }
  try {
    $('scanBtn').disabled = true;
    $('heroScanBtn').disabled = true;
    await request('/api/scan', { method: 'POST' });
    toast('Live scan started');
    await getStatus({ quiet: false });
  } catch (error) {
    toast(error.message || 'Scan failed to start');
    await getStatus();
  }
}

const signOutBtn = $('signOutBtn');
if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch { /* clear anyway */ }
    location.replace('/auth.html');
  });
}

$('connectForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('connectSubmit');
  const state = $('connectState');
  state.className = 'connect-state working';
  state.textContent = 'Opening PickFinder and verifying your login…';
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    const data = await request('/api/connect', { method: 'POST', body: JSON.stringify({ email: $('pickfinderEmail').value.trim(), password: $('pickfinderPassword').value }) });
    $('pickfinderPassword').value = '';
    state.className = 'connect-state success';
    state.textContent = `Connected${data.connection?.maskedEmail ? ` as ${data.connection.maskedEmail}` : ''}. The encrypted session is ready.`;
    toast('PickFinder connected');
    await getStatus();
    setTimeout(() => $('connectDialog').close(), 900);
  } catch (e) {
    state.className = 'connect-state error';
    state.textContent = e.message || 'Could not connect PickFinder.';
  } finally {
    button.disabled = false;
    button.textContent = 'Connect & verify';
  }
});

$('disconnectBtn').addEventListener('click', async () => {
  const button = $('disconnectBtn');
  button.disabled = true;
  try {
    await request('/api/disconnect', { method: 'POST' });
    $('disconnectDialog').close();
    toast('PickFinder disconnected and saved session erased');
    await getStatus();
  } catch (e) {
    toast(e.message || 'Disconnect failed');
  } finally { button.disabled = false; }
});

$('closeDialog').addEventListener('click', () => $('detailsDialog').close());
$('detailsDialog').addEventListener('click', (event) => { if (event.target === $('detailsDialog')) $('detailsDialog').close(); });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close)?.close()));
for (const id of ['connectionBadge','connectBtn','manageConnectionBtn']) $(id).addEventListener('click', openConnectionDialog);
$('scanBtn').addEventListener('click', startScan);
$('heroScanBtn').addEventListener('click', startScan);
$('entryAmount')?.addEventListener('input', renderPayout);
$('propSearch')?.addEventListener('input', (event) => { searchQuery = String(event.target.value || '').trim(); renderPicks(); });
$('sportFilter')?.addEventListener('change', (event) => { sportFilter = String(event.target.value || 'ALL').toUpperCase(); renderPicks(); });

document.querySelectorAll('.segment').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.segment').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  currentFilter = button.dataset.filter;
  renderPicks();
}));

(async function boot() {
  const unlocked = await bootAuth();
  if (unlocked) await getStatus({ quiet: false });
})();
