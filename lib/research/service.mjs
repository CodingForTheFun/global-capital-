// Player prop research.
//
// Answers one question: how has THIS player actually performed against THIS
// line? It joins the odds board (which knows the player's name and the line)
// to SportsDataIO game logs (which know what the player did), using the same
// conservative identity matcher the enrichment pipeline uses.
//
// Every failure mode is named. A blank research panel is a bug; "we could not
// match this player to the stats provider" is an answer.

import { bootstrapProviders } from '../data-sources/bootstrap.mjs';
import { getProvider } from '../data-sources/registry.mjs';
import { enrichmentKey, normalizePlayerName } from '../data-sources/contract.mjs';
import { toNumberOrNull } from '../props/model.mjs';
import { rollingAnalytics, WINDOWS } from '../analytics/rolling.mjs';
import { canonicalMarket } from './market-keys.mjs';

export const RESEARCH_CODE = Object.freeze({
  OK: 'OK',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  SPORT_UNSUPPORTED: 'SPORT_UNSUPPORTED',
  MARKET_UNSUPPORTED: 'MARKET_UNSUPPORTED',
  PLAYER_UNMATCHED: 'PLAYER_UNMATCHED',
  NO_GAME_LOG: 'NO_GAME_LOG',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
});

// Copy the UI shows verbatim, so a user can tell a provider problem from a
// UI problem without opening a console.
const MESSAGE = Object.freeze({
  [RESEARCH_CODE.PROVIDER_NOT_CONFIGURED]: 'Historical statistics are not connected. Add SPORTSDATAIO_API_KEY to enable research.',
  [RESEARCH_CODE.SPORT_UNSUPPORTED]: 'Historical statistics are not available for this league.',
  [RESEARCH_CODE.MARKET_UNSUPPORTED]: 'This market has no historical stat mapping, so hit rates are unavailable.',
  [RESEARCH_CODE.PLAYER_UNMATCHED]: 'Player could not be matched to the statistics provider.',
  [RESEARCH_CODE.NO_GAME_LOG]: 'No historical game data available for this player.',
  [RESEARCH_CODE.PROVIDER_ERROR]: 'The statistics provider did not respond. Try again shortly.',
});

function unavailable(code, extra = {}) {
  return {
    available: false,
    code,
    reason: MESSAGE[code] || 'Research is unavailable.',
    windows: {},
    gameLog: [],
    ...extra,
  };
}

/** Hit rate over a set of games, excluding pushes from the denominator. */
export function hitRateFor(games, line, side = 'OVER') {
  const lineValue = toNumberOrNull(line);
  if (lineValue === null) return { hitRate: null, hits: 0, decided: 0, pushes: 0, average: null };
  const direction = String(side).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';

  let hits = 0;
  let decided = 0;
  let pushes = 0;
  let total = 0;
  let count = 0;

  for (const game of games) {
    const value = toNumberOrNull(game?.value);
    if (value === null) continue;
    total += value;
    count += 1;
    if (value === lineValue) { pushes += 1; continue; }
    decided += 1;
    const beat = direction === 'UNDER' ? value < lineValue : value > lineValue;
    if (beat) hits += 1;
  }

  return {
    hitRate: decided ? Math.round((hits / decided) * 100) : null,
    hits,
    decided,
    pushes,
    average: count ? Number((total / count).toFixed(2)) : null,
    games: count,
  };
}

/** Head-to-head split against one opponent, from the same game log. */
export function headToHead(gameLog = [], opponent, line, side) {
  const target = normalizePlayerName(opponent);
  if (!target) return null;
  const games = gameLog.filter((game) => normalizePlayerName(game?.opponent) === target);
  if (!games.length) return null;
  return { label: 'H2H', ...hitRateFor(games, line, side) };
}

/**
 * Recompute every window from an already-fetched game log.
 *
 * The line stepper calls this in the client, so adjusting the line is instant
 * and costs no upstream request. Exported so the server and browser cannot
 * disagree about what a hit rate means.
 */
export function windowsFor(gameLog = [], line, side = 'OVER', { opponent = null } = {}) {
  const out = {};
  for (const window of WINDOWS) {
    const slice = window.games ? gameLog.slice(0, window.games) : gameLog;
    out[window.id] = { label: window.label, ...hitRateFor(slice, line, side) };
  }
  const h2h = headToHead(gameLog, opponent, line, side);
  if (h2h) out.h2h = h2h;
  return out;
}

/**
 * Research one prop.
 *
 * Returns the full game log so the client can restate hit rates for any line
 * the user steps to, plus server-computed windows for the line as requested.
 */
export async function researchProp({
  sport, playerName, team = null, opponent = null,
  market, marketId = null, statId = null,
  line, side = 'OVER', games = 20, log = console,
} = {}) {
  bootstrapProviders({ log });
  const adapter = getProvider('sportsdataio');

  if (!adapter || typeof adapter.playerGameLog !== 'function' || adapter.isConfigured?.() !== true) {
    return unavailable(RESEARCH_CODE.PROVIDER_NOT_CONFIGURED);
  }

  const league = String(sport || '').toUpperCase();
  const canonical = canonicalMarket({ marketId, statId, market });
  if (!canonical) return unavailable(RESEARCH_CODE.MARKET_UNSUPPORTED);

  const probe = {
    id: 'research', sport: league, playerName, team, opponent,
    market: canonical, line, side,
  };

  // Resolve the odds-board player onto a SportsDataIO PlayerID. The board's
  // own playerId is a hash of the name and is useless as a join key.
  let identity = { matched: false, reason: MESSAGE[RESEARCH_CODE.PLAYER_UNMATCHED] };
  let providerPlayerId = null;
  try {
    const enrichment = await adapter.fetchEnrichment({ props: [probe] });
    const row = enrichment?.get?.(enrichmentKey(probe)) || null;
    providerPlayerId = row?.providerPlayerId ?? null;
    if (row?.__identity) {
      identity = {
        matched: Boolean(providerPlayerId),
        method: row.__identity.method,
        confidence: row.__identity.confidence,
        reason: row.__identity.reason,
        candidates: row.__identity.candidates,
      };
    } else if (providerPlayerId) {
      identity = { matched: true, method: 'resolved', confidence: 1, reason: 'matched to the statistics provider' };
    }
  } catch (error) {
    log?.error?.('[research] identity resolution failed', String(error?.message || error).slice(0, 200));
    return unavailable(RESEARCH_CODE.PROVIDER_ERROR, { identity });
  }

  if (!providerPlayerId) {
    return unavailable(RESEARCH_CODE.PLAYER_UNMATCHED, { identity, market: canonical });
  }

  let analytics = null;
  try {
    analytics = await adapter.playerGameLog({
      sport: league, playerId: providerPlayerId, market: canonical, line, side, games,
    });
  } catch (error) {
    log?.error?.('[research] game log failed', String(error?.message || error).slice(0, 200));
    return unavailable(RESEARCH_CODE.PROVIDER_ERROR, { identity, market: canonical });
  }

  const gameLog = Array.isArray(analytics?.gameLog) ? analytics.gameLog : [];
  if (!gameLog.length) {
    return unavailable(RESEARCH_CODE.NO_GAME_LOG, { identity, market: canonical, providerPlayerId });
  }

  return {
    available: true,
    code: RESEARCH_CODE.OK,
    reason: null,
    identity,
    providerPlayerId,
    player: { name: playerName, team, opponent },
    market: canonical,
    marketLabel: market || canonical,
    line: toNumberOrNull(line),
    side: String(side).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER',
    windows: windowsFor(gameLog, line, side, { opponent }),
    trend: analytics.trend || null,
    splits: analytics.splits || null,
    gameLog,
    source: analytics.source || 'SportsDataIO',
    fetchedAt: analytics.fetchedAt || new Date().toISOString(),
    cached: analytics.cached === true,
  };
}
