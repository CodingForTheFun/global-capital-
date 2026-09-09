import { getProvider } from '../data-sources/registry.mjs';
import { normalizePlayerName } from '../data-sources/contract.mjs';
import { toNumberOrNull } from './model.mjs';
import { scoreProps } from '../scoring/index.mjs';
import { applyScoutRuleAudit } from '../rules/scout.mjs';

const CONCURRENCY = 4;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, worker));
  return out;
}

function h2hRate(gameLog = [], opponent) {
  const target = normalizePlayerName(opponent);
  if (!target) return null;
  const games = gameLog.filter((game) => normalizePlayerName(game?.opponent) === target && typeof game?.hit === 'boolean');
  if (!games.length) return null;
  return Math.round((games.filter((game) => game.hit).length / games.length) * 100);
}

function mergeAnalytics(prop, analytics) {
  if (!analytics) return prop;
  const windows = analytics.windows || {};
  const hitRates = { ...(prop.hitRates || {}) };
  for (const id of ['l5', 'l10', 'l15', 'l20', 'season']) {
    const value = toNumberOrNull(windows[id]?.hitRate);
    if (value !== null) hitRates[id] = value;
  }
  const h2h = h2hRate(analytics.gameLog, prop.opponent);
  if (h2h !== null) hitRates.h2h = h2h;

  const average = toNumberOrNull(windows.l5?.average ?? windows.l10?.average ?? windows.season?.average);
  const line = toNumberOrNull(prop.line);
  const edge = average !== null && line !== null ? Number((average - line).toFixed(2)) : prop.edge ?? null;
  const lastFiveResults = (analytics.gameLog || []).slice(0, 5).map((game) => ({
    value: toNumberOrNull(game.value),
    hit: typeof game.hit === 'boolean' ? game.hit : null,
    date: game.date ?? null,
    opponent: game.opponent ?? null,
  }));

  return {
    ...prop,
    hitRates,
    average: average ?? prop.average ?? null,
    edge,
    lastFiveResults,
    recentGameStats: (analytics.gameLog || []).slice(0, 20),
    historicalUpdatedAt: analytics.fetchedAt || null,
    enrichment: {
      ...(prop.enrichment || {}),
      historicalSource: analytics.source || 'SportsDataIO',
      historicalFetchedAt: analytics.fetchedAt || null,
    },
  };
}

/**
 * Hydrate only the visible page. SportsDataIO game-log calls are cached by
 * player path, so repeated markets for the same player share the same upstream
 * response instead of refetching it. This keeps list UX rich without issuing
 * one request for every prop in the full 500-row universe.
 */
export async function hydrateVisibleHistory(props = [], { log = console } = {}) {
  const adapter = getProvider('sportsdataio');
  if (!adapter || typeof adapter.playerGameLog !== 'function' || !adapter.isConfigured?.()) return props;

  const hydrated = await mapLimit(props, CONCURRENCY, async (prop) => {
    if (!prop?.providerPlayerId || !prop?.sport || !prop?.market) return prop;
    try {
      const analytics = await adapter.playerGameLog({
        sport: prop.sport,
        playerId: prop.providerPlayerId,
        market: prop.market,
        line: prop.line,
        side: prop.side,
        games: 20,
      });
      return mergeAnalytics(prop, analytics);
    } catch (error) {
      log?.error?.('[Scout Pro history] page hydration failed', JSON.stringify({ sport: prop.sport, code: error?.code || null }));
      return prop;
    }
  });

  return scoreProps(hydrated).map((prop) => applyScoutRuleAudit(prop));
}
