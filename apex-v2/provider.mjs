import {appendPublicFeeds,publicFeeds} from '../lib/ingestion/public-feeds.mjs';
import { publicPersistenceConfigured, readPublicProps } from '../lib/ingestion/public-persistence.mjs';
import { mergeCachedPropline, proplineSupplementHealth } from '../lib/ingestion/propline-supplement.mjs';
import { isConfigured as sportsDataIoConfigured } from '../lib/data-sources/sportsdataio/client.mjs';
import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';
import { primaryOddsProvider, providerCatalog } from '../lib/autoscout/providers/index.mjs';
import { loadPersistedDiagnostics, snapshotDiagnostics } from '../lib/autoscout/runtime-store.mjs';

await loadPersistedDiagnostics();

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  if (value == null || value === '') return null;
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

async function fetchBaseBoard(league, { signal, force = false, includeAlternates = false, cacheOnly = false, respectFresh = false } = {}) {
  const selected = text(league || 'NFL').toUpperCase();
  const oddsProvider = primaryOddsProvider();
  let oddsError = null;

  if (oddsProvider) {
    try {
      return await oddsProvider.fetchBoard(selected, { signal, force, includeAlternates, cacheOnly, respectFresh });
    } catch (error) {
      oddsError = error;
    }
  }

  if(cacheOnly)throw oddsError||Object.assign(new Error('No cached provider board.'),{code:'NO_CACHED_BOARD'});
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

function emptyPublicBoard(sport) {
  const now = new Date().toISOString();
  return {
    props: [],
    data: { events: [], players: [], props: [], lines: [] },
    meta: {
      provider: 'Public feed database',
      sport,
      fetchedAt: now,
      ingestionTimestamp: now,
      cacheHit: true,
      stale: false,
      sportsbooks: [],
      sportsbookCount: 0,
      propCount: 0,
      lineCount: 0,
      events: 0,
      regularLinesOnly: true,
      includesAlternates: false,
      publicFirst: true,
    },
  };
}

function mergePersistedPublic(board, rows, sport) {
  const accepted = (Array.isArray(rows) ? rows : []).filter((row) =>
    text(row?.sport).toUpperCase() === sport && row?.isAlternate !== true && num(row?.line) !== null && ['OVER','UNDER'].includes(text(row?.side).toUpperCase()));
  if (!accepted.length) return {...board, meta:{...(board.meta||{}), databasePublicProps:0, publicFirst:true}};
  const props = [...new Map([...(board.props || []), ...accepted].map((row) => [row.id, row])).values()];
  const books = [...new Set(props.map((row) => text(row.sportsbookKey).toLowerCase()).filter(Boolean))].sort();
  const events = new Set(props.map((row) => row.eventId).filter(Boolean)).size;
  return {
    ...board,
    props,
    meta: {
      ...(board.meta || {}),
      provider: board.props?.length ? board.meta?.provider || 'Cached provider + public database' : 'Public feed database',
      cacheHit: true,
      publicFirst: true,
      databasePublicProps: accepted.length,
      sportsbooks: books,
      sportsbookCount: books.length,
      lineCount: props.length,
      propCount: Math.max(Number(board.meta?.propCount || 0), new Set(props.map((row) => [row.eventId,row.playerId,row.marketId].join('|'))).size),
      events: Math.max(Number(board.meta?.events || 0), events),
      regularLinesOnly: true,
      includesAlternates: false,
    },
  };
}

async function fetchPublicFirstBoard(sport, options) {
  let persisted = [];
  try { persisted = await readPublicProps(sport); } catch {}

  let cached = null;
  try {
    cached = await fetchBaseBoard(sport, { ...options, force: false, cacheOnly: true });
  } catch {}

  let board = await appendPublicFeeds(cached || emptyPublicBoard(sport), sport);
  board = mergePersistedPublic(board, persisted, sport);
  // PropLine is cache-only on the customer path. Existing direct/public rows
  // win identity collisions; PropLine only fills missing book/market coverage.
  board = mergeCachedPropline(board, sport);
  if (board.props.length || options.cacheOnly || options.allowPaidRefresh !== true) return board;

  // Metered network access is opt-in only in public-first mode. Browser page loads,
  // health checks and persistence bootstraps never set allowPaidRefresh.
  const live = await fetchBaseBoard(sport, { ...options, cacheOnly: false });
  board = await appendPublicFeeds(live, sport);
  board = mergePersistedPublic(board, persisted, sport);
  return mergeCachedPropline(board, sport);
}

export async function fetchUnifiedBoard(league,options={}) {
  const sport=text(league||'NFL').toUpperCase();
  if(options.refreshPublicFeeds===true&&!options.cacheOnly)await publicFeeds.refresh();

  if (publicPersistenceConfigured() && text(process.env.AUTOSCOUT_PUBLIC_FIRST).toLowerCase() !== 'false') {
    return fetchPublicFirstBoard(sport, options);
  }

  // Legacy behavior remains available for local/test environments without the
  // secure public store. Production uses the public-first branch above.
  try{
    const board=await appendPublicFeeds(await fetchBaseBoard(sport,options),sport);
    return mergeCachedPropline(board,sport);
  }
  catch(error){
    let fallback=await appendPublicFeeds({props:[],data:{events:[],players:[],props:[],lines:[]},meta:{provider:'Public platform feeds',stale:true,cacheHit:true,warning:'Primary sportsbook feed is temporarily unavailable.'}},sport);
    fallback=mergeCachedPropline(fallback,sport);
    if(fallback.props.length)return fallback;
    throw error;
  }
}

export function providerDiagnostics() {
  return {
    checkedAt: new Date().toISOString(),
    catalog: providerCatalog(),
    publicFeeds: publicFeeds.health(),
    proplineSupplement: proplineSupplementHealth(),
    runtime: snapshotDiagnostics(),
    inflightRefreshes: [...inflight.keys()].map((key) => key.replace(/^[^|]+\|/, '')),
  };
}

export function providerHealth() {
  const oddsProvider = primaryOddsProvider();
  const oddsHealth = oddsProvider?.health?.() || null;
  const publicFirst = publicPersistenceConfigured() && text(process.env.AUTOSCOUT_PUBLIC_FIRST).toLowerCase() !== 'false';
  return {
    theOddsApiConfigured: oddsProvider?.id === 'the-odds-api' && oddsProvider.isConfigured(),
    sportsGameOddsConfigured: Boolean(text(process.env.SPORTSGAMEODDS_API_KEY)),
    sportsDataIoConfigured: sportsDataIoConfigured(),
    preferredProvider: publicFirst ? 'Public feed database' : oddsProvider?.name || 'SportsDataIO fallback',
    publicFirst,
    regularLinesOnly: true,
    proplineSupplement: proplineSupplementHealth(),
    // `provider` describes the provider actually serving page requests. In
    // public-first production the metered provider is intentionally paused, so
    // reporting it as the active provider makes healthy zero-credit deploys
    // look unconfigured to health checks.
    provider: publicFirst ? { id: 'public-feed-database', configured: true } : oddsHealth,
    diagnostics: snapshotDiagnostics(),
    time: new Date().toISOString(),
  };
}
