const $ = (id) => document.getElementById(id);
const state = {
  sport: '', timer: null, loading: false, detailLoading: false, lastLiveCount: 0,
  games: [], gameMap: new Map(), selectedId: null, detail: null, tab: 'feed',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function display(value) { return value === null || value === undefined || value === '' ? '—' : esc(value); }
function safeUrl(value) {
  if (!value) return null;
  try { const url = new URL(String(value), location.origin); return url.protocol === 'https:' || url.origin === location.origin ? url.href : null; }
  catch { return null; }
}
function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
}
function fmtStart(value) {
  if (!value) return 'TBD';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'TBD';
}
async function api(path) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (response.status === 401) { location.href = '/'; throw new Error('Authentication required'); }
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body;
}

function statusText(game) {
  if (!game) return 'Status unavailable';
  if (game.status === 'LIVE' || game.status === 'DELAYED') {
    if (game.statusDetail) return game.statusDetail;
    const parts = [game.periodLabel, game.clock].filter(Boolean);
    return parts.join(' · ') || (game.status === 'DELAYED' ? 'Delayed' : 'In progress');
  }
  if (game.status === 'FINAL') return game.statusDetail || 'Final';
  if (game.status === 'POSTPONED') return 'Postponed';
  if (game.status === 'CANCELED') return 'Canceled';
  if (game.status === 'SCHEDULED') return fmtStart(game.startTime);
  return game.providerStatus || game.statusDetail || 'Status unavailable';
}
function logoHtml(url, label) {
  const safe = safeUrl(url);
  return safe ? `<img class="team-logo" src="${esc(safe)}" alt="" loading="lazy" />` : `<span class="team-logo placeholder" aria-hidden="true">${esc(String(label || '?').slice(0, 3))}</span>`;
}
function gameCard(game) {
  const live = game.status === 'LIVE' || game.status === 'DELAYED';
  const selected = state.selectedId === game.id;
  const venue = [game.venue, game.city].filter(Boolean).join(' · ');
  return `<button class="game-card ${live ? 'live' : ''} ${selected ? 'selected' : ''}" data-game-id="${esc(game.id)}" type="button" aria-pressed="${selected}">
    <span class="game-card-inner">
      <span class="game-card-head"><span class="game-state ${live ? 'live' : ''}">${esc(live ? 'LIVE' : game.status || 'GAME')}</span><span class="game-meta">${esc(game.league || game.sport || '')} · ${esc(statusText(game))}</span></span>
      <span class="team-row"><span class="team-name">${logoHtml(game.awayLogo, game.awayTeam)}<b>${display(game.awayTeamName || game.awayTeam)}</b></span><strong class="team-score">${display(game.awayScore)}</strong></span>
      <span class="team-row"><span class="team-name">${logoHtml(game.homeLogo, game.homeTeam)}<b>${display(game.homeTeamName || game.homeTeam)}</b>${game.sport !== 'TENNIS' ? '<span class="home-tag">HOME</span>' : ''}</span><strong class="team-score">${display(game.homeScore)}</strong></span>
      <span class="game-footer"><span>${game.possession ? `Possession ${esc(game.possession)}` : venue ? esc(venue) : 'Live scoreboard'}</span><span>${game.broadcasts?.length ? esc(game.broadcasts.slice(0, 2).join(' · ')) : ''}</span></span>
    </span>
  </button>`;
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
  const sports = Array.isArray(snapshot.supportedSports) ? snapshot.supportedSports : [...new Set((snapshot.coverage || []).map((row) => row.sport))];
  $('liveSportChips').innerHTML = `<button class="quick-chip ${!state.sport ? 'active' : ''}" data-sport="" type="button">All</button>` + sports.map((sport) => `<button class="quick-chip ${state.sport === sport ? 'active' : ''}" data-sport="${esc(sport)}" type="button">${esc(sport)}</button>`).join('');
}
function renderCoverage(snapshot) {
  const rows = snapshot.coverage || [];
  const working = rows.filter((row) => row.status === 200).length;
  const degraded = rows.filter((row) => row.status !== 200 || row.errorType === 'PARTIAL_COVERAGE').length;
  const prefix = snapshot.zeroCredit ? 'Zero-credit public feeds' : 'Live feeds';
  $('coverageSummary').innerHTML = `${esc(prefix)} · ${working}/${rows.length || 0} active${degraded ? ` · <span class="coverage-bad">${degraded} limited</span>` : ''}`;
}
function renderGames() {
  $('gameGrid').innerHTML = state.games.length
    ? state.games.slice(0, 100).map(gameCard).join('')
    : '<div class="empty-state"><b>No games on this slate</b>There are no live, scheduled, or recently completed games available for this filter right now.</div>';
}

function centerLogo(url, label) {
  const safe = safeUrl(url);
  return safe ? `<img src="${esc(safe)}" alt="" />` : `<span class="team-logo placeholder" aria-hidden="true">${esc(String(label || '?').slice(0, 3))}</span>`;
}
function centerScoreboard(game) {
  const live = game.status === 'LIVE' || game.status === 'DELAYED';
  const status = statusText(game);
  const extras = [game.venue, game.city, ...(game.broadcasts || []).slice(0, 2)].filter(Boolean);
  return `<div class="center-scoreboard">
    <div class="center-topline"><div class="center-league">${live ? '<span class="live-badge">LIVE</span>' : ''}<span>${esc(game.league || game.sport)}</span></div><div class="center-status">${esc(status)}</div></div>
    <div class="center-matchup">
      <div class="center-team away">${centerLogo(game.awayLogo, game.awayTeam)}<div class="center-team-copy"><small>${game.sport === 'TENNIS' ? 'Player' : 'Away'}</small><b>${display(game.awayTeamName || game.awayTeam)}</b></div></div>
      <div class="center-score"><span>${display(game.awayScore)}</span><i>–</i><span>${display(game.homeScore)}</span></div>
      <div class="center-team home"><div class="center-team-copy"><small>${game.sport === 'TENNIS' ? 'Player' : 'Home'}</small><b>${display(game.homeTeamName || game.homeTeam)}</b></div>${centerLogo(game.homeLogo, game.homeTeam)}</div>
    </div>
    ${extras.length ? `<div class="center-subline">${extras.map((value) => `<span>${esc(value)}</span>`).join('')}</div>` : ''}
  </div>`;
}
function tabsHtml() {
  return `<div class="center-tabs" role="tablist" aria-label="Game center views">
    <button class="center-tab ${state.tab === 'feed' ? 'active' : ''}" data-center-tab="feed" type="button" role="tab" aria-selected="${state.tab === 'feed'}">Live feed</button>
    <button class="center-tab ${state.tab === 'box' ? 'active' : ''}" data-center-tab="box" type="button" role="tab" aria-selected="${state.tab === 'box'}">Box score</button>
    <button class="center-tab ${state.tab === 'stats' ? 'active' : ''}" data-center-tab="stats" type="button" role="tab" aria-selected="${state.tab === 'stats'}">Team stats</button>
  </div>`;
}
function leaderHtml(leader) {
  return `<div class="leader-card"><small>${esc(leader.category || 'Leader')}</small><b>${esc(leader.athlete?.name || leader.athlete?.shortName || '—')}</b><strong>${display(leader.value)}</strong><span>${esc(leader.team?.abbreviation || leader.team?.shortName || '')}</span></div>`;
}
function feedHtml(detail) {
  const leaders = (detail?.leaders || []).slice(0, 6);
  const plays = (detail?.plays?.length ? detail.plays : detail?.scoringPlays || []).slice().reverse();
  return `${leaders.length ? `<div class="leaders-grid">${leaders.map(leaderHtml).join('')}</div>` : ''}
    <div class="feed-list">${plays.length ? plays.map((play) => {
      const period = [play.periodLabel || (play.period ? `P${play.period}` : null), play.clock].filter(Boolean).join(' · ');
      const score = play.awayScore !== null && play.awayScore !== undefined && play.homeScore !== null && play.homeScore !== undefined ? `${play.awayScore} – ${play.homeScore}` : '';
      return `<article class="play-row ${play.scoringPlay ? 'scoring' : ''}"><div class="play-time"><b>${esc(period || 'Game')}</b>${play.team ? esc(play.team) : ''}</div><div class="play-copy">${esc(play.text)}${score ? `<div class="play-score">Score ${esc(score)}</div>` : ''}</div>${play.scoringPlay ? '<span class="play-tag">Score</span>' : ''}</article>`;
    }).join('') : '<div class="empty-state"><b>Play-by-play unavailable</b>This event is on the scoreboard, but its live event stream is not currently available.</div>'}</div>`;
}
function boxHtml(detail) {
  const groups = detail?.playerGroups || [];
  if (!groups.length) return '<div class="empty-state"><b>Box score unavailable</b>Player-level box score data has not been supplied for this event yet.</div>';
  return groups.map((group) => {
    const labels = group.labels || [];
    const teamName = group.team?.abbreviation || group.team?.shortName || group.team?.name || 'Team';
    const logo = safeUrl(group.team?.logo);
    return `<section class="box-group"><div class="box-group-head">${logo ? `<img src="${esc(logo)}" alt="" />` : ''}<b>${esc(teamName)} · ${esc(group.name || 'Players')}</b></div><div class="box-scroll"><table class="box-table"><thead><tr><th>Player</th>${labels.map((label) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${group.athletes.map((athlete) => `<tr><td><span class="box-player"><span>${esc(athlete.name)}${athlete.position ? ` <small>${esc(athlete.position)}</small>` : ''}</span></span></td>${labels.map((_, index) => `<td>${display(athlete.stats?.[index])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }).join('');
}
function statsHtml(detail) {
  const teams = detail?.teamStats || [];
  if (!teams.length) return '<div class="empty-state"><b>Team stats unavailable</b>Verified team-level live statistics have not been supplied for this event yet.</div>';
  return teams.map((row) => {
    const name = row.team?.abbreviation || row.team?.shortName || row.team?.name || 'Team';
    const logo = safeUrl(row.team?.logo);
    return `<section class="stat-team"><div class="stat-team-head">${logo ? `<img src="${esc(logo)}" alt="" />` : ''}<b>${esc(name)}</b></div><div class="stat-list">${(row.stats || []).map((stat) => `<div class="stat-cell"><span title="${esc(stat.label || stat.name || '')}">${esc(stat.label || stat.name || 'Stat')}</span><strong>${display(stat.value)}</strong></div>`).join('')}</div></section>`;
  }).join('');
}
function renderGameCenter() {
  const game = state.gameMap.get(state.selectedId);
  if (!game) {
    $('gameCenter').innerHTML = '<div class="game-center-empty"><b>Select a game</b><span>Tap any score card to open its live play feed and stat board.</span></div>';
    return;
  }
  const body = state.detailLoading ? '<div class="detail-loading">Loading verified game details</div>'
    : !state.detail?.available ? '<div class="empty-state"><b>Detailed feed unavailable</b>The scoreboard is active, but play-by-play or box-score detail is not available for this event yet.</div>'
    : state.tab === 'box' ? boxHtml(state.detail) : state.tab === 'stats' ? statsHtml(state.detail) : feedHtml(state.detail);
  $('gameCenter').innerHTML = `${centerScoreboard(state.detail?.game || game)}${tabsHtml()}<div class="center-body">${body}</div>`;
}

async function loadSelectedDetail({ force = false } = {}) {
  const game = state.gameMap.get(state.selectedId);
  if (!game || state.detailLoading) return;
  state.detailLoading = true;
  renderGameCenter();
  try {
    const query = new URLSearchParams({ sport: game.sport, eventId: game.eventId || game.gameId });
    if (game.providerLeague) query.set('league', game.providerLeague);
    if (game.competitionId) query.set('competitionId', game.competitionId);
    if (force) query.set('force', '1');
    const response = await api(`/api/live/game?${query}`);
    state.detail = response.detail || null;
  } catch {
    state.detail = null;
  } finally {
    state.detailLoading = false;
    renderGameCenter();
  }
}

function selectGame(id, { scroll = false, force = false } = {}) {
  if (!state.gameMap.has(id)) return;
  const changed = state.selectedId !== id;
  state.selectedId = id;
  if (changed) { state.detail = null; state.tab = 'feed'; }
  renderGames();
  renderGameCenter();
  loadSelectedDetail({ force });
  if (scroll) $('gameCenter').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function scheduleNext() {
  clearTimeout(state.timer);
  if (!$('autoRefresh').checked) { $('pollStatus').textContent = 'Auto refresh paused'; return; }
  const delay = state.lastLiveCount > 0 ? 15_000 : 45_000;
  $('pollStatus').textContent = state.lastLiveCount > 0 ? 'Refreshing every 15s while live' : 'Refreshing every 45s';
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
    state.games = [...liveGames, ...upcoming, ...finals];
    state.gameMap = new Map(state.games.map((game) => [game.id, game]));

    $('liveNowCount').textContent = liveGames.length.toLocaleString();
    $('upcomingCount').textContent = upcoming.length.toLocaleString();
    $('livePlayerCount').textContent = playerProps.length.toLocaleString();
    $('liveUpdated').textContent = fmtTime(games.fetchedAt);
    $('liveHealth').textContent = liveGames.length ? 'Live feed · active' : 'Live feed · connected';
    $('liveHealth').classList.add('active');
    renderSports(games);
    renderCoverage(games);

    if (!state.selectedId || !state.gameMap.has(state.selectedId)) {
      state.selectedId = (liveGames[0] || state.games[0] || {}).id || null;
      state.detail = null;
    }
    renderGames();
    $('livePlayerGrid').innerHTML = playerProps.length
      ? playerProps.map(playerCard).join('')
      : '<div class="empty-state"><b>No live prop progress yet</b>Line-vs-current data appears when an active prop and a verified in-game stat feed overlap.</div>';

    const limited = (games.coverage || []).filter((row) => row.status !== 200);
    if (limited.length && limited.length === (games.coverage || []).length) {
      $('liveNotice').hidden = false;
      $('liveNotice').dataset.kind = 'error';
      $('liveNotice').textContent = 'Live public feeds are temporarily unavailable for the selected sports.';
    } else {
      $('liveNotice').hidden = true;
    }
    renderGameCenter();
    if (state.selectedId) await loadSelectedDetail({ force });
  } catch (error) {
    $('liveHealth').textContent = 'Live feed · unavailable';
    $('liveHealth').classList.remove('active');
    $('liveNotice').hidden = false;
    $('liveNotice').dataset.kind = 'error';
    $('liveNotice').textContent = error?.message || 'Live data could not be loaded.';
    $('gameGrid').innerHTML = '<div class="empty-state"><b>Live data unavailable</b>Oblige Props will retry when auto refresh is enabled.</div>';
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
  state.selectedId = null;
  state.detail = null;
  state.tab = 'feed';
  loadLive({ force: true });
});
$('gameGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-game-id]');
  if (button) selectGame(button.dataset.gameId, { scroll: true, force: true });
});
$('gameCenter').addEventListener('click', (event) => {
  const button = event.target.closest('[data-center-tab]');
  if (!button) return;
  state.tab = button.dataset.centerTab;
  renderGameCenter();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(state.timer);
  else loadLive();
});

loadLive();
