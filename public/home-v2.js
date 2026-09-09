const $ = (id) => document.getElementById(id);
let permissions = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
function show(id, visible = true) { $(id)?.classList.toggle('hidden', !visible); }
function display(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }
function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '—';
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept:'application/json', ...(options.body ? {'content-type':'application/json'} : {}), ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(body?.message || `Request failed (${response.status})`), { status: response.status });
  return body;
}

async function authState() {
  const auth = await api('/api/auth/status');
  permissions = auth;
  if (auth.required && !auth.authenticated) {
    show('authGate', true);
    show('homeApp', false);
    return false;
  }
  show('authGate', false);
  show('homeApp', true);
  $('rolePill').textContent = String(auth.role || 'member').toUpperCase();
  show('adminNav', Boolean(auth.canAdministerOwner));
  show('adminMobile', Boolean(auth.canAdministerOwner));
  return true;
}

function miniProp(prop) {
  const source = prop.sourceLabel || prop.sportsbook || (prop.provider === 'pickfinder' ? 'PickFinder research' : prop.provider) || 'Source';
  return `<article class="mini-prop"><small>${esc(prop.sport || '')} · ${esc(source)}</small><b>${esc(prop.playerName || 'Player')}</b><span class="mini-prop-line"><span>${esc(prop.market || 'Prop')} ${esc(display(prop.line))}</span><strong>${esc(prop.side || '')}</strong></span></article>`;
}
function miniGame(game) {
  const live = game.status === 'LIVE';
  const meta = live ? [game.periodLabel ? `P${game.periodLabel}` : null, game.clock].filter(Boolean).join(' · ') || 'LIVE' : (game.status === 'FINAL' ? 'FINAL' : fmtTime(game.startTime));
  return `<article class="mini-game ${live ? 'live' : ''}"><div class="mini-game-head"><span>${esc(live ? 'LIVE' : game.status || 'GAME')}</span><span>${esc(game.sport || '')} · ${esc(meta)}</span></div><div class="mini-team"><b>${esc(game.awayTeam || 'Away')}</b><strong>${esc(display(game.awayScore))}</strong></div><div class="mini-team"><b>${esc(game.homeTeam || 'Home')}</b><strong>${esc(display(game.homeScore))}</strong></div></article>`;
}

async function loadDashboard() {
  try {
    const [props, live, providers] = await Promise.all([
      api('/api/props?limit=6&timeWindow=TODAY&sort=score-desc'),
      api('/api/live'),
      api('/api/providers'),
    ]);
    const counts = props.counts || {};
    const available = Number(counts.matching ?? counts.total ?? 0) || 0;
    const qualified = Number(counts.qualifiers ?? 0) || 0;
    const sourceRows = Number(props?.universe?.providerNative || 0) || 0;
    const liveCount = Number(live?.live?.length || 0);
    $('availableKpi').textContent = available.toLocaleString();
    $('qualifiedKpi').textContent = qualified.toLocaleString();
    $('liveKpi').textContent = liveCount.toLocaleString();
    $('sourceKpi').textContent = sourceRows.toLocaleString();
    $('homeFreshness').textContent = fmtTime(props?.universe?.providerFetchedAt || props?.scannedAt);
    $('homeFreshnessNote').textContent = props?.universe?.sourceMode === 'provider-native' ? 'Provider-native board' : 'Fallback board';

    const propRows = props.props || [];
    $('homeProps').innerHTML = propRows.length ? propRows.map(miniProp).join('') : '<div class="empty-mini">No valid main-line props are available for the current slate.</div>';
    const games = [...(live.live || []), ...(live.upcoming || [])].slice(0, 5);
    $('homeLive').innerHTML = games.length ? games.map(miniGame).join('') : '<div class="empty-mini">No live or upcoming games are available from supported feeds right now.</div>';

    const sdio = (providers.providers || []).find((row) => row.id === 'sportsdataio');
    $('providerStatus').textContent = sdio?.status === 'active' ? 'CONNECTED' : String(sdio?.status || 'UNKNOWN').toUpperCase();
    $('providerStatus').className = sdio?.status === 'active' ? 'status-good' : 'status-warn';
    $('boardStatus').textContent = props?.universe?.providerError ? 'DEGRADED' : 'READY';
    $('boardStatus').className = props?.universe?.providerError ? 'status-warn' : 'status-good';
    const coverage = live.coverage || [];
    const activeFeeds = coverage.filter((row) => row.status === 200).length;
    $('liveStatus').textContent = `${activeFeeds}/${coverage.length || 0} FEEDS`;
    $('liveStatus').className = activeFeeds ? 'status-good' : 'status-warn';
    $('securityStatus').textContent = 'SERVER-SIDE';
    $('securityStatus').className = 'status-good';
  } catch (error) {
    if (error.status === 401) {
      await authState();
      return;
    }
    $('homeProps').innerHTML = '<div class="empty-mini">Prop data is temporarily unavailable.</div>';
    $('homeLive').innerHTML = '<div class="empty-mini">Live data is temporarily unavailable.</div>';
    $('boardStatus').textContent = 'DEGRADED';
    $('boardStatus').className = 'status-warn';
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('loginSubmit');
  button.disabled = true;
  show('loginError', false);
  try {
    await api('/api/auth/login', { method:'POST', body:JSON.stringify({ password:$('credential').value }) });
    $('credential').value = '';
    if (await authState()) await loadDashboard();
  } catch (error) {
    $('loginError').textContent = error.message || 'Could not unlock Scout Pro.';
    show('loginError', true);
  } finally { button.disabled = false; }
});

$('homeRefresh').addEventListener('click', loadDashboard);
$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method:'POST', body:'{}' }); } catch {}
  location.reload();
});

if (await authState()) loadDashboard();
