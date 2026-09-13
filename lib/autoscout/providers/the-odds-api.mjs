import { createGameBoard } from './game-markets.mjs';
import { tacoOffer, activeTacos } from './taco-offers.mjs';
import { marketContract } from '../../data-sources/espn/stat-contract.mjs';
import { samePublicTeam } from '../../data-sources/espn/identity.mjs';
import {
  SUPPORTED_SPORTS,
  normalizedEvent,
  normalizedPlayer,
  normalizedProp,
  normalizedBookmakerLine,
  stableId,
  numberOrNull,
  validateNormalizedBoard,
} from '../models.mjs';
import {
  readCachedBoard,
  writeCachedBoard,
  markSportSync,
  markEventSync,
  recordProviderRequest,
  recordProviderError,
  recordSportIngestion,
  recordSportFailure,
  snapshotDiagnostics,
} from '../runtime-store.mjs';

import { COVERAGE_VERSION, marketCatalog, allocateMarkets, createCreditLedger, summarizeCoverage, coverageWarning } from './odds-coverage.mjs';

const BASE = 'https://api.the-odds-api.com/v4';
const refreshBudget = createCreditLedger(() => snapshotDiagnostics().quota.remaining);

export const SPORT_KEYS = Object.freeze({
  NFL: 'americanfootball_nfl',
  NCAAF: 'americanfootball_ncaaf',
  NBA: 'basketball_nba',
  NCAAB: 'basketball_ncaab',
  WNBA: 'basketball_wnba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  MLS: 'soccer_usa_mls', EPL: 'soccer_epl', UCL: 'soccer_uefa_champs_league',
});

const DEFAULT_BOOKMAKERS = Object.freeze([
  'prizepicks', 'underdog', 'pick6', 'dabble_us_dfs',
  'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'fanatics', 'betrivers',
]);

// Ten explicit books retain DFS plus sportsbook comparisons for one billed
// region. An owner-provided region override is still respected.
const DEFAULT_REGIONS = Object.freeze([]);

const NON_OU_MARKETS = new Set([
  'player_1st_td','player_anytime_td','player_last_td','player_first_basket',
  'player_first_team_basket','player_double_double','player_triple_double',
  'player_method_of_first_basket','batter_first_home_run','pitcher_record_a_win',
  'player_goal_scorer_first','player_goal_scorer_last','player_goal_scorer_anytime',
]);

const marketCache = new Map();
const text = (value) => String(value ?? '').trim();
const intEnv = (name, fallback, min, max) => {
  const raw = process.env[name];
  const n = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

function apiKey() { return text(process.env.THE_ODDS_API_KEY); }
function monthlyCredits() { return intEnv('THE_ODDS_API_MONTHLY_CREDITS', 20_000, 500, 100_000_000); }
function maxEvents() { return intEnv('THE_ODDS_API_MAX_EVENTS', 25, 1, 100); }
function maxMarkets() { return intEnv('THE_ODDS_API_MAX_MARKETS_PER_EVENT', 100, 1, 200); }
function maxRefreshCredits() { return intEnv('THE_ODDS_API_MAX_CREDITS_PER_REFRESH', 250, 1, 2500); }
function coverageSignature(scope) {
  return stableId([COVERAGE_VERSION, JSON.stringify(scope.params), maxEvents(), maxMarkets(), maxRefreshCredits()]);
}
function configuredRegions() {
  const raw = text(process.env.THE_ODDS_API_REGIONS).toLowerCase();
  if (raw === 'off' || raw === 'none') return [];
  const list = raw ? raw.split(',') : DEFAULT_REGIONS;
  return [...new Set(list.map((v) => text(v).toLowerCase()).filter(Boolean))].slice(0, 8);
}
// Which scope parameter this request will carry. Regions widen the book list
// to every book in those regions; bookmakers restrict it to a named set.
function oddsScope() {
  const regions = configuredRegions();
  return regions.length
    ? { params: { regions: regions.join(',') }, regions, bookmakers: [], billedRegions: regions.length }
    : (() => {
        const bookmakers = configuredBookmakers();
        return {
          params: { bookmakers: bookmakers.join(',') },
          regions: [], bookmakers,
          // Every group of ten bookmakers bills as one region.
          billedRegions: Math.max(1, Math.ceil(bookmakers.length / 10)),
        };
      })();
}
/**
 * Credits one full refresh of one sport is expected to cost.
 *
 * [markets] x [regions] per event-odds call, plus one market-discovery call
 * per event. The event-list endpoint itself is free. Surfaced in owner diagnostics so the
 * spend of a configuration change is visible before the invoice is.
 */
export function projectedCreditsPerRefresh() {
  const scope = oddsScope();
  const perEvent = maxMarkets() * scope.billedRegions;
  const events = maxEvents();
  return {
    events,
    marketsPerEvent: maxMarkets(),
    billedRegions: scope.billedRegions,
    scope: scope.regions.length ? 'regions' : 'bookmakers',
    creditsPerEvent: perEvent,
    creditsPerRefresh: Math.min(maxRefreshCredits(), events * (perEvent + 1)),
    fullCoverageCeiling: events * (perEvent + 1),
    monthlyCredits: monthlyCredits(),
  };
}
function configuredBookmakers() {
  const raw = text(process.env.THE_ODDS_API_BOOKMAKERS);
  return [...new Set((raw ? raw.split(',') : DEFAULT_BOOKMAKERS).map((v) => text(v).toLowerCase()).filter(Boolean))].slice(0, 20);
}
function isPropMarket(key, includeAlternates = false) {
  const value = text(key).toLowerCase();
  if (!value) return false;
  if (!includeAlternates && value.includes('_alternate')) return false;
  if (NON_OU_MARKETS.has(value)) return false;
  return value.startsWith('player_') || value.startsWith('batter_') || value.startsWith('pitcher_') || ['team_sacks','team_defensive_sacks','team_sacks_allowed','team_points_allowed','points_allowed'].includes(value);
}
function labelMarket(key) {
  return text(key).replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' ')
    .replace(/\btds\b/gi, 'TDs').replace(/\byds\b/gi, 'Yards').replace(/\brbis\b/gi, 'RBIs')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
function sideOf(value) {
  const side = text(value).toUpperCase();
  return side === 'OVER' || side === 'UNDER' ? side : null;
}
function impliedProbability(price) {
  const n = numberOrNull(price);
  if (n === null || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : (-n) / ((-n) + 100);
}
function median(values) {
  const rows = values.map(numberOrNull).filter((v) => v !== null).sort((a, b) => a - b);
  if (!rows.length) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}
function quotaRatio() {
  const d = snapshotDiagnostics();
  const remaining = numberOrNull(d?.quota?.remaining);
  return remaining !== null ? Math.max(0, Math.min(1, remaining / monthlyCredits())) : 1;
}
function policyTtl(events = []) {
  const now = Date.now();
  const starts = events.map((event) => Date.parse(event.commenceTime || '')).filter(Number.isFinite);
  let ttl = 2700;
  if (!starts.length) ttl = 3600;
  else {
    const closest = Math.min(...starts.map((start) => Math.abs(start - now)));
    const anyStartedRecently = starts.some((start) => start <= now && start > now - 6 * 3600_000);
    if (anyStartedRecently) ttl = 180;
    else if (closest <= 2 * 3600_000) ttl = 300;
    else if (closest <= 8 * 3600_000) ttl = 600;
    else if (closest <= 24 * 3600_000) ttl = 1200;
  }
  const ratio = quotaRatio();
  if (ratio <= 0.10) ttl *= 4;
  else if (ratio <= 0.25) ttl *= 2;
  else if (ratio <= 0.50) ttl = Math.round(ttl * 1.35);
  return ttl;
}

async function apiGet(path, params = {}, { signal, sport = null, event = null } = {}) {
  if (!apiKey()) throw Object.assign(new Error('The Odds API is not configured.'), { code: 'NOT_CONFIGURED' });
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apiKey', apiKey());
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  } catch (error) {
    recordProviderError({ provider: 'the-odds-api', endpoint: path, sport, event, reason: error?.message, code: error?.code });
    throw error;
  }
  const used = numberOrNull(response.headers.get('x-requests-used'));
  const remaining = numberOrNull(response.headers.get('x-requests-remaining'));
  const cost = numberOrNull(response.headers.get('x-requests-last'));
  recordProviderRequest({ cost, remaining, used });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = body?.message || body?.error || `Provider HTTP ${response.status}`;
    recordProviderError({ provider: 'the-odds-api', endpoint: path, sport, event, status: response.status, reason, code: body?.error_code || body?.code });
    const error = Object.assign(new Error(reason), { status: response.status, code: body?.error_code || body?.code || 'ODDS_API_ERROR' });
    throw error;
  }
  return body;
}

async function discoverMarkets(sportKey, eventId, scope, { signal, sport, budget, includeAlternates = false } = {}) {
  const key = `${sportKey}|${eventId}|${includeAlternates ? 'alt' : 'main'}|${JSON.stringify(scope.params)}`;
  const cached = marketCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.catalog;
  const body = await budget.run(1, () => apiGet(`/sports/${sportKey}/events/${eventId}/markets`, {
    ...scope.params, dateFormat: 'iso',
  }, { signal, sport, event: eventId }));
  if (!body || !Array.isArray(body.bookmakers)) throw Object.assign(new Error('Invalid market catalog.'), { code: 'INVALID_CATALOG' });
  const catalog = marketCatalog(body.bookmakers, key => isPropMarket(key, includeAlternates));
  // Do not freeze newly posted DFS markets out for six hours. This cache only
  // expires; it never polls. Refresh cadence remains owned by the board cache.
  const ttl = catalog.length ? 30 * 60_000 : 5 * 60_000;
  marketCache.delete(key);
  marketCache.set(key, { catalog, expiresAt: Date.now() + ttl });
  while (marketCache.size > 1000) marketCache.delete(marketCache.keys().next().value);
  return catalog;
}

function normalizeOddsEvent(raw, sport, ingestedAt) {
  const commence = raw?.commence_time || null;
  const start = Date.parse(commence || '');
  const status = Number.isFinite(start) && start <= Date.now() ? 'LIVE' : 'SCHEDULED';
  return normalizedEvent({ provider: 'the-odds-api', providerEventId: raw?.id, sport, league: sport, homeTeam: raw?.home_team, awayTeam: raw?.away_team, commenceTime: commence, status, ingestedAt });
}

function normalizeEventOdds(raw, event, sport, ingestedAt, { includeAlternates = true, requestedMarkets = null, requestedBooks = null } = {}) {
  const players = new Map();
  const props = new Map();
  const lines = [];
  const compatibility = [];
  const promotions = [];

  for (const bookmaker of raw?.bookmakers || []) {
    const bookmakerKey = text(bookmaker?.key).toLowerCase();
    const bookmakerName = text(bookmaker?.title || bookmaker?.key);
    if (!bookmakerKey || (requestedBooks && !requestedBooks.has(bookmakerKey))) continue;
    for (const market of bookmaker?.markets || []) {
      const marketKey = text(market?.key).toLowerCase();
      if (!isPropMarket(marketKey, includeAlternates) || (requestedMarkets && !requestedMarkets.has(marketKey))) continue;
      for (const outcome of market?.outcomes || []) {
        const taco = tacoOffer(outcome, { book: bookmaker, sport, event, market: marketKey });
        if (taco) promotions.push(taco);
        if (outcome?.promotion?.type || outcome?.isTaco === true) continue;
        const side = sideOf(outcome?.name);
        const lineValue = numberOrNull(outcome?.point);
        let playerName = text(outcome?.description);
        const contract=marketContract({sport,providerMarketKey:marketKey,market:labelMarket(marketKey)});
        const entityType=contract?.entityType||'player';
        const matchingTeams=[event.homeTeam,event.awayTeam].filter(t=>samePublicTeam(playerName,t,sport));
        let entityTeam='';
        if(entityType==='team'){
          if(matchingTeams.length!==1)continue; // A player cannot own a unit quote.
          entityTeam=matchingTeams[0];
          playerName=entityTeam+(contract.fields[0]==='TeamDefensiveSacks'?' Defense':'');
        }else if(matchingTeams.length)continue; // Refuse a team passed as a player.
        if (!side || lineValue === null || !playerName) continue;
        if (!includeAlternates && ['isPromo','isPromotional','isBoosted','isDiscounted','isAlternate'].some(key => outcome?.[key] === true)) continue;
        if (!includeAlternates && bookmakerKey === 'underdog' && outcome?.multiplier != null && numberOrNull(outcome.multiplier) !== 1) continue;
        const playerId = stableId([entityType, sport, playerName]);
        if (!players.has(playerId)) players.set(playerId, normalizedPlayer({ id: playerId, provider: 'the-odds-api', sport, name: playerName, team:entityTeam, entityType, ingestedAt }));
        const prop = normalizedProp({ provider: 'the-odds-api', sport, eventId: event.id, playerId, playerName, team:entityTeam, entityType, marketKey, marketName: labelMarket(marketKey), period: 'game', isAlternate: marketKey.includes('_alternate'), ingestedAt });
        props.set(prop.id, prop);
        const price = numberOrNull(outcome?.price);
        const normalizedLine = normalizedBookmakerLine({
          provider: 'the-odds-api', propId: prop.id, bookmakerKey, bookmakerName, side, line: lineValue, price,
          impliedProbability: impliedProbability(price), deeplink: outcome?.link || bookmaker?.link || null,
          providerUpdatedAt: market?.last_update || bookmaker?.last_update || null, ingestedAt,
        });
        lines.push(normalizedLine);
        compatibility.push({
          id: normalizedLine.id,
          source: 'The Odds API', provider: 'the-odds-api', sport,
          eventId: event.id, providerEventId: event.providerEventId,
          playerId, playerName, team:entityTeam, entityType, statId: marketKey, marketId: marketKey, market: prop.marketName, period: 'game',
          side, line: lineValue, price: price ?? '', impliedProbability: normalizedLine.impliedProbability,
          sportsbook: bookmakerName, sportsbookKey: bookmakerKey, fairOdds: '', fairLine: null, consensusLine: null,
          gameStartTime: event.commenceTime, homeTeam: event.homeTeam, awayTeam: event.awayTeam,
          homeScore: event.homeScore, awayScore: event.awayScore,
          live: event.status === 'LIVE', started: event.status !== 'SCHEDULED', completed: event.status === 'FINAL',
          isAlternate: prop.isAlternate, providerUpdatedAt: normalizedLine.providerUpdatedAt, updatedAt: normalizedLine.providerUpdatedAt,
          ingestedAt, deeplink: normalizedLine.deeplink || '',
        });
      }
    }
  }

  const lineGroups = new Map();
  for (const row of compatibility) {
    const key = [row.eventId, row.marketId, row.playerId].join('|');
    if (!lineGroups.has(key)) lineGroups.set(key, []);
    lineGroups.get(key).push(row.line);
  }
  for (const row of compatibility) {
    const key = [row.eventId, row.marketId, row.playerId].join('|');
    row.consensusLine = median(lineGroups.get(key) || []);
    row.fairLine = row.consensusLine; // backwards-compatible UI alias; not a model probability.
  }

  return { players: [...players.values()], props: [...props.values()], lines, compatibility, promotions };
}

function dedupeLines(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.propId,row.bookmakerKey,row.side,row.line,row.price].join('|');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function dedupeCompatibility(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.eventId,row.marketId,row.playerId,row.side,row.line,row.sportsbookKey,row.price].join('|');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      output[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return output;
}

export async function fetchBoard(sport, { signal, force = false, includeAlternates = false } = {}) {
  const selected = text(sport).toUpperCase();
  const sportKey = SPORT_KEYS[selected];
  if (!SUPPORTED_SPORTS.includes(selected) || !sportKey) throw Object.assign(new Error(`Unsupported sport: ${selected}`), { code: 'UNSUPPORTED_SPORT' });
  if (!apiKey()) throw Object.assign(new Error('The Odds API is not configured.'), { code: 'NOT_CONFIGURED' });

  const scope = oddsScope();
  const signature = coverageSignature(scope);
  if (!force && !includeAlternates) {
    const cached = await readCachedBoard(selected);
    if (cached?.meta?.coverageSignature === signature) return cached;
  }

  markSportSync(selected, true);
  const startedAt = Date.now();
  try {
    const rawEvents = await apiGet(`/sports/${sportKey}/events`, { dateFormat: 'iso' }, { signal, sport: selected });
    if (!Array.isArray(rawEvents)) throw Object.assign(new Error('Invalid event list.'), { code: 'INVALID_EVENTS' });
    const listedEvents = [...new Map(rawEvents.filter(event => text(event?.id)).map(event => [text(event.id), event])).values()]
      .sort((a, b) => (Date.parse(a?.commence_time || '') || Infinity) - (Date.parse(b?.commence_time || '') || Infinity));
    const sourceEvents = listedEvents.slice(0, maxEvents());
    const ingestedAt = new Date().toISOString();
    const events = sourceEvents.map(event => normalizeOddsEvent(event, selected, ingestedAt));
    const budget = refreshBudget(maxRefreshCredits());
    const catalogResults = await mapLimit(sourceEvents, 4, async rawEvent => {
      try {
        signal?.throwIfAborted();
        const catalog = await discoverMarkets(sportKey, text(rawEvent.id), scope, { signal, sport: selected, budget, includeAlternates });
        return { catalog, error: null };
      } catch (error) {
        return { catalog: [], error: String(error?.code || 'REQUEST_FAILED') };
      }
    });
    const plans = allocateMarkets(catalogResults.map(result => result.catalog), {
      credits: budget.available(), billedRegions: scope.billedRegions, maxPerEvent: maxMarkets(),
    });
    const results = await mapLimit(sourceEvents, 4, async (rawEvent, index) => {
      const eventId = text(rawEvent.id);
      const markets = plans[index];
      const empty = { players: [], props: [], lines: [], compatibility: [], marketKeys: [], error: null };
      if (!markets.length) return empty;
      markEventSync(eventId, true);
      try {
        signal?.throwIfAborted();
        const odds = await budget.run(markets.length * scope.billedRegions, () => apiGet(`/sports/${sportKey}/events/${eventId}/odds`, {
          ...scope.params, markets: markets.join(','), oddsFormat: 'american', dateFormat: 'iso',
          includeLinks: 'true', includeMultipliers: 'true',
        }, { signal, sport: selected, event: eventId }));
        if (text(odds?.id) !== eventId || !Array.isArray(odds?.bookmakers)) throw Object.assign(new Error('Invalid event odds.'), { code: 'INVALID_ODDS' });
        const normalized = normalizeEventOdds(odds, events[index], selected, ingestedAt, { includeAlternates, requestedMarkets: new Set(markets), requestedBooks: scope.bookmakers.length ? new Set(scope.bookmakers) : null });
        return { ...normalized, marketKeys: markets, error: null };
      } catch (error) {
        // One missing game must not discard successful PrizePicks/Underdog
        // responses from the rest of the slate. Coverage stays explicitly partial.
        return { ...empty, error: String(error?.code || 'REQUEST_FAILED') };
      } finally {
        markEventSync(eventId, false);
      }
    });

    const playerMap = new Map();
    const propMap = new Map();
    for (const result of results) {
      for (const row of result?.players || []) playerMap.set(row.id, row);
      for (const row of result?.props || []) propMap.set(row.id, row);
    }
    const lines = dedupeLines(results.flatMap((result) => result?.lines || []));
    const compatibility = dedupeCompatibility(results.flatMap((result) => result?.compatibility || []));
    const marketKeys = [...new Set(results.flatMap((result) => result?.marketKeys || []))].sort();
    const sportsbookKeys = [...new Set(lines.map((row) => row.bookmakerKey).filter(Boolean))].sort();
    const data = { events, players: [...playerMap.values()], props: [...propMap.values()], lines };
    const problems = validateNormalizedBoard(data);
    if (problems.length) throw Object.assign(new Error(`Normalized board validation failed: ${problems.join('; ')}`), { code: 'NORMALIZATION_ERROR' });

    const coverage = summarizeCoverage({ availableEvents: listedEvents.length, catalogResults, results, lines, scope, fetchedAt: ingestedAt });
    // Keep a last-good board rather than replacing it with a transient empty
    // failure. An actually empty, fully checked catalog remains a valid result.
    if (!lines.length && !coverage.complete && !includeAlternates) {
      const lastGood = await readCachedBoard(selected, { allowStale: true });
      if (lastGood?.props?.length) return { ...lastGood, meta: { ...lastGood.meta, stale: true, warning: 'Board refresh was incomplete; showing the last successful board. ' + (coverageWarning(coverage) || '') } };
    }
    const ttlSeconds = policyTtl(events);
    const diagnostic = snapshotDiagnostics();
    const board = {
      props: compatibility,
      promotions: activeTacos(results.flatMap(result => result?.promotions || [])),
      data,
      meta: {
        schemaVersion: 1,
        provider: 'The Odds API', preferredProvider: 'The Odds API', sport: selected,
        fetchedAt: ingestedAt, ingestionTimestamp: ingestedAt, latencyMs: Date.now() - startedAt,
        events: events.length, propCount: propMap.size, lineCount: lines.length,
        sportsbooks: sportsbookKeys, sportsbookCount: sportsbookKeys.length,
        marketKeys, regularLinesOnly: !includeAlternates, includesAlternates: includeAlternates,
        cacheHit: false, stale: false, cacheSeconds: ttlSeconds,
        maxEvents: maxEvents(), maxMarketsPerEvent: maxMarkets(),
        requestedRegions: scope.regions, requestedBookmakers: scope.bookmakers,
        projectedCredits: projectedCreditsPerRefresh(),
        quota: { ...diagnostic.quota, monthlyCredits: monthlyCredits() },
        consensusMethod: 'median of returned bookmaker lines; not a predictive or fair-value model',
        coverageSignature: signature, coverage,
        warning: coverageWarning(coverage),
      },
    };
    recordSportIngestion(selected, board, { ttlSeconds });
    if (!includeAlternates) await writeCachedBoard(selected, board, ttlSeconds);
    return board;
  } catch (error) {
    recordSportFailure(selected, error);
    const stale = !includeAlternates ? await readCachedBoard(selected, { allowStale: true }) : null;
    if (stale?.props?.length) {
      return { ...stale, meta: { ...(stale.meta || {}), stale: true, warning: `Provider refresh failed; serving last successful cached ${selected} board.` } };
    }
    throw error;
  } finally {
    markSportSync(selected, false);
  }
}

export const theOddsApiProvider = Object.freeze({
  id: 'the-odds-api',
  name: 'The Odds API',
  kind: 'odds',
  capabilities: ['events','player-props','bookmaker-lines','american-odds','timestamps','main-lines','alternate-lines'],
  supportedSports: Object.freeze([...SUPPORTED_SPORTS]),
  isConfigured: () => Boolean(apiKey()),
  fetchBoard,
  health: () => ({
    id: 'the-odds-api', configured: Boolean(apiKey()), supportedSports: [...SUPPORTED_SPORTS],
    bookmakers: configuredBookmakers(), regions: configuredRegions(),
    projectedCredits: projectedCreditsPerRefresh(),
    maxEvents: maxEvents(), maxMarketsPerEvent: maxMarkets(),
    monthlyCredits: monthlyCredits(), diagnostics: snapshotDiagnostics(),
  }),
});

export function normalizeOddsFixture(event, sport = 'NBA') {
  const ingestedAt = '2099-01-01T00:00:00.000Z';
  const normalizedEventRow = normalizeOddsEvent(event, sport, ingestedAt);
  return normalizeEventOdds(event, normalizedEventRow, sport, ingestedAt);
}

export const fetchGameBoard = createGameBoard({
  request: (path, params, options) => refreshBudget(maxRefreshCredits()).run(3 * oddsScope().billedRegions, () => apiGet(path, params, options)),
  scope: oddsScope, sportKey: sport => SPORT_KEYS[sport],
  remaining: () => numberOrNull(snapshotDiagnostics()?.quota?.remaining),
});
export async function fetchTacoBoard(sport) {
  const board = await readCachedBoard(sport, {allowStale:true});
  const offers = activeTacos(board?.promotions || []);
  return {ok:true,available:offers.length>0,sport,offers,code:offers.length?'VERIFIED_TACOS':'TACO_FEED_UNAVAILABLE',
    message:offers.length?'Verified Taco promotion metadata. Confirm availability in PrizePicks.':'Verified Taco promotion data is not supplied by the current feed. Regular PrizePicks props remain on Player props.',
    checkedAt:board?.meta?.fetchedAt||null};
}
