import { canonicalSport, marketContract, numeric } from '../data-sources/espn/stat-contract.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const iso = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function walk(root, out = []) {
  if (!root || typeof root !== 'object') return out;
  if (Array.isArray(root)) { for (const row of root) walk(row, out); return out; }
  const player = text(root.playerName || root.player_name || root.participant?.name || root.competitor?.name || root.player?.name);
  const market = text(root.marketName || root.market_name || root.statType || root.stat_type || root.market?.name || root.type);
  const line = numeric(root.line ?? root.points ?? root.total ?? root.value ?? root.handicap);
  if (player && market && line !== null) out.push(root);
  for (const value of Object.values(root)) if (value && typeof value === 'object') walk(value, out);
  return out;
}

function priceOf(row, side) {
  const direct = side === 'OVER' ? row.overOdds ?? row.over_odds ?? row.over?.odds ?? row.over?.price : row.underOdds ?? row.under_odds ?? row.under?.odds ?? row.under?.price;
  const n = numeric(direct);
  return n !== null && Math.abs(n) >= 100 ? n : -110;
}

/** Conservative Fliff parser. Unknown rows are skipped rather than guessed. */
export function normalizeFliff(payload) {
  const candidates = walk(payload);
  const output = [];
  for (const row of candidates) {
    const playerName = text(row.playerName || row.player_name || row.participant?.name || row.competitor?.name || row.player?.name);
    const market = text(row.marketName || row.market_name || row.statType || row.stat_type || row.market?.name || row.type);
    const sport = canonicalSport(row.sport || row.sportKey || row.league || row.leagueCode || row.event?.league);
    const line = numeric(row.line ?? row.points ?? row.total ?? row.value ?? row.handicap);
    const start = iso(row.startTime || row.start_time || row.event?.startTime || row.event?.start_time || row.event?.scheduledAt);
    const contract = marketContract({ sport, market });
    if (!playerName || !contract || contract.entityType !== 'player' || line === null || !start) continue;
    const id = text(row.id || row.lineId || row.marketId || `${playerName}:${market}:${line}:${start}`);
    output.push({
      sourceId: id, book: 'fliff', nativePlayerId: text(row.playerId || row.player_id || row.player?.id || playerName), playerName, sport, market, line,
      team: text(row.team || row.player?.team), opponent: text(row.opponent), nativeEventId: text(row.eventId || row.event_id || row.event?.id),
      homeTeam: text(row.homeTeam || row.home_team || row.event?.homeTeam), awayTeam: text(row.awayTeam || row.away_team || row.event?.awayTeam),
      gameStartTime: start, updatedAt: iso(row.updatedAt || row.updated_at) || new Date().toISOString(), position: text(row.position || row.player?.position),
      headshot: text(row.image || row.headshot || row.player?.image), sides: ['OVER','UNDER'], overOdds: priceOf(row,'OVER'), underOdds: priceOf(row,'UNDER'),
      contract, isAlternate: false, promotion: null,
    });
  }
  return output;
}
