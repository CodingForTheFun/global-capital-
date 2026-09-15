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

  // Fantasy scoring is source-specific. Only combinations whose exact source
  // formula is verified return a non-null value here; every other fantasy line
  // falls through to the existing fail-closed line-only policy below.
  const fantasy = await fetchFantasyResearch(params);
  if (fantasy) {
    if (!fantasy.available) return markPermanentLineOnly(fantasy);
    return finalizePublicHistory(fantasy, params, { fantasyScoring: fantasy.fantasyScoring });
  }

  const lineOnly = lineOnlyResearch(params);
  if (lineOnly) return lineOnly;
  if (PUBLIC_LEAGUES[String(params.sport || '').toUpperCase()]) {
    let history = await fetchPublicResearch(params);
    if (!history.available) return markPermanentLineOnly(history);
    // L5/L10 normally need only the recent seasons, but H2H can require going
    // farther back (especially NFL cross-division/opposite-conference games).
    // Extend only with independently verified prior-season logs when the
    // current opponent has no sample in the ordinary history window.
    history = await backfillH2H(history, params);
    // Persist only already-verified ESPN rows. Persistence is deliberately
    // deferred: database latency must never delay the trend/hit-rate response.
    queueResearchPersistence(history, params);
    return finalizePublicHistory(history, params);
  }
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
  return markPermanentLineOnly(clearAttempt || logAttempt) || {
    ok: true, available: false, code: 'NO_GAME_LOG_DATA',
    message: 'Historical player data is unavailable for this selection.',
  };
}

const results = new Map();
const inflight = new Map();
export async function researchPlayerProp(params = {}) {
  const key = JSON.stringify(['sport','playerName','providerPlayerId','team','homeTeam','awayTeam','opponent','market','providerMarketKey','line','side','games'].map(k => params[k] ?? null));
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
