import { projectedStat } from '../projections/stat-estimate.mjs';
import { finalizeResearch } from './research-service.mjs';
import { fetchClearSportsResearch } from '../data-sources/clearsports/research.mjs';
import { clearSportsConfigured, clearSportsHealth } from '../data-sources/clearsports/research.mjs';
import { clearSportsSeasonHealth, fetchClearSportsSeasonResearch } from '../data-sources/clearsports/season-research.mjs';
import { researchSections } from '../analytics/research.mjs';
import { canonicalSport } from '../data-sources/espn/stat-contract.mjs';
import { fetchPublicResearch, PUBLIC_LEAGUES } from '../data-sources/espn/research.mjs';
import { backfillH2H } from '../data-sources/espn/h2h-backfill.mjs';
import { fetchFantasyResearch } from '../data-sources/espn/fantasy-research.mjs';
import { persistResearchGameLogs } from '../ingestion/game-log-persistence.mjs';
import { lineOnlyResearch } from './research-policy.mjs';
import { fetchPropLineGameResearch } from '../data-sources/propline/game-research.mjs';
import { fetchWnbaStatsArchiveResearch } from '../data-sources/sportsdataverse/wnba-game-research.mjs';

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
  return { configured: true, clearSports: clearSportsSeasonHealth() };
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

  // Fantasy and multi-player scoring require their existing verified formulas.
  // Raw single-player stats must never bypass these settlement guards.
  const fantasy = await fetchFantasyResearch(params);
  if (fantasy) {
    if (!fantasy.available) return markPermanentLineOnly(fantasy);
    return finalizePublicHistory(fantasy, params, { fantasyScoring: fantasy.fantasyScoring });
  }

  const lineOnly = lineOnlyResearch(params);
  if (lineOnly) {
    if (params.sport === 'TENNIS' && lineOnly.code === 'HISTORICAL_SOURCE_UNVERIFIED') {
      const archive = await fetchPropLineGameResearch(params);
      if (archive) return archive.available ? finalizePublicHistory(archive, params) : archive;
    }
    return { ...lineOnly, message: String(lineOnly.message || '').replace(/Auto Scout/g, 'Oblige Props') };
  }
  if (PUBLIC_LEAGUES[String(params.sport || '').toUpperCase()]) {
    // PropLine is the preferred raw completed-game archive. ESPN is the
    // zero-credit verified fallback for gaps/outages/unsupported PropLine
    // markets. ESPN never manufactures a current line, price or sportsbook
    // quote; it only supplies completed-game research evidence.
    const archive = await fetchPropLineGameResearch(params);
    if (archive?.available) return finalizePublicHistory(archive, params);

    let history;
    try { history = await fetchPublicResearch(params); }
    catch { history = { ok: true, available: false, retryable: true, code: 'HISTORY_TEMPORARILY_UNAVAILABLE', message: 'Historical player records could not be loaded.' }; }
    if (!history.available) {
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
  return markPermanentLineOnly(clearAttempt?.available ? clearAttempt : archive || clearAttempt || logAttempt) || {
    ok: true, available: false, code: 'NO_GAME_LOG_DATA',
    message: 'Historical player data is unavailable for this selection.',
  };
}

const results = new Map();
const inflight = new Map();
export async function researchPlayerProp(params = {}) {
  const key = JSON.stringify(['sport','playerName','providerPlayerId','team','homeTeam','awayTeam','opponent','market','providerMarketKey','line','side','games','eventId','gameStartTime','period'].map(k => params[k] ?? null));
  const cached = results.get(key);
  if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const pending = researchUncached(params).then(value => {
    const output = { ...value, projectedStat: projectedStat(value), sections: researchSections(value) };
    results.set(key, { value: output, expires: Date.now() + (value?.retryable ? 0.5 : value?.available ? 15 : 5) * 60_000 });
    while (results.size > 500) results.delete(results.keys().next().value);
    return output;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}
