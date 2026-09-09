// Provider payloads -> Scout Pro shapes.
//
// Nothing downstream of this file sees a SportsDataIO field name. Every value
// that the provider did not supply stays null: absent is never rendered as 0,
// "unknown" or "neutral".

import { toNumberOrNull } from '../../props/model.mjs';
import { normalizePlayerName } from '../contract.mjs';
import { buildIndex, resolvePlayer, isTrustworthy, sameTeam } from '../identity.mjs';
import { statFromRow, fieldsFor } from './markets.mjs';

export { buildIndex, resolvePlayer, isTrustworthy };

const str = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

/** SportsDataIO injury wording -> the contract's fixed enum. */
export function injuryStatus(value) {
  const text = String(value ?? '').toUpperCase().trim();
  if (!text) return null;
  if (text.startsWith('OUT') || text === 'IR' || text === 'INJURED RESERVE') return 'OUT';
  if (text.startsWith('DOUBTFUL')) return 'DOUBTFUL';
  if (text.startsWith('QUESTIONABLE') || text === 'GTD' || text === 'DAY-TO-DAY' || text === 'DTD') return 'QUESTIONABLE';
  if (text.startsWith('PROBABLE') || text.startsWith('ACTIVE') || text === 'HEALTHY' || text === 'PLAYING') return 'ACTIVE';
  return null; // unrecognised wording is unknown, not a guess
}

/** Game status -> SCHEDULED | LIVE | FINAL. */
export function liveStatus(game) {
  const status = String(game?.Status ?? '').toUpperCase().trim();
  if (['FINAL', 'F/OT', 'COMPLETED', 'CLOSED'].includes(status)) return 'FINAL';
  if (['INPROGRESS', 'IN PROGRESS', 'HALFTIME', 'DELAYED', 'SUSPENDED'].includes(status)) return 'LIVE';
  if (['SCHEDULED', 'PREGAME'].includes(status)) return 'SCHEDULED';
  if (game?.IsClosed === true || game?.IsGameOver === true) return 'FINAL';
  if (game?.IsInProgress === true) return 'LIVE';
  return null;
}

/** Index rows by normalised player name for joining against props. */
export function indexByPlayer(rows = [], nameField = 'Name') {
  const index = new Map();
  for (const row of rows) {
    const key = normalizePlayerName(row?.[nameField] ?? row?.ShortName ?? `${row?.FirstName ?? ''} ${row?.LastName ?? ''}`);
    if (!key) continue;
    // First row wins: provider feeds occasionally repeat a player across slates.
    if (!index.has(key)) index.set(key, row);
  }
  return index;
}

export function indexByTeam(rows = [], field = 'Team') {
  const index = new Map();
  for (const row of rows) {
    const key = String(row?.[field] ?? '').toUpperCase().trim();
    if (key && !index.has(key)) index.set(key, row);
  }
  return index;
}

/** Depth-chart position within a team, which is the role/opportunity signal. */
export function indexDepthChart(payload = []) {
  const index = new Map();
  // Shapes vary by league: some return a flat array of entries, some return
  // per-team objects containing arrays. Handle both without assuming.
  const entries = [];
  for (const row of Array.isArray(payload) ? payload : []) {
    if (Array.isArray(row?.Offense)) entries.push(...row.Offense, ...(row.Defense || []), ...(row.SpecialTeams || []));
    else if (Array.isArray(row?.Players)) entries.push(...row.Players);
    else entries.push(row);
  }
  for (const entry of entries) {
    const key = normalizePlayerName(entry?.Name ?? `${entry?.FirstName ?? ''} ${entry?.LastName ?? ''}`);
    if (!key || index.has(key)) continue;
    const order = toNumberOrNull(entry?.DepthOrder ?? entry?.PositionDepthOrder ?? entry?.DepthChartOrder);
    index.set(key, { depthOrder: order, position: str(entry?.Position) });
  }
  return index;
}

/** Confirmed / projected starting lineups, where a league publishes them. */
export function indexLineups(payload = []) {
  const index = new Map();
  for (const game of Array.isArray(payload) ? payload : []) {
    const confirmed = game?.Confirmed === true || game?.IsConfirmed === true;
    for (const side of ['HomeTeamLineup', 'AwayTeamLineup', 'Lineups', 'PlayerLineups']) {
      for (const entry of Array.isArray(game?.[side]) ? game[side] : []) {
        const key = normalizePlayerName(entry?.Name ?? `${entry?.FirstName ?? ''} ${entry?.LastName ?? ''}`);
        if (!key || index.has(key)) continue;
        index.set(key, {
          lineupStatus: confirmed ? 'CONFIRMED' : 'PROJECTED',
          battingOrder: toNumberOrNull(entry?.BattingOrder ?? entry?.LineupOrder),
        });
      }
    }
  }
  return index;
}

/**
 * Build one prop's enrichment from every feed that answered.
 * Feeds that failed are simply absent from `feeds` and contribute nothing.
 */
export function buildEnrichment(prop, feeds = {}, { fetchedAt = new Date().toISOString() } = {}) {
  // Identity first. Every feed is resolved through the same conservative
  // matcher, so an ambiguous player contributes nothing from any feed.
  const primary = feeds.projections?.byName?.size ? feeds.projections : feeds.playerGameStats;
  const identity = resolvePlayer(prop, primary);
  if (!isTrustworthy(identity)) {
    return {
      __identity: {
        matched: false,
        method: identity.method,
        confidence: identity.confidence,
        reason: identity.reason,
        candidates: identity.candidates,
      },
    };
  }

  // Resolve the SAME player in each other feed, carrying the provider id
  // forward so subsequent lookups are exact rather than name-based.
  const anchor = { ...prop, providerPlayerId: identity.row?.PlayerID ?? null, team: prop.team || identity.row?.Team };
  const pick = (index) => {
    if (!index) return null;
    const resolved = resolvePlayer(anchor, index);
    return isTrustworthy(resolved) ? resolved.row : null;
  };

  const projection = feeds.projections ? pick(feeds.projections) : null;
  const injury = feeds.injuries ? pick(feeds.injuries) : null;
  const actual = feeds.playerGameStats ? pick(feeds.playerGameStats) : null;
  const season = feeds.playerSeasonStats ? pick(feeds.playerSeasonStats) : null;
  const depth = feeds.depthCharts?.get?.(normalizePlayerName(prop.playerName)) || null;
  const lineup = feeds.lineups?.get?.(normalizePlayerName(prop.playerName)) || null;

  const team = str(projection?.Team ?? actual?.Team ?? season?.Team);
  const game = team ? (feeds.gamesByTeam?.get(team.toUpperCase()) || null) : null;
  const opponentTeam = feeds.teamSeasonStats?.get?.(String(prop?.opponent ?? '').toUpperCase()) || null;

  const out = {
    providerPlayerId: identity.row?.PlayerID ?? null,
    providerTeamId: toNumberOrNull(projection?.TeamID ?? actual?.TeamID),
    providerGameId: toNumberOrNull(projection?.GameID ?? actual?.GameID ?? game?.GameID),
    playerPosition: str(projection?.Position ?? actual?.Position ?? depth?.position),

    team,
    venue: str(game?.StadiumDetails?.Name ?? game?.Stadium),
    isHome: game && team ? sameTeam(game.HomeTeam, team) : null,
    gameStartTime: str(projection?.DateTime ?? game?.DateTime ?? game?.Day),
    liveStatus: game ? liveStatus(game) : (projection ? liveStatus(projection) : null),
    gamePeriod: str(game?.Quarter ?? game?.Period ?? game?.Inning),
    gameClock: str(game?.TimeRemainingMinutes !== undefined && game?.TimeRemainingSeconds !== undefined
      ? `${game.TimeRemainingMinutes}:${String(game.TimeRemainingSeconds).padStart(2, '0')}`
      : game?.TimeRemaining),
    homeScore: toNumberOrNull(game?.HomeTeamScore),
    awayScore: toNumberOrNull(game?.AwayTeamScore),

    projection: statFromRow(prop?.sport, prop?.market, projection),
    projectionSource: null,
    projectionUpdatedAt: str(projection?.Updated),

    expectedMinutes: toNumberOrNull(projection?.Minutes),
    actualMinutes: toNumberOrNull(actual?.Minutes),
    isStarter: typeof projection?.Started === 'number' ? projection.Started > 0
      : (typeof actual?.Started === 'number' ? actual.Started > 0 : null),
    depthChartOrder: depth?.depthOrder ?? null,
    lineupStatus: lineup?.lineupStatus ?? null,

    injuryStatus: injuryStatus(injury?.Status ?? projection?.InjuryStatus),
    injuryDetail: str(injury?.BodyPart ?? projection?.InjuryBodyPart),
    injuryNotes: str(injury?.Notes),
    injuryUpdatedAt: str(injury?.Updated),

    opponentRank: toNumberOrNull(projection?.OpponentRank),
    opponentPositionRank: toNumberOrNull(projection?.OpponentPositionRank),
    opponentPointsAllowed: toNumberOrNull(opponentTeam?.OpponentStat?.Points ?? opponentTeam?.PointsAgainst),

    liveStat: statFromRow(prop?.sport, prop?.market, actual),
    seasonAverage: null,
  };

  if (out.projection !== null) out.projectionSource = 'SportsDataIO';

  const seasonTotal = statFromRow(prop?.sport, prop?.market, season);
  const games = toNumberOrNull(season?.Games);
  if (seasonTotal !== null && games !== null && games > 0) {
    out.seasonAverage = Number((seasonTotal / games).toFixed(2));
  }

  const providerOpponent = str(projection?.Opponent ?? actual?.Opponent);
  if (providerOpponent) out.__opponent = providerOpponent;

  out.__identity = {
    matched: true,
    method: identity.method,
    confidence: identity.confidence,
    reason: identity.reason,
    candidates: identity.candidates,
  };
  out.__fetchedAt = fetchedAt;

  for (const [field, value] of Object.entries(out)) {
    if (value === null || value === undefined) delete out[field];
  }
  return Object.keys(out).length ? out : null;
}

/** Game-log rows -> the shape rollingAnalytics expects, for one market. */
export function gameLogValues(sport, market, rows = []) {
  if (!fieldsFor(sport, market)) return [];
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      value: statFromRow(sport, market, row),
      date: str(row?.DateTime ?? row?.Day),
      opponent: str(row?.Opponent),
      isHome: typeof row?.HomeOrAway === 'string' ? row.HomeOrAway.toUpperCase() === 'HOME' : null,
    }))
    .filter((row) => row.value !== null)
    // Provider returns oldest-first; rollingAnalytics wants newest-first.
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));
}
