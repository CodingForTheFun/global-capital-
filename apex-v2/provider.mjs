import {appendPublicFeeds,publicFeeds} from '../lib/ingestion/public-feeds.mjs';
import {normalizedDataFromBoardRows} from '../lib/ingestion/normalize.mjs';
import { publicPersistenceConfigured, readPublicProps } from '../lib/ingestion/public-persistence.mjs';
import { mergeCachedPropline, proplineSupplementHealth } from '../lib/ingestion/propline-supplement.mjs';
import { mergeCachedSportsGameOdds, sportsGameOddsSupplementHealth } from '../lib/ingestion/sportsgameodds-supplement.mjs';
import { mergeCachedSportradar, sportradarSupplementHealth } from '../lib/ingestion/sportradar-supplement.mjs';
import { filterCustomerBoardFreshness } from '../lib/ingestion/customer-prop-freshness.mjs';
import { isConfigured as sportsDataIoConfigured } from '../lib/data-sources/sportsdataio/client.mjs';
import { sportsGameOddsConfigured } from '../lib/data-sources/sportsgameodds/client.mjs';
import { sportradarConfigured } from '../lib/data-sources/sportradar/client.mjs';
import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';
import { primaryOddsProvider, providerCatalog } from '../lib/autoscout/providers/index.mjs';
import { propProviderMode } from '../lib/autoscout/provider-mode.mjs';
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

function mergeProviderCaches(board, sport) {
  const mode = propProviderMode();
  if (mode === 'sportradar') {
    return mergeCachedSportsGameOdds(
      mergeCachedSportradar(board, sport, { primary: true }),
      sport,
      { primary: false },
    );
  }
  if (mode === 'sportsgameodds') {
    return mergeCachedSportsGameOdds(board, sport, { primary: true });
  }
  if (mode === 'propline') {
    return mergeCachedSportsGameOdds(
      mergeCachedPropline(board, sport),
      sport,
      { primary: false },
    );
  }
  // AUTO preserves the previous production quote precedence.
  return mergeCachedSportsGameOdds(
    mergeCachedPropline(board, sport),
    sport,
    { primary: false },
  );
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
  // Merging into board.props alone put these rows in front of customers but
  // left them out of persistence: mapBoard() writes board.data, never
  // board.props. That is why sportsbook lines were served on the board yet
  // never reached prop_lines, and why Compare, snipes and line history saw
  // only the two in-memory DFS feeds.
  //
  // The persisted rows are the newer observation, so they win an id collision
  // here for the same reason they already win for props above.
  const rebuilt = normalizedDataFromBoardRows(accepted);
  const data = {};
  for (const key of ['events', 'players', 'props', 'lines']) {
    data[key] = [...new Map([...(board.data?.[key] || []), ...(rebuilt[key] || [])].map((row) => [row.id, row])).values()];
  }
  return {
    ...board,
    props,
    data,
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

// The customer board reads persisted props with a 900ms budget and no direct
// fallback, because a page load must not wait on the database. When that read
// times out the rows come back empty, and on a fresh container - every deploy -
// the in-memory feed cache is cold too, so the board renders with nothing on it.
// That is how a single slow read empties the whole product.
//
// Holding the last good read per sport means a database blip costs freshness
// rather than the entire board. Two rules make that safe rather than merely
// convenient:
//
//   * it is capped by age. A stale betting line someone acts on is worse than
//     no line, so beyond the cap the board goes back to showing nothing.
//   * it is labelled. The board already carries meta.stale for exactly this,
//     and falling back sets it, so nothing presents an old number as live.
const lastGoodPersisted = new Map();
const PERSISTED_FALLBACK_MAX_AGE_MS = 15 * 60_000;

function rememberPersisted(sport, rows) {
  if (Array.isArray(rows) && rows.length) lastGoodPersisted.set(sport, { rows, at: Date.now() });
}

function recallPersisted(sport, now = Date.now()) {
  const hit = lastGoodPersisted.get(sport);
  if (!hit) return null;
  if (now - hit.at > PERSISTED_FALLBACK_MAX_AGE_MS) { lastGoodPersisted.delete(sport); return null; }
  return hit;
}

export function __persistedFallbackState() {
  return { sports: [...lastGoodPersisted.keys()], maxAgeMs: PERSISTED_FALLBACK_MAX_AGE_MS };
}

async function fetchPublicFirstBoard(sport, options) {
  let persisted = [];
  let persistedReadFailed = false;
  try {
    persisted = await readPublicProps(sport);
    rememberPersisted(sport, persisted);
  } catch {
    // Last-good persisted rows remain available for diagnostics/recovery only.
    // A customer request must not substitute an unverifiable older snapshot.
    persistedReadFailed = true;
  }

  let cached = null;
  try {
    cached = await fetchBaseBoard(sport, { ...options, force: false, cacheOnly: true });
    // Provider caches may retain a last successful board for recovery. Keep
    // that internally, but never seed the customer board with a known-stale
    // provider snapshot.
    if (cached?.meta?.stale === true) cached = null;
  } catch {}

  let board = await appendPublicFeeds(cached || emptyPublicBoard(sport), sport);
  board = mergePersistedPublic(board, persisted, sport);
  // Paid providers are cache-only on the customer path. The selected switch
  // word controls quote precedence; page loads never fan out upstream.
  board = mergeProviderCaches(board, sport);
  if (persistedReadFailed) {
    board = { ...board, meta: { ...board.meta, persistedReadFailed: true } };
  }
  if (board.props.length || options.cacheOnly || options.allowPaidRefresh !== true) return board;

  // Metered network access is opt-in only in public-first mode. Browser page loads,
  // health checks and persistence bootstraps never set allowPaidRefresh.
  const live = await fetchBaseBoard(sport, { ...options, cacheOnly: false });
  board = await appendPublicFeeds(live, sport);
  board = mergePersistedPublic(board, persisted, sport);
  return mergeProviderCaches(board, sport);
}

export async function fetchUnifiedBoard(league,options={}) {
  const sport=text(league||'NFL').toUpperCase();
  if(options.refreshPublicFeeds===true&&!options.cacheOnly)await publicFeeds.refresh();

  if (publicPersistenceConfigured() && text(process.env.AUTOSCOUT_PUBLIC_FIRST).toLowerCase() !== 'false') {
    return filterCustomerBoardFreshness(await fetchPublicFirstBoard(sport, options));
  }

  // Legacy behavior remains available for local/test environments without the
  // secure public store. Production uses the public-first branch above.
  try{
    const base=await fetchBaseBoard(sport,options);
    // A provider may intentionally return its last successful board after an
    // upstream failure. Keep that cache for recovery, but do not seed a
    // customer response with a board already known to be stale.
    const customerBase=base?.meta?.stale===true
      ? {props:[],data:{events:[],players:[],props:[],lines:[]},meta:{provider:base?.meta?.provider||'Provider cache',cacheHit:true,stale:false,knownStaleRejected:true}}
      : base;
    const board=await appendPublicFeeds(customerBase,sport);
    return filterCustomerBoardFreshness(mergeProviderCaches(board,sport));
  }
  catch(error){
    let fallback=await appendPublicFeeds({props:[],data:{events:[],players:[],props:[],lines:[]},meta:{provider:'Public platform feeds',stale:true,cacheHit:true,warning:'Primary sportsbook feed is temporarily unavailable.'}},sport);
    fallback=filterCustomerBoardFreshness(mergeProviderCaches(fallback,sport));
    if(fallback.props.length)return fallback;
    throw error;
  }
}

export function providerDiagnostics() {
  return {
    checkedAt: new Date().toISOString(),
    catalog: providerCatalog(),
    publicFeeds: publicFeeds.health(),
    providerMode: propProviderMode(),
    proplineSupplement: proplineSupplementHealth(),
    sportradarSupplement: sportradarSupplementHealth(),
    sportsGameOddsSupplement: sportsGameOddsSupplementHealth(),
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
    providerMode: propProviderMode(),
    sportradarConfigured: sportradarConfigured(),
    sportsGameOddsConfigured: sportsGameOddsConfigured(),
    sportsDataIoConfigured: sportsDataIoConfigured(),
    preferredProvider: publicFirst ? 'Public feed database' : oddsProvider?.name || 'SportsDataIO fallback',
    publicFirst,
    regularLinesOnly: true,
    proplineSupplement: proplineSupplementHealth(),
    sportradarSupplement: sportradarSupplementHealth(),
    sportsGameOddsSupplement: sportsGameOddsSupplementHealth(),
    // `provider` describes the provider actually serving page requests. In
    // public-first production the metered provider is intentionally paused, so
    // reporting it as the active provider makes healthy zero-credit deploys
    // look unconfigured to health checks.
    provider: publicFirst ? { id: 'public-feed-database', configured: true } : oddsHealth,
    diagnostics: snapshotDiagnostics(),
    time: new Date().toISOString(),
  };
}
