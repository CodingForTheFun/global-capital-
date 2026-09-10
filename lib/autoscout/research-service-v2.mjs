import { researchPlayerProp as researchSportsDataIO, researchHealth as sportsDataIOHealth, finalizeResearch } from './research-service.mjs';
import { fetchClearSportsResearch } from '../data-sources/clearsports/research.mjs';
import { clearSportsConfigured, clearSportsHealth } from '../data-sources/clearsports/research.mjs';
import { clearSportsSeasonHealth, fetchClearSportsSeasonResearch } from '../data-sources/clearsports/season-research.mjs';
import { researchSections } from '../analytics/research.mjs';

export function researchHealth() {
  const fallback = sportsDataIOHealth();
  return {
    configured: clearSportsConfigured() || Boolean(fallback?.configured),
    primary: 'ClearSports player research',
    historicalGameLogProvider: 'ClearSports with SportsDataIO fallback',
    clearSports: clearSportsSeasonHealth(),
    sportsDataIO: fallback,
  };
}

export async function researchLiveHealth() {
  const [clearSports, fallback] = await Promise.all([
    clearSportsHealth({ live: true }),
    Promise.resolve(sportsDataIOHealth()),
  ]);
  return {
    configured: Boolean(clearSports?.configured || fallback?.configured),
    primary: 'ClearSports player research',
    historicalGameLogProvider: 'ClearSports with SportsDataIO fallback',
    clearSports,
    sportsDataIO: fallback,
  };
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
      // path and the SportsDataIO fallback below still apply.
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
  const fallback = await researchSportsDataIO(params);
  if (fallback?.available) {
    return clearAttempt
      ? {
          ...fallback,
          context: { ...(clearAttempt?.context || {}), ...Object.fromEntries(Object.entries(fallback?.context || {}).filter(([, value]) => value != null && value !== '')) },
          providerAttempts: {
            clearSports: {
              code: clearAttempt.code || null,
              available: false,
              seasonStat: clearAttempt?.context?.seasonStat ?? null,
            },
          },
        }
      : fallback;
  }

  if (clearAttempt) {
    return {
      ...clearAttempt,
      context: { ...(clearAttempt.context || {}), ...Object.fromEntries(Object.entries(fallback?.context || {}).filter(([, value]) => value != null && value !== '')) },
      matchup: fallback?.matchup || clearAttempt.matchup || null,
      fallback: {
        provider: 'SportsDataIO',
        available: Boolean(fallback?.available),
        code: fallback?.code || null,
        providerStatus: fallback?.providerStatus ?? null,
      },
    };
  }

  return fallback;
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
