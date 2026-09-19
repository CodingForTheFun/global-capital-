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
  proplineReserve,
} from '../../data-sources/propline/client.mjs';
import { defaultPlayerPropMarkets, proplineSportKey } from '../../data-sources/propline/markets.mjs';
import { mergeNormalized, normalizeEventOdds } from '../../data-sources/propline/normalize.mjs';
import { boundedCoverageCall, createSlateCoverage } from '../../data-sources/propline/slate-coverage.mjs';
import { SUPPORTED_SPORTS } from '../models.mjs';

const text = (value) => String(value ?? '').trim();
const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());

// A prop only exists in a window around its game. Books post player props a
// day or two out, and pull them once the game starts, so asking outside that
// window spends a request to be told nothing.
//
// The ascending sort made this worse than idle polling: finished games have the
// earliest commence_time, so they sorted to the FRONT and consumed the first
// slots of the event budget while tonight's games fell off the end.
const horizonHours = () => clampInt(process.env.PROPLINE_EVENT_HORIZON_HOURS, 48, 1, 336);
const graceMinutes = () => clampInt(process.env.PROPLINE_EVENT_GRACE_MINUTES, 15, 0, 240);

/**
 * Split an event list into what is worth asking about now, and when the next
 * one becomes worth asking about.
 *
 * Exported for tests, and because the scheduler uses nextEventAt to decide when
 * to come back rather than waking on a fixed timer.
 */
export function selectEventWindow(events, { now = Date.now(), horizon = horizonHours(), grace = graceMinutes(), limit = 24 } = {}) {
  const from = now - grace * 60_000;
  const until = now + horizon * 3_600_000;
  const dated = (Array.isArray(events) ? events : [])
    .filter((event) => String(event?.id ?? event?.event_id ?? '').trim())
    .map((event) => ({ event, at: Date.parse(event?.commence_time || '') }));

  // An event with no parseable start time is kept: dropping it would silently
  // lose a game over a formatting change upstream.
  const undated = dated.filter((row) => !Number.isFinite(row.at));
  const timed = dated.filter((row) => Number.isFinite(row.at));

  const inWindow = timed.filter((row) => row.at >= from && row.at <= until).sort((a, b) => a.at - b.at);
  const future = timed.filter((row) => row.at > until).sort((a, b) => a.at - b.at);

  return {
    events: [...inWindow, ...undated].slice(0, limit).map((row) => row.event),
    available: dated.length,
    inWindow: inWindow.length + undated.length,
    started: timed.filter((row) => row.at < from).length,
    // When the soonest out-of-range game enters the window. Null when there is
    // nothing ahead at all, which is what an off-season looks like.
    nextEventAt: future.length ? new Date(future[0].at).toISOString() : null,
  };
}

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
const slateCoverage = createSlateCoverage();

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
      stale: entry.value.meta?.stale === true || entry.expiresAt <= Date.now(),
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
    bypassCache: options.bypassCache === true,
  });
  return { payload, quota: proplineQuota() };
}

function assertCoverageReadable() {
  const quota = proplineQuota();
  const reserve = Math.max(proplineReserve(), Math.ceil(Number(quota.limit || 0) * 0.10));
  const exhausted = quota.remaining != null && Number(quota.remaining) <= reserve;
  const code = exhausted ? 'PROPLINE_QUOTA_RESERVE' : proplineHealth().lastError?.code;
  if (['PROPLINE_DAILY_LIMIT','PROPLINE_QUOTA_RESERVE','PROPLINE_BURST_LIMIT','PROPLINE_RATE_LIMITED','PROPLINE_UNAUTHORIZED'].includes(code)) {
    throw Object.assign(new Error('PropLine coverage paused.'), { code });
  }
}

export async function fetchEvents(sport, options = {}) {
  const key = proplineSportKey(sport);
  if (!key) return [];
  const payload = await proplineGet(`/v1/sports/${key}/events`, {}, {
    ttlSeconds: eventsTtl(),
    signal: options.signal || null,
    bypassCache: options.bypassCache === true,
  });
  if (options.strict === true) {
    assertCoverageReadable();
    const rows = Array.isArray(payload) ? payload : payload?.events;
    if (!Array.isArray(rows) || rows.some((event) => !event || !text(event.id || event.event_id) || (event.sport_key && event.sport_key !== key))) {
      throw Object.assign(new Error('Invalid event discovery response.'), { code: 'PROPLINE_COVERAGE_INVALID_EVENTS' });
    }
  }
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
  const fullSlate = options.fullSlate === true;

  if (!sportKey) return emptyBoard(selected, { supported: false });
  if (!markets.length) {
    return emptyBoard(selected, {
      supported: true,
      warning: 'No comparable PropLine player markets are configured for this sport.',
      marketKeys: [],
    });
  }

  const key = boardKey(selected, { includeAlternates, markets, books, eventLimit }) + (fullSlate ? '|slate' : '');
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
      const events = fullSlate
        ? await boundedCoverageCall((signal) => fetchEvents(selected, { signal, strict: true }), { signal: options.signal, timeoutMs: 10000 })
        : await fetchEvents(selected, { signal: options.signal || null });
      const window = selectEventWindow(events, { limit: fullSlate ? Number.MAX_SAFE_INTEGER : eventLimit });
      const ordered = window.events;

      // Nothing in the window means no odds call is worth making. Returning here
      // is the whole point: an off-season or a slate days away now costs one
      // event-list request instead of one per event for props that do not exist.
      if (fullSlate && !ordered.length) {
        // An authoritative empty discovery withdraws this scope without odds
        // calls. Malformed/throttled discovery throws before reaching here.
        await slateCoverage.collect({ scope: key, events: [], requestBudget: 0, fetchEvent: async () => null });
        boardCache.delete(key);
      }
      if (!ordered.length) {
        return emptyBoard(selected, {
          ...(fullSlate ? { coverage: { eligible: 0, requested: 0, succeeded: 0, failed: 0, deferred: 0, retained: 0, covered: 0, complete: true, reason: null, oldestFetchedAt: null } } : {}),
          supported: true,
          marketKeys: markets,
          eventsAvailable: window.available,
          eventsInWindow: 0,
          eventsStarted: window.started,
          nextEventAt: window.nextEventAt,
          warning: window.nextEventAt ? 'No PropLine events inside the request window yet.' : 'No upcoming PropLine events for this sport.',
        });
      }

      let parts = [];
      let failures = [];
      let coverage = null;
      const fetchEvent = async (event, signal, strict = false) => {
        const eventId = text(event?.id || event?.event_id);
        const payload = await proplineGet(`/v1/sports/${sportKey}/events/${eventId}/odds`, {
          // Never omit markets=. Combine all configured markets and books in
          // one event request, preserving source-native O/U and period semantics.
          markets: markets.join(','),
          bookmakers: books.length ? books.join(',') : undefined,
          includeLinks: 'true',
          includeBookIds: 'true',
        }, { ttlSeconds: oddsTtl(), signal: signal || null });
        if (strict) {
          // The shared client can serve stale data during throttling. Do not
          // promote that fallback into a freshly collected per-event snapshot.
          assertCoverageReadable();
          if (!payload || !Array.isArray(payload.bookmakers)) throw Object.assign(new Error('Invalid event odds response.'), { code: 'PROPLINE_COVERAGE_INVALID_RESPONSE' });
          if (payload.sport_key && payload.sport_key !== sportKey) throw Object.assign(new Error('Sport identity mismatch.'), { code: 'PROPLINE_COVERAGE_SPORT_MISMATCH' });
          const returnedId = text(payload.id || payload.event_id);
          if (returnedId && returnedId !== eventId && !(Array.isArray(payload.merged_from_event_ids) ? payload.merged_from_event_ids : []).map(String).includes(eventId)) throw Object.assign(new Error('Event identity mismatch.'), { code: 'PROPLINE_COVERAGE_EVENT_MISMATCH' });
        }
        return normalizeEventOdds({ sport_key: sportKey, ...event, ...payload }, { sport: selected });
      };
      if (fullSlate) {
        const result = await slateCoverage.collect({
          scope: key, events: ordered,
          // Discovery may spend one request. Reserve it even on a cache hit.
          requestBudget: Math.max(0, clampInt(options.requestBudget, 48, 0, 129) - 1),
          maxAgeSeconds: options.coverageMaxAgeSeconds || 1200,
          signal: options.signal || null,
          fetchEvent: (event, signal) => fetchEvent(event, signal, true),
        });
        parts = result.parts; failures = result.failures; coverage = result.coverage;
      } else {
        for (const event of ordered) {
          const eventId = text(event?.id || event?.event_id);
          try { parts.push(await fetchEvent(event, options.signal)); }
          catch (error) {
            const code = text(error?.code) || 'PROPLINE_EVENT_FAILED';
            failures.push({ eventId, code });
            if (['PROPLINE_DAILY_LIMIT','PROPLINE_BURST_LIMIT','PROPLINE_RATE_LIMITED'].includes(code)) break;
          }
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
      const fetchedAt = coverage?.oldestFetchedAt || ingestedAt;
      const props = flattenBoard(data, fetchedAt);
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
          fetchedAt,
          ingestionTimestamp: fetchedAt,
          latencyMs: Date.now() - startedAt,
          eventsAvailable: window.available,
          eventsInWindow: window.inWindow,
          eventsStarted: window.started,
          nextEventAt: window.nextEventAt,
          eventsRequested: coverage ? coverage.requested : ordered.length,
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
          stale: Boolean(coverage?.retained),
          cacheSeconds: boardTtl(),
          failures,
          skipped: merged.skipped,
          quota: proplineQuota(),
          ...(coverage ? { coverage } : {}),
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
            ...(fullSlate ? { coverage: { ...(cachedEntry.value.meta?.coverage || {}), complete: false, reason: 'discovery_failed' } } : {}),
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
  slateCoverage.reset();
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
