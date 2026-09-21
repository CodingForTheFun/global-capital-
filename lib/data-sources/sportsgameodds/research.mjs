import { numberOrNull } from '../../autoscout/models.mjs';
import { normalizePlayerName } from '../contract.mjs';
import {
  fetchSportsGameOddsUsage,
  sportsGameOddsGet,
  sportsGameOddsMonthlyUsage,
  sportsGameOddsPaidFallbackEnabled,
} from './client.mjs';
import { sportsGameOddsStatIdsForMarket } from './normalize.mjs';
import { sportsGameOddsIdentityFor } from '../../ingestion/sportsgameodds-supplement.mjs';

const text = (value) => String(value ?? '').trim();
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value) => Array.isArray(value) ? value : [];
const iso = (value) => {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const statNumber = (value) => numberOrNull(value) ?? numberOrNull(value?.value ?? value?.score ?? value?.total);

function team(event, side) {
  const row = object(event?.teams?.[side]);
  return {
    id: text(row.teamID || row.id),
    name: text(row.name || row.names?.display || row.names?.long || row.names?.short),
  };
}

function eventPlayer(event, playerId) {
  const row = object(event?.players?.[playerId]);
  const names = object(row.names);
  return {
    teamId: text(row.teamID || row.team?.teamID || row.teamId),
    name: text(row.name || row.displayName || names.display || [names.firstName, names.lastName].filter(Boolean).join(' ')),
  };
}

function scoreFromOdds(event, playerId, statId) {
  for (const odd of Object.values(object(event?.odds))) {
    if (text(odd?.statEntityID) !== playerId) continue;
    if (text(odd?.statID) !== statId) continue;
    if (text(odd?.periodID || 'game').toLowerCase() !== 'game') continue;
    if (text(odd?.betTypeID).toLowerCase() !== 'ou') continue;
    const score = statNumber(odd?.score);
    if (score !== null) return score;
  }
  return null;
}

function scoreFromResults(event, playerId, statIds) {
  const game = object(event?.results?.game);
  const player = object(game[playerId]);
  if (!Object.keys(player).length) return null;
  let total = 0;
  for (const statId of statIds) {
    const value = statNumber(player[statId]);
    if (value === null) return null;
    total += value;
  }
  return Number(total.toFixed(2));
}

function opponentFor(event, playerId) {
  const home = team(event, 'home');
  const away = team(event, 'away');
  const player = eventPlayer(event, playerId);
  if (player.teamId && player.teamId === home.id) return { team: home.name, opponent: away.name, isHome: true };
  if (player.teamId && player.teamId === away.id) return { team: away.name, opponent: home.name, isHome: false };
  return { team: null, opponent: null, isHome: null };
}

function monthlyReserveReached(usage) {
  const monthly = sportsGameOddsMonthlyUsage(usage);
  if (monthly.remaining === null || monthly.max === null) return false;
  const reserve = Math.max(5_000, Math.ceil(monthly.max * 0.10));
  return monthly.remaining <= reserve;
}

export async function fetchSportsGameOddsResearch(params = {}) {
  if (!sportsGameOddsPaidFallbackEnabled()) return null;
  const identity = sportsGameOddsIdentityFor({
    sport: params.sport,
    playerName: params.playerName,
    team: params.team,
    gameStartTime: params.gameStartTime,
  });
  if (!identity?.playerId) return null;

  const usage = await fetchSportsGameOddsUsage().catch(() => null);
  if (monthlyReserveReached(usage)) {
    return {
      ok: true,
      available: false,
      retryable: true,
      code: 'SPORTSGAMEODDS_QUOTA_RESERVED',
      message: 'Paid historical fallback is preserving its monthly data allowance.',
    };
  }

  const games = Math.min(40, Math.max(5, Number(params.games) || 20));
  const currentStat = text(identity.statId);
  const components = sportsGameOddsStatIdsForMarket(params.providerMarketKey, params.market, params.sport);
  const statIds = currentStat ? [currentStat] : components;
  if (!statIds.length) return null;

  const now = Date.now();
  const query = {
    playerID: identity.playerId,
    leagueID: identity.leagueId || undefined,
    finalized: 'true',
    cancelled: 'false',
    startsAfter: new Date(now - 400 * 24 * 60 * 60_000).toISOString(),
    startsBefore: new Date(now - 60_000).toISOString(),
    expandResults: 'true',
    includeOpenCloseOdds: 'false',
    // Filtering the odds object to the exact current prop keeps historical
    // payloads compact. expandResults remains enabled so a completed stat can
    // still be recovered when an older event did not carry that market.
    oddID: currentStat ? currentStat + '-' + identity.playerId + '-game-ou-over' : undefined,
    includeOpposingOdds: currentStat ? 'true' : undefined,
    limit: Math.min(40, Math.max(games, 20)),
  };

  let payload;
  try {
    payload = await sportsGameOddsGet('/events', query, {
      ttlSeconds: 60 * 60,
      timeoutMs: 15_000,
    });
  } catch (error) {
    const code = text(error?.code || error?.name);
    if (['SPORTSGAMEODDS_FORBIDDEN','SPORTSGAMEODDS_UNAUTHORIZED'].includes(code)) {
      return {
        ok: true,
        available: false,
        retryable: false,
        code: 'SPORTSGAMEODDS_HISTORY_NOT_AVAILABLE',
        message: 'SportsGameOdds historical results are not available for this key.',
      };
    }
    return {
      ok: true,
      available: false,
      retryable: true,
      code: code || 'SPORTSGAMEODDS_HISTORY_UNAVAILABLE',
      message: 'SportsGameOdds historical results are temporarily unavailable.',
    };
  }

  const rows = [];
  for (const event of list(payload?.data)) {
    if (event?.status?.finalized !== true && event?.status?.ended !== true) continue;
    const date = iso(event?.status?.startsAt || event?.startTime);
    if (!date) continue;

    let value = currentStat ? scoreFromOdds(event, identity.playerId, currentStat) : null;
    if (value === null) {
      const direct = currentStat ? scoreFromResults(event, identity.playerId, [currentStat]) : null;
      value = direct !== null ? direct : scoreFromResults(event, identity.playerId, components);
    }
    if (value === null) continue;

    const matchup = opponentFor(event, identity.playerId);
    rows.push({
      gameId: text(event?.eventID || event?.id) || null,
      date,
      opponent: matchup.opponent,
      team: matchup.team || identity.team || null,
      isHome: matchup.isHome,
      started: null,
      minutes: null,
      value,
    });
  }

  rows.sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));
  const gameLog = rows.slice(0, games);
  if (!gameLog.length) {
    return {
      ok: true,
      available: false,
      retryable: false,
      code: 'SPORTSGAMEODDS_NO_MATCHING_RESULTS',
      message: 'SportsGameOdds returned no finalized results for this exact player market.',
      source: 'SportsGameOdds results',
    };
  }

  const latest = gameLog[0];
  return {
    ok: true,
    available: true,
    retryable: false,
    source: 'SportsGameOdds results',
    fetchedAt: new Date().toISOString(),
    cached: false,
    player: {
      playerName: identity.playerName || params.playerName,
      providerPlayerId: identity.playerId,
      team: latest.team || identity.team || params.team || null,
    },
    opponent: params.opponent || null,
    opponentId: null,
    isHome: null,
    season: null,
    entityType: 'player',
    statKind: currentStat || statIds.join('+'),
    marketDisplayName: params.market || params.providerMarketKey || currentStat,
    gameLog,
    coverage: {
      completedGames: gameLog.length,
      requestedGames: games,
      exactPlayerId: identity.playerId,
      exactStatId: currentStat || null,
      source: 'SportsGameOdds finalized event results',
    },
  };
}

export function sportsGameOddsResearchKey(params = {}) {
  return [
    text(params.sport).toUpperCase(),
    normalizePlayerName(params.playerName),
    text(params.providerMarketKey || params.market).toLowerCase(),
  ].join('|');
}
