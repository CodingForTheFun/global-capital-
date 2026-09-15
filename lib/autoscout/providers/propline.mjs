// PropLine as an additive odds provider for Oblige Props.
//
// PropLine is never allowed to turn a browser page load into upstream request
// fan-out. The provider owns a board cache, supports a truly read-only
// cacheOnly mode, and always supplies an explicit markets= filter as required by
// PropLine's integration guidance. Production decides separately whether this
// provider is primary or merely a supplemental source.
import {
  __resetProplineClient,
  proplineConfigured,
  proplineGet,
  proplineHealth,
  proplineQuota,
} from '../../data-sources/propline/client.mjs';
import { defaultPlayerPropMarkets, proplineSportKey } from '../../data-sources/propline/markets.mjs';
import { mergeNormalized, normalizeEventOdds } from '../../data-sources/propline/normalize.mjs';
import { SUPPORTED_SPORTS } from '../models.mjs';

const text = (value) => String(value ?? '').trim();
const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());

const maxEvents = () => clampInt(process.env.PROPLINE_MAX_EVENTS_PER_REFRESH, 8, 1, 40);
const oddsTtl = () => clampInt(process.env.PROPLINE_ODDS_TTL_SECONDS, 45, 10, 600);
const eventsTtl = () => clampInt(process.env.PROPLINE_EVENTS_TTL_SECONDS, 300, 30, 3600);
const boardTtl = () => clampInt(process.env.PROPLINE_BOARD_TTL_SECONDS, 60, 15, 900);

function csv(value) {
  return [...new Set(text(value).split(',').map((row) => text(row).toLowerCase()).filter(Boolean))];
}

export function proplineMarketsForSport(sport) {
  const selected = text(sport).toUpperCase();
  const specific = process.env[`PROPLINE_MARKETS_${selected}`];
  const configured = csv(specific || process.env.PROPLINE_MARKETS);
  return configured.length ? configured : defaultPlayerPropMarkets(selected);
}

function configuredBooks() {
  return csv(process.env.PROPLINE_BOOKMAKERS);
}

export const PROPLINE_SPORTS = Object.freeze(SUPPORTED_SPORTS.filter((sport) => Boolean(proplineSportKey(sport))));

const boardCache = new Map();
const boardInflight = new Map();

function emptyBoard(sport, meta = {}) {
  const now = new Date().toISOString();
  return {
    props: [],
    data: { events: [], players: [], props: [], lines: [] },
    meta: {
      schemaVersion: 1,
      provider: 'PropLine',
      preferredProvider: 'PropLine',
      sport: text(sport).toUpperCase(),
      fetchedAt: now,
      ingestionTimestamp: now,
      cacheHit: false,
      stale: false,
      events: 0,
      propCount: 0,
      lineCount: 0,
      sportsbooks: [],
      sportsbookCount: 0,
      regularLinesOnly: true,
      includesAlternates: false,
      ...meta,
    },
  };
}

function boardKey(sport, { includeAlternates, markets, books, eventLimit }) {
  return [text(sport).toUpperCase(), includeAlternates ? 'alts' : 'regular', markets.join(','), books.join(','), eventLimit].join('|');
}

function copyCached(entry) {
  if (!entry?.value) return null;
  return {
    ...entry.value,
    meta: {
      ...(entry.value.meta || {}),
      cacheHit: true,
      stale: entry.expiresAt <= Date.now(),
    },
  };
}

function flattenBoard(data, ingestedAt) {
  const eventById = new Map((data.events || []).map((row) => [row.id, row]));
  const playerById = new Map((data.players || []).map((row) => [row.id, row]));
  const propById = new Map((data.props || []).map((row) => [row.id, row]));
  const output = [];

  for (const line of data.lines || []) {
    const prop = propById.get(line.propId);
    const event = eventById.get(prop?.eventId);
    const player = playerById.get(prop?.playerId);
    if (!prop || !event || !player) continue;
    output.push({
      id: line.id,
      source: 'PropLine',
      provider: 'propline',
      sport: prop.sport,
      eventId: event.id,
      providerEventId: event.providerEventId,
      playerId: player.id,
      providerPlayerId: player.providerPlayerId || '',
      playerName: player.name,
      team: player.team || '',
      position: player.position || '',
      entityType: player.entityType || 'player',
      statId: prop.marketKey,
      marketId: prop.marketKey,
      market: prop.marketName,
      period: prop.period || 'game',
      side: line.side,
      line: line.line,
      price: line.price ?? '',
      impliedProbability: line.impliedProbability,
      sportsbook: line.bookmakerName,
      sportsbookKey: line.bookmakerKey,
      fairOdds: '',
      fairLine: null,
      consensusLine: null,
      gameStartTime: event.commenceTime,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      homeScore: event.homeScore,
      awayScore: event.awayScore,
      live: event.status === 'LIVE',
      started: event.status === 'LIVE' || event.status === 'FINAL',
      completed: event.status === 'FINAL',
      isAlternate: prop.isAlternate === true,
      specialType: line.specialType || null,
      providerOutcomeId: line.providerOutcomeId || null,
      providerUpdatedAt: line.providerUpdatedAt,
      updatedAt: line.providerUpdatedAt,
      ingestedAt: line.ingestedAt || ingestedAt,
      deeplink: line.deeplink || '',
    });
  }
  return output;
}

function filterAlternates(data, includeAlternates) {
  if (includeAlternates) return data;
  const props = (data.props || []).filter((row) => row.isAlternate !== true);
  const ids = new Set(props.map((row) => row.id));
  const lines = (data.lines || []).filter((row) => ids.has(row.propId));
  return { ...data, props, lines };
}

export async function probePropLine(options = {}) {
  if (!proplineConfigured()) throw Object.assign(new Error('PropLine API key is not configured.'), { code: 'PROPLINE_NOT_CONFIGURED' });
  const payload = await proplineGet('/v1/sports', {}, {
    ttlSeconds: 3600,
    signal: options.signal || null,
  });
  return { payload, quota: proplineQuota() };
}

export async function fetchEvents(sport, options = {}) {
  const key = proplineSportKey(sport);
  if (!key) return [];
  const payload = await proplineGet(`/v1/sports/${key}/events`, {}, {
    ttlSeconds: eventsTtl(),
    signal: options.signal || null,
    bypassCache: options.bypassCache === true,
  });
  return Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
}

/**
 * Build a normalized board for one sport.
 *
 * `cacheOnly` is a hard zero-network contract. It is what customer page loads
 * use in public-first production. A separate single-owner scheduler is allowed
 * to refresh this cache on a quota-aware cadence.
 */
export async function fetchBoard(sport, options = {}) {
  const selected = text(sport).toUpperCase();
  const sportKey = proplineSportKey(selected);
  const includeAlternates = options.includeAlternates === true;
  const markets = proplineMarketsForSport(selected);
  const books = configuredBooks();
  const eventLimit = clampInt(options.eventLimit, maxEvents(), 1, 40);

  if (!sportKey) return emptyBoard(selected, { supported: false });
  if (!markets.length) {
    return emptyBoard(selected, {
      supported: true,
      warning: 'No comparable PropLine player markets are configured for this sport.',
      marketKeys: [],
    });
  }

  const key = boardKey(selected, { includeAlternates, markets, books, eventLimit });
  const cachedEntry = boardCache.get(key);
  const cached = copyCached(cachedEntry);

  if (options.cacheOnly === true) {
    return cached || emptyBoard(selected, {
      supported: true,
      cacheHit: true,
      stale: true,
      warning: 'PropLine cache has not been warmed yet.',
      marketKeys: markets,
    });
  }
  if (!proplineConfigured()) throw Object.assign(new Error('PropLine API key is not configured.'), { code: 'PROPLINE_NOT_CONFIGURED' });
  if (cached && !cached.meta.stale && options.force !== true) return cached;
  if (boardInflight.has(key)) return boardInflight.get(key);

  const task = (async () => {
    const startedAt = Date.now();
    try {
      const events = await fetchEvents(selected, { signal: options.signal || null });
      const ordered = events
        .filter((event) => text(event?.id || event?.event_id))
        .sort((a, b) => (Date.parse(a?.commence_time || '') || Infinity) - (Date.parse(b?.commence_time || '') || Infinity))
        .slice(0, eventLimit);

      const parts = [];
      const failures = [];
      for (const event of ordered) {
        const eventId = text(event?.id || event?.event_id);
        try {
          const payload = await proplineGet(`/v1/sports/${sportKey}/events/${eventId}/odds`, {
            // Never omit markets=. PropLine explicitly documents this as the
            // most important request-efficiency rule for odds consumers.
            markets: markets.join(','),
            bookmakers: books.length ? books.join(',') : undefined,
            includeLinks: 'true',
            includeBookIds: 'true',
          }, {
            ttlSeconds: oddsTtl(),
            signal: options.signal || null,
          });
          parts.push(normalizeEventOdds({ sport_key: sportKey, ...event, ...payload }, { sport: selected }));
        } catch (error) {
          const code = text(error?.code) || 'PROPLINE_EVENT_FAILED';
          failures.push({ eventId, code });
          // A rate-limit response applies to the caller, not merely this event.
          // Stop immediately instead of turning one throttle into N more calls.
          if (['PROPLINE_DAILY_LIMIT','PROPLINE_BURST_LIMIT','PROPLINE_RATE_LIMITED'].includes(code)) break;
        }
      }

      const merged = mergeNormalized(parts);
      const data = filterAlternates({
        events: merged.events,
        players: merged.players,
        props: merged.props,
        lines: merged.lines,
      }, includeAlternates);
      const ingestedAt = new Date().toISOString();
      const props = flattenBoard(data, ingestedAt);
      const sportsbooks = [...new Set(props.map((row) => row.sportsbookKey).filter(Boolean))].sort();
      const board = {
        props,
        data,
        meta: {
          schemaVersion: 1,
          provider: 'PropLine',
          preferredProvider: 'PropLine',
          sport: selected,
          supported: true,
          fetchedAt: ingestedAt,
          ingestionTimestamp: ingestedAt,
          latencyMs: Date.now() - startedAt,
          eventsAvailable: events.length,
          eventsRequested: ordered.length,
          events: data.events.length,
          eventsNormalized: parts.length,
          propCount: data.props.length,
          lineCount: data.lines.length,
          sportsbooks,
          sportsbookCount: sportsbooks.length,
          marketKeys: markets,
          requestedBookmakers: books,
          regularLinesOnly: !includeAlternates,
          includesAlternates: includeAlternates,
          cacheHit: false,
          stale: false,
          cacheSeconds: boardTtl(),
          failures,
          skipped: merged.skipped,
          quota: proplineQuota(),
        },
      };
      boardCache.set(key, { value: board, expiresAt: Date.now() + boardTtl() * 1000 });
      while (boardCache.size > 100) boardCache.delete(boardCache.keys().next().value);
      return board;
    } catch (error) {
      if (cachedEntry?.value) {
        return {
          ...cachedEntry.value,
          meta: {
            ...(cachedEntry.value.meta || {}),
            cacheHit: true,
            stale: true,
            warning: 'PropLine refresh failed; serving the last successful supplemental board.',
            refreshError: text(error?.code || error?.name || 'PROPLINE_REFRESH_FAILED'),
          },
        };
      }
      throw error;
    }
  })().finally(() => boardInflight.delete(key));

  boardInflight.set(key, task);
  return task;
}

export function __resetProplineProvider() {
  boardCache.clear();
  boardInflight.clear();
  __resetProplineClient();
}

export const proplineProvider = Object.freeze({
  id: 'propline',
  name: 'PropLine',
  kind: 'odds',
  capabilities: Object.freeze([
    'events', 'player-props', 'bookmaker-lines', 'american-odds', 'timestamps',
    'main-lines', 'alternate-lines', 'stable-player-ids', 'line-history',
    'opening-closing-lines', 'prop-resolution', 'no-vig-fair-lines', 'steam-detection',
  ]),
  supportedSports: PROPLINE_SPORTS,
  isConfigured: () => proplineConfigured(),
  fetchBoard,
  health: () => ({
    ...proplineHealth(),
    supportedSports: [...PROPLINE_SPORTS],
    maxEventsPerRefresh: maxEvents(),
    oddsTtlSeconds: oddsTtl(),
    eventsTtlSeconds: eventsTtl(),
    boardTtlSeconds: boardTtl(),
    primaryOptIn: truthy(process.env.PROPLINE_PRIMARY),
  }),
});
