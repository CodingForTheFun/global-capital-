import { finalizeResearch, researchPlayerProp as fetchLegacyResearch } from './research-service.mjs';
import { fetchClearSportsResearch } from '../data-sources/clearsports/research.mjs';
import { clearSportsConfigured, clearSportsHealth } from '../data-sources/clearsports/research.mjs';
import { clearSportsSeasonHealth, fetchClearSportsSeasonResearch } from '../data-sources/clearsports/season-research.mjs';
import { researchSections } from '../analytics/research.mjs';
import { fetchPublicResearch, PUBLIC_LEAGUES } from '../data-sources/espn/research.mjs';

export function researchHealth() {
  return { configured: true, clearSports: clearSportsSeasonHealth() };
}

export async function researchLiveHealth() {
  return { configured: true, clearSports: await clearSportsHealth({ live: true }) };
}

function hasUsableLog(value) {
  return Boolean(value?.available && Array.isArray(value.gameLog) && value.gameLog.length);
}

async function researchUncached(params = {}) {
  let publicAttempt = null, clearAttempt = null, logAttempt = null, legacyAttempt = null;

  // Public historical data is preferred where supported, but an unsupported
  // market or an identity miss must not terminate the pipeline. Previously the
  // public adapter returned early on every miss, which made valid props render
  // as dashes even when another configured historical source could answer.
  if (PUBLIC_LEAGUES[String(params.sport || '').toUpperCase()]) {
    try {
      publicAttempt = await fetchPublicResearch(params);
      if (hasUsableLog(publicAttempt)) {
        return finalizeResearch({ ...params, opponent: publicAttempt.opponent, opponentId: publicAttempt.opponentId,
          gameLog: publicAttempt.gameLog, player: publicAttempt.player, source: publicAttempt.source, cached: publicAttempt.cached,
          season: publicAttempt.season, coverage: publicAttempt.coverage });
      }
    } catch {
      publicAttempt = null;
    }
  }

  if (clearSportsConfigured()) {
    try {
      logAttempt = await fetchClearSportsResearch({
        sport: params.sport,
        playerName: params.playerName,
        team: params.team || null,
        market: params.market,
        providerMarketKey: params.providerMarketKey || null,
        games: params.games || 40,
      });
      if (hasUsableLog(logAttempt)) {
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
          season: logAttempt.season || null,
          coverage: logAttempt.coverage || {},
        });
        if (finalized.available) return finalized;
      }
    } catch (error) {
      console.error('[research] historical game log failed', String(error?.code || 'RESEARCH_UNAVAILABLE').slice(0, 80));
    }
  }

  // Legacy per-player logs are a final grounded fallback. They are never used
  // to fabricate values: the legacy service already fails closed on unmapped
  // markets, unresolved players and missing provider data.
  try {
    legacyAttempt = await fetchLegacyResearch(params);
    if (hasUsableLog(legacyAttempt)) return legacyAttempt;
  } catch {
    legacyAttempt = null;
  }

  if (clearSportsConfigured()) {
    try {
      clearAttempt = await fetchClearSportsSeasonResearch({
        sport: params.sport,
        playerName: params.playerName,
        market: params.market,
        providerMarketKey: params.providerMarketKey || null,
      });
    } catch {
      clearAttempt = null;
    }
  }

  if (logAttempt?.context) {
    clearAttempt = { ...(clearAttempt || logAttempt), context: { ...(clearAttempt?.context || {}), ...Object.fromEntries(Object.entries(logAttempt.context).filter(([,v]) => v != null && v !== '')) } };
  }

  const attempts = [publicAttempt, logAttempt, legacyAttempt, clearAttempt].filter(Boolean);
  const best = attempts.find(hasUsableLog) || clearAttempt || legacyAttempt || logAttempt || publicAttempt;
  return best || {
    ok: true, available: false, code: 'NO_GAME_LOG_DATA',
    message: 'Historical player data is unavailable for this selection.',
    gameLog: [],
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
    const output = { ...value, sections: researchSections(value) };
    results.set(key, { value: output, expires: Date.now() + (value?.available ? 15 : 3) * 60_000 });
    while (results.size > 500) results.delete(results.keys().next().value);
    return output;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}
