import { projectedStat } from '../projections/stat-estimate.mjs';
import { finalizeResearch } from './research-service.mjs';
import { researchSections } from '../analytics/research.mjs';
import { canonicalSport } from '../data-sources/espn/stat-contract.mjs';
import { fetchStoredResearch, storedResearchConfigured } from '../ingestion/stored-research.mjs';

export function researchHealth() {
  return { configured: storedResearchConfigured(), mode: 'stored-zero-credit' };
}
export async function researchLiveHealth() {
  return researchHealth();
}

async function researchUncached(params = {}) {
  params = { ...params, sport: canonicalSport(params.sport) };
  const stored = await fetchStoredResearch(params);
  if (!stored.available) return stored;
  return {
    ...finalizeResearch({
      ...params,
      gameLog: stored.gameLog,
      player: stored.player,
      source: stored.source || 'ESPN background sync',
      cached: true,
      season: stored.season,
      coverage: stored.coverage,
    }),
    source: stored.source || 'ESPN background sync',
    cached: true,
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
    results.set(key, { value: output, expires: Date.now() + (value?.available ? 10 : 2) * 60_000 });
    while (results.size > 1000) results.delete(results.keys().next().value);
    return output;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}
