// Provider payloads -> Scout Pro shapes.
//
// Nothing downstream of this file sees a SportsDataIO field name. Every value
// that the provider did not supply stays null: absent is never rendered as 0,
// "unknown" or "neutral".

import { toNumberOrNull } from '../../props/model.mjs';
import { normalizePlayerName } from '../contract.mjs';
import { statFromRow } from './markets.mjs';
import { bettingEnrichmentForProp } from './betting.mjs';

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
export function buildEnrichment(prop, feeds = {}) {
  const key = normalizePlayerName(prop?.playerName);
  if (!key) return null;

  const projection = feeds.projections?.get(key) || null;
  const injury = feeds.injuries?.get(key) || null;
  const actual = feeds.playerGameStats?.get(key) || null;
  const season = feeds.playerSeasonStats?.get(key) || null;
  const depth = feeds.depthCharts?.get(key) || null;
  const lineup = feeds.lineups?.get(key) || null;
  const team = str(projection?.Team ?? actual?.Team ?? season?.Team);
  const game = team ? (feeds.gamesByTeam?.get(team.toUpperCase()) || null) : null;
  const opponentTeam = feeds.teamSeasonStats?.get(String(prop?.opponent ?? '').toUpperCase()) || null;
  const providerPlayerId = toNumberOrNull(projection?.PlayerID ?? actual?.PlayerID ?? season?.PlayerID ?? injury?.PlayerID);
  const betting = bettingEnrichmentForProp(prop, feeds.bettingMarkets, providerPlayerId) || {};

  const out = {
    // Identity / context
    team,
    gameStartTime: str(projection?.DateTime ?? game?.DateTime ?? game?.Day),
    liveStatus: game ? liveStatus(game) : (projection ? liveStatus(projection) : null),

    // Projection for the exact market this prop is on.
    projection: statFromRow(prop?.sport, prop?.market, projection),
    projectionSource: null,

    // Opportunity / role
    expectedMinutes: toNumberOrNull(projection?.Minutes),
    actualMinutes: toNumberOrNull(actual?.Minutes),
    isStarter: typeof projection?.Started === 'number' ? projection.Started > 0
      : (typeof actual?.Started === 'number' ? actual.Started > 0 : null),
    depthChartOrder: depth?.depthOrder ?? null,
    lineupStatus: lineup?.lineupStatus ?? null,

    // Availability
    injuryStatus: injuryStatus(injury?.Status ?? projection?.InjuryStatus),
    injuryDetail: str(injury?.BodyPart ?? projection?.InjuryBodyPart),

    // Matchup
    opponentRank: toNumberOrNull(projection?.OpponentRank),
    opponentPositionRank: toNumberOrNull(projection?.OpponentPositionRank),
    opponentPointsAllowed: toNumberOrNull(opponentTeam?.OpponentStat?.Points ?? opponentTeam?.PointsAgainst),

    // Live in-play value for this prop's own market.
    liveStat: statFromRow(prop?.sport, prop?.market, actual),

    // Season baseline for this market, per game played.
    seasonAverage: null,

    // Current sportsbook context for the same player + market. The PickFinder
    // line remains protected by contract.mjs and is never replaced here.
    ...betting,
  };

  if (out.projection !== null) out.projectionSource = 'SportsDataIO';

  const seasonTotal = statFromRow(prop?.sport, prop?.market, season);
  const games = toNumberOrNull(season?.Games);
  if (seasonTotal !== null && games !== null && games > 0) {
    // Season feeds report totals; a per-game average is the comparable figure.
    out.seasonAverage = Number((seasonTotal / games).toFixed(2));
  }

  // The opponent this provider believes the player faces, used by enrich.mjs to
  // reject a same-name player in a different game.
  const providerOpponent = str(projection?.Opponent ?? actual?.Opponent);
  if (providerOpponent) out.__opponent = providerOpponent;

  // Drop keys with no value so the contract's sanitiser sees only real data.
  for (const [field, value] of Object.entries(out)) {
    if (value === null || value === undefined) delete out[field];
  }
  return Object.keys(out).length ? out : null;
}
