// PropLine as an odds provider.
//
// It is registered alongside The Odds API rather than in place of anything.
// Without PROPLINE_API_KEY it reports unconfigured and makes no requests, so
// merging this changes nothing until a key exists.
//
// The request budget is the design constraint. PropLine charges one request per
// call against a daily allowance, and player props are per-event: a full NFL
// Sunday polled every minute would be roughly 23,000 requests for one sport.
// So the board is built from a bounded number of events per refresh, the client
// caches within a TTL, and the event list - which changes far more slowly than
// prices - is cached much longer than the odds.
import { proplineConfigured, proplineGet, proplineHealth } from '../../data-sources/propline/client.mjs';
import { proplineSportKey } from '../../data-sources/propline/markets.mjs';
import { mergeNormalized, normalizeEventOdds } from '../../data-sources/propline/normalize.mjs';
import { SUPPORTED_SPORTS } from '../models.mjs';

const text = (value) => String(value ?? '').trim();
const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

const maxEvents = () => clampInt(process.env.PROPLINE_MAX_EVENTS_PER_REFRESH, 8, 1, 40);
const oddsTtl = () => clampInt(process.env.PROPLINE_ODDS_TTL_SECONDS, 45, 10, 600);
const eventsTtl = () => clampInt(process.env.PROPLINE_EVENTS_TTL_SECONDS, 300, 30, 3600);
const configuredMarkets = () => text(process.env.PROPLINE_MARKETS);
const configuredBooks = () => text(process.env.PROPLINE_BOOKMAKERS);

export const PROPLINE_SPORTS = Object.freeze(SUPPORTED_SPORTS.filter((sport) => Boolean(proplineSportKey(sport))));

export async function fetchEvents(sport, options = {}) {
  const key = proplineSportKey(sport);
  if (!key) return [];
  const payload = await proplineGet(`/v1/sports/${key}/events`, {}, { ttlSeconds: eventsTtl(), ...options });
  return Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
}

/**
 * Build a normalized board for one sport.
 *
 * Events are taken in start order so the games closest to kickoff - the ones a
 * bettor is actually looking at - are the ones inside the request budget.
 */
export async function fetchBoard(sport, options = {}) {
  const sportKey = proplineSportKey(sport);
  if (!sportKey) return { sport, data: { events: [], players: [], props: [], lines: [] }, meta: { provider: 'propline', supported: false } };

  const events = await fetchEvents(sport, options);
  const ordered = events
    .filter((event) => text(event?.id || event?.event_id))
    .sort((a, b) => Date.parse(a?.commence_time || 0) - Date.parse(b?.commence_time || 0))
    .slice(0, maxEvents());

  const parts = [];
  const failures = [];
  for (const event of ordered) {
    const eventId = text(event?.id || event?.event_id);
    try {
      const payload = await proplineGet(`/v1/sports/${sportKey}/events/${eventId}/odds`, {
        markets: configuredMarkets() || undefined,
        bookmakers: configuredBooks() || undefined,
      }, { ttlSeconds: oddsTtl(), ...options });
      parts.push(normalizeEventOdds({ sport_key: sportKey, ...event, ...payload }, { sport }));
    } catch (error) {
      failures.push({ eventId, code: text(error?.code) || 'PROPLINE_EVENT_FAILED' });
      // A spent allowance applies to every remaining event too; stop asking.
      if (error?.code === 'PROPLINE_DAILY_LIMIT') break;
    }
  }

  const data = mergeNormalized(parts);
  return {
    sport,
    data: { events: data.events, players: data.players, props: data.props, lines: data.lines },
    meta: {
      provider: 'propline',
      supported: true,
      eventsAvailable: events.length,
      eventsRequested: ordered.length,
      eventsNormalized: parts.length,
      failures,
      skipped: data.skipped,
    },
  };
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
  }),
});
