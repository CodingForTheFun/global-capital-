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
  return value === null || value === undefined || value === '' ? 'N/A' : `${esc(value)}${suffix}`;
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
  if (prop?.sportsbook) return prop.sportsbook;
  if (String(prop?.provider || '').toLowerCase() === 'pickfinder') return 'PickFinder';
  if (String(prop?.provider || '').toLowerCase() === 'sportsdataio') return 'SportsDataIO';
  return prop?.sourceLabel || prop?.provider || 'Source';
}

function rate(value) {
  const number = finiteOrNull(value);
  return number === null ? 'N/A' : `${Math.round(number)}%`;
}

function metricBar(label, value) {
  const numeric = finiteOrNull(value);
  const width = numeric === null ? 0 : Math.max(0, Math.min(100, numeric));
  return `<div class="history-metric"><div><span>${esc(label)}</span><b>${rate(value)}</b></div><i><em style="width:${width}%"></em></i></div>`;
}

function recentBoxes(prop) {
  const rows = Array.isArray(prop?.lastFiveResults) ? prop.lastFiveResults.slice(0, 5) : [];
  const filled = rows.map((game) => {
    const state = game?.hit === true ? 'hit' : game?.hit === false ? 'miss' : 'push';
    const value = finiteOrNull(game?.value);
    return `<span class="recent-box ${state}" title="${value === null ? 'No result' : esc(value)}">${value === null ? '—' : esc(value)}</span>`;
  });
  while (filled.length < 5) filled.push('<span class="recent-box empty">—</span>');
  return filled.join('');
}

export function renderPropCard(prop, { rank = null } = {}) {
  const score = finiteOrNull(prop?.score);
  const live = prop?.liveStatus === 'LIVE';
  const rates = prop?.hitRates || {};
  const confidence = finiteOrNull(prop?.confidence);
  const matchup = [prop?.team, prop?.opponent ? `vs ${prop.opponent}` : null].filter(Boolean).join(' · ');
  const badges = [];
  if (live) badges.push('<span class="context-badge live">LIVE</span>');
  if (prop?.injuryStatus) badges.push(`<span class="context-badge ${String(prop.injuryStatus).toUpperCase() === 'ACTIVE' ? 'good' : 'warn'}">${esc(prop.injuryStatus)}</span>`);
  if (prop?.lineupStatus) badges.push(`<span class="context-badge good">${esc(prop.lineupStatus)}</span>`);
  if (prop?.ruleResults?.qualified === true) badges.push('<span class="context-badge good">RULES PASS</span>');

  return `<article class="prop-card compact-card" tabindex="0" role="button" data-prop-id="${esc(prop?.id)}" aria-label="Open ${esc(prop?.playerName || 'player')} ${esc(prop?.market || 'prop')} details">
    ${rank ? `<span class="rank-badge">#${rank}</span>` : ''}
    <div class="prop-source"><span>${esc(sourceLabel(prop))}</span><time>${prop?.updatedAt ? esc(fmtTime(prop.updatedAt)) : 'freshness N/A'}</time></div>
    <div class="prop-top compact-top">
      <div class="player-block">
        <small>${esc(prop?.sport || 'SPORT')}${prop?.gameStartTime ? ` · ${esc(fmtTime(prop.gameStartTime))}` : ''}</small>
        <h3>${esc(prop?.playerName || 'Player unavailable')}</h3>
        <p>${matchup ? esc(matchup) : 'Matchup unavailable'}</p>
      </div>
      <div class="score-badge"><strong>${score ?? '—'}</strong><small>Scout</small></div>
    </div>
    <div class="market-line compact-market">
      <div><b>${esc(prop?.marketDisplayName || prop?.market || 'Prop')} ${display(prop?.line)}</b><small>${prop?.projection !== null && prop?.projection !== undefined ? `Projection ${display(prop.projection)}` : 'Projection N/A'}</small></div>
      <span class="side-pill ${String(prop?.side || '').toLowerCase()}">${esc(prop?.side || '—')}</span>
    </div>
    <div class="recent-form"><div class="recent-head"><span>LAST 5</span><b>${rate(rates.l5)}</b></div><div class="recent-boxes">${recentBoxes(prop)}</div></div>
    <div class="history-grid">
      ${metricBar('L10', rates.l10)}
      ${metricBar('L15', rates.l15)}
      ${metricBar('H2H', rates.h2h)}
      ${metricBar('W/L', prop?.expectedOutcomeRate)}
    </div>
    <div class="confidence-row"><div><span>Confidence</span><b>${confidence === null ? 'N/A' : `${Math.round(confidence)}%`}</b></div><i><em style="width:${confidence === null ? 0 : Math.max(0, Math.min(100, confidence))}%"></em></i></div>
    ${live ? `<div class="live-progress"><span>Current</span><strong>${display(prop?.liveStat)}</strong><small>${esc(prop?.gamePeriod || '')}${prop?.gameClock ? ` · ${esc(prop.gameClock)}` : ''}</small></div>` : ''}
    <div class="card-foot"><div class="context-badges">${badges.join('')}</div><span class="details-link">Details ›</span></div>
  </article>`;
}

export function renderPropCardsMarkup(rows = [], { mode = 'all', offset = 0 } = {}) {
  return rows.map((prop, index) => renderPropCard(prop, {
    rank: mode === 'best' ? (prop.rank || offset + index + 1) : null,
  })).join('');
}
