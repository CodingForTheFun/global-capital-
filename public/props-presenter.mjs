export function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function display(value, suffix = '') {
  return value === null || value === undefined || value === '' ? '—' : `${esc(value)}${suffix}`;
}

export function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—';
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
}

export function bestHitRate(prop) {
  const values = Object.values(prop?.hitRates || {}).map(finiteOrNull).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

export function projectionEdge(prop) {
  const projection = finiteOrNull(prop?.projection);
  const line = finiteOrNull(prop?.line);
  if (projection === null || line === null) return null;
  return String(prop.side).toUpperCase() === 'UNDER' ? line - projection : projection - line;
}

function sourceLabel(prop) {
  if (prop?.sourceLabel) return prop.sourceLabel;
  if (prop?.sportsbook) return `SportsDataIO · ${prop.sportsbook}`;
  if (String(prop?.provider || '').toLowerCase() === 'pickfinder') return 'PickFinder research';
  return prop?.provider ? String(prop.provider) : 'Source unavailable';
}

export function renderPropCard(prop, { rank = null } = {}) {
  const hit = bestHitRate(prop);
  const projEdge = projectionEdge(prop);
  const score = finiteOrNull(prop?.score);
  const tier = String(prop?.qualityTier || '').toLowerCase();
  const live = prop?.liveStatus === 'LIVE';
  const badges = [];
  if (live) badges.push('<span class="context-badge live">LIVE</span>');
  if (prop?.injuryStatus) badges.push(`<span class="context-badge ${String(prop.injuryStatus).toUpperCase() === 'ACTIVE' ? 'good' : 'warn'}">${esc(prop.injuryStatus)}</span>`);
  if (prop?.lineupStatus) badges.push(`<span class="context-badge good">${esc(prop.lineupStatus)}</span>`);
  if (prop?.ruleResults?.qualified === true) badges.push('<span class="context-badge good">Rules pass</span>');
  if (prop?.sportsbookCount > 1) badges.push(`<span class="context-badge">${esc(prop.sportsbookCount)} books</span>`);

  return `<article class="prop-card" tabindex="0" role="button" data-prop-id="${esc(prop?.id)}" aria-label="Open ${esc(prop?.playerName || 'player')} ${esc(prop?.market || 'prop')} details">
    ${rank ? `<span class="rank-badge">#${rank}</span>` : ''}
    <div class="prop-source"><span>${esc(sourceLabel(prop))}</span><time>${prop?.updatedAt ? esc(fmtTime(prop.updatedAt)) : 'freshness —'}</time></div>
    <div class="prop-top">
      <div class="player-block">
        <small>${esc(prop?.sport || 'SPORT')} · ${prop?.gameStartTime ? esc(fmtTime(prop.gameStartTime)) : 'TIME —'}</small>
        <h3>${esc(prop?.playerName || 'Player')}</h3>
        <p>${prop?.team ? esc(prop.team) : 'Team —'}${prop?.opponent ? ` · vs ${esc(prop.opponent)}` : ''}</p>
      </div>
      <div class="score-badge ${tier === 'elite' || tier === 'strong' ? 'elite' : ''}"><strong>${score ?? '—'}</strong><small>Scout</small></div>
    </div>
    <div class="market-line">
      <div><b>${esc(prop?.marketDisplayName || prop?.market || 'Prop')} · ${display(prop?.line)}</b><small>${prop?.projection !== null && prop?.projection !== undefined ? `Projection ${display(prop.projection)} · ${esc(prop.projectionSource || 'provider')}` : 'Projection unavailable'}</small></div>
      <span class="side-pill ${String(prop?.side || '').toLowerCase()}">${esc(prop?.side || '—')}</span>
    </div>
    ${live ? `<div class="live-progress"><span>Current live stat</span><strong>${display(prop?.liveStat)}</strong><small>${esc(prop?.gamePeriod || '')}${prop?.gameClock ? ` · ${esc(prop.gameClock)}` : ''}</small></div>` : ''}
    <div class="metrics">
      <div class="metric"><span>Best hit</span><b>${hit === null ? '—' : `${hit}%`}</b></div>
      <div class="metric"><span>Proj edge</span><b>${projEdge === null ? '—' : `${projEdge > 0 ? '+' : ''}${projEdge.toFixed(1)}`}</b></div>
      <div class="metric"><span>Minutes</span><b>${display(prop?.expectedMinutes)}</b></div>
    </div>
    <div class="card-foot"><div class="context-badges">${badges.join('')}</div><span class="details-link">Details ›</span></div>
  </article>`;
}

export function renderPropCardsMarkup(rows = [], { mode = 'all', offset = 0 } = {}) {
  return rows.map((prop, index) => renderPropCard(prop, {
    rank: mode === 'best' ? (prop.rank || offset + index + 1) : null,
  })).join('');
}
