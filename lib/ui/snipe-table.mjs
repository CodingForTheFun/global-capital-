import { findSnipeOpportunities } from '../markets/line-lag.mjs';

const text = (value) => String(value ?? '').trim();
const esc = (value) => text(value).replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const fmt = (value) => {
  const parsed = num(value);
  if (parsed === null) return '—';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};
const money = (value) => {
  const parsed = num(value);
  if (parsed === null) return '';
  return `${parsed > 0 ? '+' : ''}${parsed}`;
};
const when = (value) => {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return 'TBD';
  return date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};
const age = (ms) => {
  const value = num(ms);
  if (value === null) return 'Current feed';
  if (value < 60_000) return `${Math.max(0, Math.round(value / 1000))}s old`;
  return `${Math.max(1, Math.round(value / 60_000))}m old`;
};

function matchesQuery(group, query) {
  const needle = text(query).toLowerCase();
  if (!needle) return true;
  return [group.playerName, group.market, group.marketId, group.team, group.homeTeam, group.awayTeam]
    .some((value) => text(value).toLowerCase().includes(needle));
}

/**
 * Build the Snipes board independently from the normal research-card filters.
 * All books remain available as market references; targetBooks only limits
 * where the actionable quote may be placed.
 */
export function buildSnipeRows(groups = [], {
  sport = null,
  targetBooks = null,
  query = '',
  market = 'all',
  side = 'all',
  now = Date.now(),
} = {}) {
  const wantedSport = text(sport).toUpperCase();
  const wantedMarket = text(market).toLowerCase();
  const wantedSide = text(side).toUpperCase();
  const rows = [];

  for (const group of Array.isArray(groups) ? groups : []) {
    if (wantedSport && text(group?.sport).toUpperCase() !== wantedSport) continue;
    if (!matchesQuery(group, query)) continue;
    if (wantedMarket && wantedMarket !== 'all') {
      const labels = [group?.market, group?.marketId].map((value) => text(value).toLowerCase());
      if (!labels.includes(wantedMarket)) continue;
    }
    const offers = Array.isArray(group?.comparisonOffers) ? group.comparisonOffers : group?.rows;
    for (const signal of findSnipeOpportunities(offers, { now, targetBooks })) {
      if (wantedSide && wantedSide !== 'ALL' && signal.side !== wantedSide) continue;
      rows.push({
        ...signal,
        id: [group?.key, signal.targetKey, signal.side, signal.line].join('|'),
        groupKey: group?.key,
        sport: group?.sport,
        playerName: group?.playerName,
        market: group?.market,
        marketId: group?.marketId,
        team: group?.team,
        homeTeam: group?.homeTeam,
        awayTeam: group?.awayTeam,
        gameStartTime: group?.gameStartTime,
      });
    }
  }

  return rows.sort((a, b) => (b.score || 0) - (a.score || 0)
    || text(a.playerName).localeCompare(text(b.playerName))
    || text(a.market).localeCompare(text(b.market)));
}

function edgeLabel(row) {
  if (row.kind === 'line-consensus' || row.kind === 'sharp-line') return `+${fmt(row.lineGap)} line`;
  if (num(row.edgePct) !== null) return `+${fmt(row.edgePct)}% EV`;
  if (num(row.edgePoints) !== null) return `+${fmt(row.edgePoints)} pts`;
  return 'Market edge';
}

function referenceLabel(row) {
  if (row.kind === 'price-consensus') {
    const fair = num(row.fairProbability);
    return fair === null ? 'No-vig market' : `Fair ${(fair * 100).toFixed(1)}%`;
  }
  if (row.kind === 'sharp-price') return `${text(row.referenceBook) || 'Sharp'} ${money(row.referencePrice)}`;
  if (row.kind === 'sharp-line') return `${text(row.referenceBook) || 'Sharp'} ${fmt(row.referenceLine)}`;
  return `Consensus ${fmt(row.referenceLine)}`;
}

function supportLabel(row) {
  if (row.kind === 'sharp-line' || row.kind === 'sharp-price') return 'Sharp confirmed';
  const support = num(row.supportCount);
  const refs = num(row.referenceCount);
  if (support !== null && refs !== null) return `${support}/${refs} refs`;
  return text(row.quality) || 'Market backed';
}

export function snipeTableHtml(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const style = `<style id="asSnipeTableStyle">
  .asSnipeTable{display:grid;gap:7px;min-width:760px}.asSnipeHead,.asSnipeRow{display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(155px,.9fr) minmax(155px,.9fr) 110px 110px;align-items:center}.asSnipeHead{padding:0 13px 6px;color:#657389;font-size:8px;font-weight:950;text-transform:uppercase;letter-spacing:.07em}.asSnipeRow{border:1px solid var(--line);background:linear-gradient(180deg,var(--panel2),var(--panel));border-radius:12px;min-height:76px;overflow:hidden;cursor:pointer}.asSnipeRow:focus{outline:2px solid var(--blue);outline-offset:2px}.asSnipeCell{padding:11px 12px;border-left:1px solid rgba(49,65,95,.45);min-width:0}.asSnipeWho{border-left:0}.asSnipeWho b,.asSnipeCell b{display:block;color:var(--text);font-size:12px;line-height:1.2}.asSnipeWho small,.asSnipeCell small{display:block;color:var(--muted);font-size:8px;line-height:1.4;margin-top:4px}.asSnipeTake b{color:var(--green)}.asSnipeEdge b{color:#f0c45f}.asSnipeTag{display:inline-flex;margin-top:6px;border:1px solid #355171;border-radius:999px;padding:3px 6px;color:#a9c8f8;font-size:7px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.asSnipeFresh{color:#7ef0bd!important}.asSnipeViewport{overflow-x:auto;-webkit-overflow-scrolling:touch}
  @media(max-width:760px){.asSnipeViewport{overflow:visible}.asSnipeTable{min-width:0}.asSnipeHead{display:none}.asSnipeRow{grid-template-columns:1fr 1fr;min-height:0}.asSnipeWho{grid-column:1/-1;border-bottom:1px solid rgba(49,65,95,.45)}.asSnipeCell{border-left:0;border-top:1px solid rgba(49,65,95,.25);padding:10px}.asSnipeWho+.asSnipeCell{border-top:0}.asSnipeWho{padding:12px}.asSnipeSupport{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:10px}.asSnipeSupport small{margin:0}}
  </style>`;

  const head = '<div class="asSnipeHead" role="row"><span>Player / market</span><span>Take this quote</span><span>Market reference</span><span>Edge</span><span>Evidence</span></div>';
  const body = items.map((row) => {
    const matchup = row.awayTeam || row.homeTeam ? `${text(row.awayTeam) || 'Away'} @ ${text(row.homeTeam) || 'Home'}` : text(row.team);
    const target = `${text(row.targetBook) || text(row.targetKey)} · ${row.side} ${fmt(row.line)}${num(row.price) !== null ? ` (${money(row.price)})` : ''}`;
    const reference = referenceLabel(row);
    return `<div class="asSnipeRow" role="row" tabindex="0" data-open="${esc(row.groupKey)}" data-snipe-id="${esc(row.id)}">
      <div class="asSnipeCell asSnipeWho"><b>${esc(row.playerName)}</b><small>${esc(row.market)} · ${esc(matchup)} · ${esc(when(row.gameStartTime))}</small><span class="asSnipeTag">${esc(row.quality || 'Market backed')}</span></div>
      <div class="asSnipeCell asSnipeTake"><small>TAKE</small><b>${esc(target)}</b><small>Specific executable snipe</small></div>
      <div class="asSnipeCell"><small>REFERENCE</small><b>${esc(reference)}</b><small>${esc(`${row.referenceCount || 0} reference book${Number(row.referenceCount) === 1 ? '' : 's'}`)}</small></div>
      <div class="asSnipeCell asSnipeEdge"><small>EDGE</small><b>${esc(edgeLabel(row))}</b><small>${esc(row.source || 'market consensus')}</small></div>
      <div class="asSnipeCell asSnipeSupport"><span><small>EVIDENCE</small><b>${esc(supportLabel(row))}</b></span><small class="asSnipeFresh">${esc(age(row.ageMs))}</small></div>
    </div>`;
  }).join('');

  return `${style}<div class="asSnipeViewport"><div class="asSnipeTable" role="table" aria-label="Live snipe opportunities">${head}${body}</div></div>`;
}
