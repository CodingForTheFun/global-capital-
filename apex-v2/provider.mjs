import { isConfigured as sportsDataIoConfigured } from '../lib/data-sources/sportsdataio/client.mjs';
import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';
import { primaryOddsProvider, providerCatalog } from '../lib/autoscout/providers/index.mjs';
import { loadPersistedDiagnostics, snapshotDiagnostics } from '../lib/autoscout/runtime-store.mjs';

await loadPersistedDiagnostics();

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const inflight = new Map();

function normalizeSportsDataIo(board, league) {
  const props = (board?.offers || []).map((o, i) => ({
    id: [league, o.gameId, o.playerId, o.market, o.sportsbookKey, o.side, o.line, i].join('|'),
    source: o.consensus ? 'SportsDataIO Consensus' : 'SportsDataIO',
    provider: 'sportsdataio',
    sport: text(o.sport || league).toUpperCase(),
    eventId: text(o.gameId),
    playerId: text(o.playerId),
    playerName: text(o.playerName),
    team: text(o.team),
    statId: '',
    marketId: text(o.bettingMarketId),
    market: text(o.market || 'Player Prop'),
    period: text(o.periodType || 'game'),
    side: text(o.side).toUpperCase(),
    line: num(o.line),
    price: '',
    impliedProbability: null,
    sportsbook: text(o.sportsbook || (o.consensus ? 'Consensus' : 'SportsDataIO')),
    sportsbookKey: text(o.sportsbookKey || (o.consensus ? 'consensus' : 'sportsdataio')).toLowerCase(),
    fairOdds: '',
    fairLine: null,
    consensusLine: null,
    gameStartTime: o.gameStartTime || null,
    homeTeam: text(o.homeTeam),
    awayTeam: text(o.awayTeam),
    homeScore: null,
    awayScore: null,
    live: false,
    started: false,
    completed: false,
    isAlternate: false,
    providerUpdatedAt: o.updatedAt || null,
    ingestedAt: board?.fetchedAt || new Date().toISOString(),
    updatedAt: o.updatedAt || null,
    deeplink: '',
  })).filter((p) => p.playerName && p.line !== null && (p.side === 'OVER' || p.side === 'UNDER'));

  const coverage = board?.coverage || [];
  const books = [...new Set(props.map((p) => p.sportsbookKey).filter(Boolean))].sort();
  return {
    props,
    data: { events: [], players: [], props: [], lines: [] },
    meta: {
      provider: 'SportsDataIO fallback',
      fetchedAt: board?.fetchedAt || new Date().toISOString(),
      ingestionTimestamp: board?.fetchedAt || new Date().toISOString(),
      latencyMs: board?.latencyMs ?? null,
      events: coverage.reduce((n, r) => n + Number(r?.gamesChecked || 0), 0),
      sportsbooks: books,
      sportsbookCount: books.length,
      propCount: props.length,
      lineCount: props.length,
      liveEvents: 0,
      fullBookCoverage: false,
      regularLinesOnly: true,
      includesAlternates: false,
      warning: 'Legacy provider fallback. Normalized entity collections are unavailable for this fallback feed.',
    },
  };
}

async function fetchSportsDataIo(league, { force = false } = {}) {
  const board = await sportsDataIoPropBoard.fetchBoard({ sports: [league], force });
  return normalizeSportsDataIo(board, league);
}

async function fetchPrimaryCoalesced(provider, selected, options) {
  const key = `${provider.id}|${selected}|${options.includeAlternates ? 'alternate' : 'main'}`;
  if (!options.force && inflight.has(key)) return inflight.get(key);
  const pending = provider.fetchBoard(selected, options);
  if (!options.force) inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inflight.get(key) === pending) inflight.delete(key);
  }
}

export async function fetchUnifiedBoard(league, { signal, force = false, includeAlternates = false } = {}) {
  const selected = text(league || 'NFL').toUpperCase();
  const oddsProvider = primaryOddsProvider();
  let oddsError = null;

  if (oddsProvider) {
    try {
      return await fetchPrimaryCoalesced(oddsProvider, selected, { signal, force, includeAlternates });
    } catch (error) {
      oddsError = error;
    }
  }

  if (sportsDataIoConfigured()) {
    try {
      const fallback = await fetchSportsDataIo(selected, { force });
      return {
        ...fallback,
        meta: {
          ...(fallback.meta || {}),
          preferredProvider: oddsProvider?.name || 'The Odds API',
          warning: oddsError
            ? `Primary odds provider unavailable; serving legacy fallback: ${String(oddsError?.message || oddsError)}`
            : 'No configured primary odds provider; using the legacy fallback.',
        },
      };
    } catch (fallbackError) {
      if (oddsError) throw oddsError;
      throw fallbackError;
    }
  }

  if (oddsError) throw oddsError;
  throw Object.assign(new Error('No odds provider is configured.'), { code: 'NO_PROVIDER' });
}

export function providerDiagnostics() {
  return {
    checkedAt: new Date().toISOString(),
    catalog: providerCatalog(),
    runtime: snapshotDiagnostics(),
    inflightRefreshes: [...inflight.keys()].map((key) => key.replace(/^[^|]+\|/, '')),
  };
}

export function providerHealth() {
  const oddsProvider = primaryOddsProvider();
  const oddsHealth = oddsProvider?.health?.() || null;
  return {
    theOddsApiConfigured: oddsProvider?.id === 'the-odds-api' && oddsProvider.isConfigured(),
    sportsGameOddsConfigured: Boolean(text(process.env.SPORTSGAMEODDS_API_KEY)),
    sportsDataIoConfigured: sportsDataIoConfigured(),
    preferredProvider: oddsProvider?.name || 'SportsDataIO fallback',
    regularLinesOnly: true,
    provider: oddsHealth,
    diagnostics: snapshotDiagnostics(),
    time: new Date().toISOString(),
  };
}
