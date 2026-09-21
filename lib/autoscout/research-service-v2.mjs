import { projectedStat } from '../projections/stat-estimate.mjs';
import { finalizeResearch, researchPlayerProp as fetchSportsDataIoResearch, researchHealth as sportsDataIoResearchHealth } from './research-service.mjs';
import { fetchClearSportsResearch } from '../data-sources/clearsports/research.mjs';
import { clearSportsConfigured, clearSportsHealth } from '../data-sources/clearsports/research.mjs';
import { clearSportsSeasonHealth, fetchClearSportsSeasonResearch } from '../data-sources/clearsports/season-research.mjs';
import { researchSections } from '../analytics/research.mjs';
import { canonicalSport } from '../data-sources/espn/stat-contract.mjs';
import { fetchPublicResearch, fetchPublicTeamDirectory, PUBLIC_LEAGUES } from '../data-sources/espn/research.mjs';
import { backfillH2H } from '../data-sources/espn/h2h-backfill.mjs';
import { fetchFantasyResearch } from '../data-sources/espn/fantasy-research.mjs';
import { fetchSettledFantasyResearch } from '../data-sources/propline/fantasy-research.mjs';
import { persistResearchGameLogs } from '../ingestion/game-log-persistence.mjs';
import { lineOnlyResearch } from './research-policy.mjs';
import { fetchPropLineGameResearch } from '../data-sources/propline/game-research.mjs';
import { fetchWnbaStatsArchiveResearch } from '../data-sources/sportsdataverse/wnba-game-research.mjs';
import { fetchNflverseResearch } from '../data-sources/nflverse/nfl-game-research.mjs';
import { fetchSportsDataverseCfbResearch } from '../data-sources/sportsdataverse/cfb-game-research.mjs';
import { fetchSportsGameOddsResearch } from '../data-sources/sportsgameodds/research.mjs';
import { fetchSportradarResearchContext, fetchSportradarTeamDirectory, sportradarResearchHealth } from '../data-sources/sportradar/research-context.mjs';

const permanentLineOnlyCodes = new Set(['UNSUPPORTED_MARKET','STAT_NOT_AVAILABLE','FANTASY_COMPONENTS_INCOMPLETE']);
const markPermanentLineOnly = value => value && permanentLineOnlyCodes.has(value.code)
  ? { ...value, lineOnly: true, retryable: false }
  : value;

// Historical persistence is cache warming, not customer-facing research work.
// Serialize and dedupe it so a slow database write/fallback cannot hold trend
// cards open or create a write storm while the board hydrates visible props.
const persistenceQueued = new Set();
let persistenceTail = Promise.resolve();
function queueResearchPersistence(history, params = {}) {
  const key = JSON.stringify([
    canonicalSport(params.sport),
    history?.player?.providerPlayerId || params.providerPlayerId || params.playerName || null,
    history?.season || null,
    params.providerMarketKey || params.market || null,
  ]);
  if (persistenceQueued.has(key) || persistenceQueued.size >= 40) return;
  persistenceQueued.add(key);
  persistenceTail = persistenceTail
    .catch(() => {})
    .then(() => persistResearchGameLogs(history, params))
    .catch(() => {})
    .finally(() => persistenceQueued.delete(key));
}

export function researchHealth() {
  return { configured: true, clearSports: clearSportsSeasonHealth(), sportradar: sportradarResearchHealth(), sportsDataIo: sportsDataIoResearchHealth() };
}

export async function researchLiveHealth() {
  return { configured: true, clearSports: await clearSportsHealth({ live: true }) };
}

function finalizePublicHistory(history, params, extra = {}) {
  return {
    ...finalizeResearch({
      ...params,
      opponent: history.opponent,
      opponentId: history.opponentId,
      isHome: history.isHome,
      gameLog: history.gameLog,
      player: history.player,
      source: history.source,
      cached: history.cached,
      season: history.season,
      coverage: history.coverage,
    }),
    entityType: history.entityType,
    statKind: history.statKind,
    marketDisplayName: history.marketDisplayName,
    ...extra,
  };
}

async function researchUncached(params = {}) {
  params = {...params,sport:canonicalSport(params.sport)};
  const period = String(params.period || '').trim().toLowerCase();
  if (period && !['full', 'full_game', 'game', 'match', 'single_stat'].includes(period)) {
    if (params.allowPaidPeriod === true) {
      const sportsGameOdds = await fetchSportsGameOddsResearch(params).catch(() => null);
      if (sportsGameOdds?.available) {
        return finalizePublicHistory(sportsGameOdds, params, {
          fallback: { used: true, primary: 'Exact period history', source: sportsGameOdds.source },
        });
      }
      if (sportsGameOdds?.retryable) return sportsGameOdds;
    }
    return {
      ok: true,
      available: false,
      code: 'PERIOD_HISTORY_UNAVAILABLE',
      message: 'Verified history for this exact game period is not available yet. Full-game totals are never substituted for a period prop.',
      gameLog: [],
      lineOnly: true,
      retryable: false,
    };
  }

  // Prefer complete verified formula history. Other sports/platforms may use
  // actual settled fantasy values only when every game in the raw recent-game
  // sample is matched. Neither path substitutes an ordinary stat or a formula
  // from a different platform.
  const fantasy = await fetchFantasyResearch(params);
  if (fantasy?.available) {
    return finalizePublicHistory(fantasy, params, { fantasyScoring: fantasy.fantasyScoring });
  }
  const settledFantasy = await fetchSettledFantasyResearch(params);
  if (settledFantasy?.available) return finalizePublicHistory(settledFantasy, params, { fantasyScoring: settledFantasy.fantasyScoring });
  // Keep existing verified-formula failures (including retryable transport
  // errors) intact when a second source cannot supply a complete sample.
  if (fantasy) return markPermanentLineOnly(fantasy);
  if (settledFantasy) return settledFantasy;

  const lineOnly = lineOnlyResearch(params);
  if (lineOnly) {
    if (params.sport === 'TENNIS' && lineOnly.code === 'HISTORICAL_SOURCE_UNVERIFIED') {
      const archive = await fetchPropLineGameResearch(params);
      if (archive?.available) return finalizePublicHistory(archive, params);
    }
    // Exact SportsGameOdds player/stat identity is learned from the live
    // supplemental board. If it has a finalized result for this exact market,
    // it can safely turn a formerly line-only prop into verified game history.
    const sportsGameOdds = await fetchSportsGameOddsResearch(params).catch(() => null);
    if (sportsGameOdds?.available) {
      return finalizePublicHistory(sportsGameOdds, params, {
        fallback: { used: true, primary: 'PropLine/public historical sources', source: sportsGameOdds.source },
      });
    }
    return { ...lineOnly, message: String(lineOnly.message || '').replace(/Auto Scout/g, 'Oblige Props') };
  }
  if (PUBLIC_LEAGUES[String(params.sport || '').toUpperCase()]) {
    // PropLine is the preferred raw completed-game archive. ESPN is the
    // zero-credit verified fallback for gaps/outages/unsupported PropLine
    // markets. ESPN never manufactures a current line, price or sportsbook
    // quote; it only supplies completed-game research evidence.
    const deepHistory = Number(params.historyYears) > 1;
    const archive = await fetchPropLineGameResearch(params);
    if (archive?.available && !deepHistory) return finalizePublicHistory(archive, params);

    let history;
    try { history = await fetchPublicResearch(params); }
    catch { history = { ok: true, available: false, retryable: true, code: 'HISTORY_TEMPORARILY_UNAVAILABLE', message: 'Historical player records could not be loaded.' }; }
    if (!history.available) {
      // A deep-history request still prefers PropLine when the public archive
      // cannot verify the same market. This keeps the normal provider hierarchy
      // while allowing ESPN to extend supported player stats across seasons.
      if (archive?.available) return finalizePublicHistory(archive, params);
      // ClearSports and the SportsDataIO trial are research-only backups. They
      // can answer an exact mapped historical stat, but neither can supply or
      // overwrite the current prop quote.
      if (clearSportsConfigured()) {
        try {
          const clearHistory = await fetchClearSportsResearch({
            sport: params.sport,
            playerName: params.playerName,
            team: params.team || null,
            market: params.market,
            providerMarketKey: params.providerMarketKey || null,
            games: params.games || 20,
          });
          if (clearHistory?.available && Array.isArray(clearHistory.gameLog) && clearHistory.gameLog.length) {
            return finalizeResearch({
              ...params,
              gameLog: clearHistory.gameLog,
              player: clearHistory.player || null,
              context: clearHistory.context || null,
              source: clearHistory.source || 'ClearSports historical stats',
              opponent: params.opponent,
              team: params.team,
              homeTeam: params.homeTeam,
              awayTeam: params.awayTeam,
              cached: clearHistory.cached,
            });
          }
        } catch {}
      }

      // SportsDataIO trial fallback for exact mapped game logs only. The legacy
      // prop-board path remains removed and globally disabled.
      try {
        const sportsDataIo = await fetchSportsDataIoResearch(params);
        if (sportsDataIo?.available) {
          return {
            ...sportsDataIo,
            fallback: { used: true, primary: 'Sportradar/ESPN/ClearSports', source: sportsDataIo.source || 'SportsDataIO' },
          };
        }
      } catch {}

      // WNBA has a second independent public archive generated from the official
      // WNBA Stats league game-log endpoint. Use it only for exact completed-game
      // box-score fields; it never supplies current lines or prices.
      if (params.sport === 'WNBA') {
        let wnbaArchive = null;
        try { wnbaArchive = await fetchWnbaStatsArchiveResearch(params); }
        catch { wnbaArchive = null; }
        if (wnbaArchive?.available) {
          return finalizePublicHistory(wnbaArchive, params, {
            fallback: { used: true, primary: 'PropLine raw game archive', source: wnbaArchive.source },
          });
        }
      }
      // NFL gets an independent weekly player-stat archive from nflverse after
      // the live PropLine archive and ESPN exact-market path both fail.
      if (params.sport === 'NFL') {
        let nflArchive = null;
        try { nflArchive = await fetchNflverseResearch(params); }
        catch { nflArchive = null; }
        if (nflArchive?.available) {
          return finalizePublicHistory(nflArchive, params, {
            fallback: { used: true, primary: 'PropLine raw game archive', source: nflArchive.source },
          });
        }
      }
      if (params.sport === 'NCAAF') {
        let cfbArchive = null;
        try { cfbArchive = await fetchSportsDataverseCfbResearch(params); }
        catch { cfbArchive = null; }
        if (cfbArchive?.available) {
          return finalizePublicHistory(cfbArchive, params, {
            fallback: { used: true, primary: 'PropLine raw game archive', source: cfbArchive.source },
          });
        }
      }
      // Paid SGO is intentionally last after the verified zero-cost archives.
      // That preserves the Rookie monthly object allowance while filling the
      // exact player/market gaps those sources cannot answer.
      const sportsGameOdds = await fetchSportsGameOddsResearch(params).catch(() => null);
      if (sportsGameOdds?.available) {
        return finalizePublicHistory(sportsGameOdds, params, {
          fallback: { used: true, primary: 'PropLine/public historical sources', source: sportsGameOdds.source },
        });
      }
      // Prefer the most useful verified failure. A permanent ESPN market/stat
      // mismatch is stronger than a transient PropLine outage; otherwise retain
      // PropLine's exact-market failure when it exists.
      const espn = markPermanentLineOnly(history);
      if (espn?.lineOnly || !archive) return espn;
      return archive;
    }
    // Keep the existing completed-game source and H2H extension when ESPN is
    // the fallback, then persist those verified logs for future cache coverage.
    history = await backfillH2H(history, params);
    queueResearchPersistence(history, params);
    return finalizePublicHistory(history, params, {
      fallback: { used: true, primary: 'PropLine raw game archive', source: history.source || 'ESPN public game logs' },
    });
  }

  // Additional mapped sports get raw completed-game evidence, not a fake
  // projection or a historical win rate against unrelated bookmaker lines.
  const archive = await fetchPropLineGameResearch(params);
  if (archive?.available) return finalizePublicHistory(archive, params);
  let clearAttempt = null, logAttempt = null;
  if (clearSportsConfigured()) {
    try {
      logAttempt = await fetchClearSportsResearch({
        sport: params.sport,
        playerName: params.playerName,
        team: params.team || null,
        market: params.market,
        providerMarketKey: params.providerMarketKey || null,
        games: params.games || 20,
      });
      if (logAttempt?.available && Array.isArray(logAttempt.gameLog) && logAttempt.gameLog.length) {
        const finalized = finalizeResearch({
          gameLog: logAttempt.gameLog,
          line: params.line,
          side: params.side,
          market: params.market,
          sport: params.sport,
          player: logAttempt.player || null,
          context: logAttempt.context || null,
          source: logAttempt.source || 'Historical stats',
          homeTeam: params.homeTeam,
          awayTeam: params.awayTeam,
          opponent: params.opponent,
          team: params.team,
          cached: logAttempt.cached,
        });
        if (finalized.available) return finalized;
      }
    } catch (error) {
      console.error('[research] ClearSports game log failed', String(error?.code || 'RESEARCH_UNAVAILABLE').slice(0, 80));
    }
  }
  if (clearSportsConfigured()) {
    clearAttempt = await fetchClearSportsSeasonResearch({
      sport: params.sport,
      playerName: params.playerName,
      market: params.market,
      providerMarketKey: params.providerMarketKey || null,
    });
  }
  if (logAttempt?.context) {
    clearAttempt = { ...(clearAttempt || logAttempt), context: { ...(clearAttempt?.context || {}), ...Object.fromEntries(Object.entries(logAttempt.context).filter(([,v]) => v != null && v !== '')) } };
  }
  if (!clearAttempt?.available && !logAttempt?.available) {
    const sportsGameOdds = await fetchSportsGameOddsResearch(params).catch(() => null);
    if (sportsGameOdds?.available) {
      return finalizePublicHistory(sportsGameOdds, params, {
        fallback: { used: true, primary: 'PropLine/ClearSports historical sources', source: sportsGameOdds.source },
      });
    }
  }
  return markPermanentLineOnly(clearAttempt?.available ? clearAttempt : archive || clearAttempt || logAttempt) || {
    ok: true, available: false, code: 'NO_GAME_LOG_DATA',
    message: 'Historical player data is unavailable for this selection.',
  };
}

const results = new Map();
const inflight = new Map();
export async function researchPlayerProp(params = {}) {
  const key = JSON.stringify(['sport','playerName','providerPlayerId','team','homeTeam','awayTeam','opponent','market','providerMarketKey','line','side','games','historyYears','eventId','gameStartTime','period','allowPaidPeriod'].map(k => params[k] ?? null));
  const cached = results.get(key);
  if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const sport = canonicalSport(params.sport);
  // Resolve the public league directory in parallel with the selected prop's
  // history. The directory is a cached read-only ESPN metadata call, so this
  // does not widen PropLine/paid polling and it does not block on a second
  // sequential network request after history completes.
  const directory = PUBLIC_LEAGUES[sport]?.[1]
    ? Promise.all([
        fetchSportradarTeamDirectory(sport).catch(() => []),
        fetchPublicTeamDirectory(sport).catch(() => []),
      ]).then(([radar, espn]) => {
        const rows = [...radar, ...espn], seen = new Set();
        return rows.filter((row) => {
          const key = String(row?.id || '') + '|' + String(row?.abbreviation || '').toUpperCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })
    : Promise.resolve([]);
  const radarContext = fetchSportradarResearchContext(params).catch(() => null);
  const pending = Promise.all([researchUncached(params), directory, radarContext]).then(([value, leagueTeams, verifiedContext]) => {
    let enriched = Array.isArray(leagueTeams) && leagueTeams.length ? { ...value, leagueTeams } : value;
    if (verifiedContext) {
      enriched = {
        ...enriched,
        context: {
          ...(enriched?.context || {}),
          sportradar: verifiedContext,
        },
      };
    }
    const output = { ...enriched, projectedStat: projectedStat(enriched), sections: researchSections(enriched) };
    results.set(key, { value: output, expires: Date.now() + (value?.retryable ? 0.5 : value?.available ? 15 : 5) * 60_000 });
    while (results.size > 500) results.delete(results.keys().next().value);
    return output;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}
