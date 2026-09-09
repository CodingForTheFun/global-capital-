const $ = (id) => document.getElementById(id);
const state = { sport: '', timer: null, loading: false, lastLiveCount: 0 };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function display(value) { return value === null || value === undefined || value === '' ? '—' : esc(value); }
function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
}
async function api(path) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (response.status === 401) { location.href = '/'; throw new Error('Authentication required'); }
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body;
}

function statusText(game) {
  if (game.status === 'LIVE') {
    const parts = [game.periodLabel ? `Period ${game.periodLabel}` : null, game.clock].filter(Boolean);
    if (game.inningHalf) parts.unshift(game.inningHalf);
    return parts.join(' · ') || 'In progress';
  }
  if (game.status === 'FINAL') return 'Final';
  if (game.status === 'SCHEDULED') return fmtTime(game.startTime);
  return game.providerStatus || 'Status unavailable';
}

function gameCard(game) {
  const live = game.status === 'LIVE';
  return `<article class="game-card ${live ? 'live' : ''}">
    <div class="game-card-head"><span class="game-state">${esc(live ? 'LIVE' : game.status || 'GAME')}</span><span class="game-meta">${esc(game.sport || '')} · ${esc(statusText(game))}</span></div>
    <div class="team-row"><div class="team-name"><b>${display(game.awayTeam)}</b></div><strong class="team-score">${display(game.awayScore)}</strong></div>
    <div class="team-row"><div class="team-name"><b>${display(game.homeTeam)}</b><span class="home-tag">HOME</span></div><strong class="team-score">${display(game.homeScore)}</strong></div>
    <div class="game-footer"><span>${game.possession ? `Possession ${esc(game.possession)}` : 'Provider live feed'}</span><span>${game.updatedAt ? `Updated ${esc(fmtTime(game.updatedAt))}` : ''}</span></div>
  </article>`;
}

function playerCard(prop) {
  const current = prop.liveStat;
  const line = prop.line;
  const difference = Number.isFinite(Number(current)) && Number.isFinite(Number(line)) ? Number(current) - Number(line) : null;
  return `<article class="live-player-card">
    <div class="live-player-top"><div><small>${esc(prop.sport || '')} · ${esc(prop.market || 'Prop')}</small><h3>${esc(prop.playerName || 'Player')}</h3><p>${prop.team ? esc(prop.team) : 'Team —'}${prop.opponent ? ` · vs ${esc(prop.opponent)}` : ''}</p></div><span class="live-dot">LIVE</span></div>
    <div class="line-v-current"><div><span>Prop line</span><strong>${display(line)}</strong></div><div><span>Current</span><strong>${display(current)}</strong></div></div>
    <div class="player-progress">${prop.gamePeriod ? esc(prop.gamePeriod) : 'In game'}${prop.gameClock ? ` · ${esc(prop.gameClock)}` : ''}${difference === null ? '' : ` · Current minus line ${difference > 0 ? '+' : ''}${esc(difference.toFixed(1))}`}</div>
  </article>`;
}

function renderSports(snapshot) {
  const sports = [...new Set((snapshot.coverage || []).filter((row) => row.recordCount > 0).map((row) => row.sport))].sort();
  $('liveSportChips').innerHTML = `<button class="quick-chip ${!state.sport ? 'active' : ''}" data-sport="" type="button">All</button>` + sports.map((sport) => `<button class="quick-chip ${state.sport === sport ? 'active' : ''}" data-sport="${esc(sport)}" type="button">${esc(sport)}</button>`).join('');
}

function renderCoverage(snapshot) {
  const rows = snapshot.coverage || [];
  const working = rows.filter((row) => row.status === 200).length;
  const degraded = rows.filter((row) => row.status !== 200).length;
  $('coverageSummary').innerHTML = `${working} feeds active${degraded ? ` · <span class="coverage-bad">${degraded} limited</span>` : ''}`;
}

function scheduleNext() {
  clearTimeout(state.timer);
  if (!$('autoRefresh').checked) { $('pollStatus').textContent = 'Auto refresh paused'; return; }
  const delay = state.lastLiveCount > 0 ? 20_000 : 60_000;
  $('pollStatus').textContent = state.lastLiveCount > 0 ? 'Refreshing every 20s while live' : 'Refreshing every 60s';
  state.timer = setTimeout(() => loadLive(), delay);
}

async function loadLive({ force = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $('liveRefresh').disabled = true;
  try {
    const query = new URLSearchParams();
    if (state.sport) query.set('sports', state.sport);
    if (force) query.set('force', '1');
    const suffix = query.toString() ? `?${query}` : '';
    const [games, players] = await Promise.all([
      api(`/api/live${suffix}`),
      api(`/api/live/players${state.sport ? `?sports=${encodeURIComponent(state.sport)}` : ''}`).catch(() => ({ props: [] })),
    ]);
    const liveGames = games.live || [];
    const upcoming = games.upcoming || [];
    const finals = games.final || [];
    const playerProps = players.props || [];
    state.lastLiveCount = liveGames.length;

    $('liveNowCount').textContent = liveGames.length.toLocaleString();
    $('upcomingCount').textContent = upcoming.length.toLocaleString();
    $('livePlayerCount').textContent = playerProps.length.toLocaleString();
    $('liveUpdated').textContent = fmtTime(games.fetchedAt);
    $('liveHealth').textContent = liveGames.length ? 'Live feed · active' : 'Live feed · connected';
    $('liveHealth').classList.add('active');
    renderSports(games);
    renderCoverage(games);

    const displayGames = [...liveGames, ...upcoming, ...finals].slice(0, 80);
    $('gameGrid').innerHTML = displayGames.length
      ? displayGames.map(gameCard).join('')
      : '<div class="empty-state"><b>No games on the current provider slate</b>There are no live or scheduled games available for this filter right now.</div>';
    $('livePlayerGrid').innerHTML = playerProps.length
      ? playerProps.map(playerCard).join('')
      : '<div class="empty-state"><b>No live prop progress yet</b>Player line-vs-current data appears when an active game and supported player-stat feed overlap.</div>';

    const limited = (games.coverage || []).filter((row) => row.status !== 200);
    if (limited.length && limited.length === (games.coverage || []).length) {
      $('liveNotice').hidden = false;
      $('liveNotice').dataset.kind = 'error';
      $('liveNotice').textContent = 'Live provider feeds are currently unavailable for the selected sports.';
    } else {
      $('liveNotice').hidden = true;
    }
  } catch (error) {
    $('liveHealth').textContent = 'Live feed · unavailable';
    $('liveHealth').classList.remove('active');
    $('liveNotice').hidden = false;
    $('liveNotice').dataset.kind = 'error';
    $('liveNotice').textContent = error?.message || 'Live data could not be loaded.';
    $('gameGrid').innerHTML = '<div class="empty-state"><b>Live data unavailable</b>Scout Pro will retry when auto refresh is enabled.</div>';
  } finally {
    state.loading = false;
    $('liveRefresh').disabled = false;
    scheduleNext();
  }
}

$('liveRefresh').addEventListener('click', () => loadLive({ force: true }));
$('autoRefresh').addEventListener('change', scheduleNext);
$('liveSportChips').addEventListener('click', (event) => {
  const button = event.target.closest('[data-sport]');
  if (!button) return;
  state.sport = String(button.dataset.sport || '').toUpperCase();
  loadLive({ force: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(state.timer);
  else loadLive();
});

loadLive();
