import { finalizeResearch } from './research-service.mjs';
import { fetchClearSportsResearch } from '../data-sources/clearsports/research.mjs';
import { clearSportsConfigured, clearSportsHealth } from '../data-sources/clearsports/research.mjs';
import { clearSportsSeasonHealth, fetchClearSportsSeasonResearch } from '../data-sources/clearsports/season-research.mjs';
import { researchSections } from '../analytics/research.mjs';

export function researchHealth() {
  return { configured: clearSportsConfigured(), clearSports: clearSportsSeasonHealth() };
}

export async function researchLiveHealth() {
  return { configured: clearSportsConfigured(), clearSports: await clearSportsHealth({ live: true }) };
}

async function researchUncached(params = {}) {
  let clearAttempt = null, logAttempt = null;

  // ClearSports can return per-game rows, which is the only thing that powers
  // L5/L10/L15, the game-by-game chart and H2H. That adapter existed but was
  // never called, so game logs could only ever come from SportsDataIO. Try it
  // first, and only fall through when it cannot produce a usable log.
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
      // A game-log failure must not take the whole request down; the season
      // context path below still applies.
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
  return clearAttempt || logAttempt || {
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
    const output = { ...value, sections: researchSections(value) };
    results.set(key, { value: output, expires: Date.now() + (value?.available ? 15 : 5) * 60_000 });
    while (results.size > 500) results.delete(results.keys().next().value);
    return output;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}
