import {
  fetchSportsGameOddsUsage,
  sportsGameOddsConfigured,
  sportsGameOddsGet,
  sportsGameOddsHealth,
} from '../../data-sources/sportsgameodds/client.mjs';
import { normalizeSportsGameOddsEvents } from '../../data-sources/sportsgameodds/normalize.mjs';

const text = (value) => String(value ?? '').trim();
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());
const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

export const SPORTSGAMEODDS_LEAGUES = Object.freeze({
  NFL: Object.freeze(['NFL']),
  NBA: Object.freeze(['NBA']),
  WNBA: Object.freeze(['WNBA']),
  MLB: Object.freeze(['MLB']),
  NHL: Object.freeze(['NHL']),
  NCAAF: Object.freeze(['NCAAF']),
  NCAAB: Object.freeze(['NCAAB']),
  MLS: Object.freeze(['MLS']),
  EPL: Object.freeze(['EPL']),
  UCL: Object.freeze(['UEFA_CHAMPIONS_LEAGUE']),
  SOCCER: Object.freeze(['MLS', 'EPL', 'UEFA_CHAMPIONS_LEAGUE', 'INTERNATIONAL_SOCCER']),
  TENNIS: Object.freeze(['ATP', 'WTA']),
  MMA: Object.freeze(['UFC']),
  PGA: Object.freeze(['PGA_MEN', 'LIV_TOUR']),
  CFL: Object.freeze(['CFL']),
});

export const SPORTSGAMEODDS_SPORTS = Object.freeze(Object.keys(SPORTSGAMEODDS_LEAGUES));

const boardCache = new Map();
const inflight = new Map();

function cacheTtlSeconds() {
  return clamp(process.env.SPORTSGAMEODDS_BOARD_TTL_SECONDS, 240, 120, 1800);
}

function horizonHours() {
  return clamp(process.env.SPORTSGAMEODDS_EVENT_HORIZON_HOURS, 72, 12, 168);
}

function graceHours() {
  return clamp(process.env.SPORTSGAMEODDS_EVENT_GRACE_HOURS, 4, 0, 24);
}

function keyFor(sport, includeAlternates, eventLimit) {
  return [sport, includeAlternates ? 'alts' : 'main', eventLimit].join('|');
}

function cachedCopy(entry) {
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

function emptyBoard(sport, meta = {}) {
  const now = new Date().toISOString();
  return {
    props: [],
    data: { events: [], players: [], props: [], lines: [] },
    meta: {
      schemaVersion: 1,
      provider: 'SportsGameOdds',
      preferredProvider: 'PropLine',
      sport,
      fetchedAt: now,
      ingestionTimestamp: now,
      events: 0,
      propCount: 0,
      lineCount: 0,
      sportsbooks: [],
      sportsbookCount: 0,
      regularLinesOnly: true,
      includesAlternates: false,
      cacheHit: false,
      stale: false,
      ...meta,
    },
  };
}

export async function fetchSportsGameOddsBoard(sport, options = {}) {
  const selected = text(sport).toUpperCase();
  const leagues = SPORTSGAMEODDS_LEAGUES[selected] || [];
  const includeAlternates = options.includeAlternates === true || truthy(process.env.SPORTSGAMEODDS_INCLUDE_ALTS);
  const eventLimit = clamp(options.eventLimit, 8, 1, 30);
  if (!leagues.length) return emptyBoard(selected, { supported: false });
  if (!sportsGameOddsConfigured()) {
    throw Object.assign(new Error('SportsGameOdds is not configured.'), { code: 'SPORTSGAMEODDS_NOT_CONFIGURED' });
  }

  const cacheKey = keyFor(selected, includeAlternates, eventLimit);
  const cachedEntry = boardCache.get(cacheKey);
  const cached = cachedCopy(cachedEntry);
  if (options.cacheOnly === true) {
    return cached || emptyBoard(selected, {
      supported: true,
      cacheHit: true,
      stale: true,
      warning: 'SportsGameOdds supplemental cache has not been warmed yet.',
    });
  }
  if (cached && cached.meta.stale !== true && options.force !== true) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const task = (async () => {
    const started = Date.now();
    try {
      // /account/usage is cached for 15 minutes by the client. It is the
      // authoritative source for limits attached to this exact paid key.
      const usage = await fetchSportsGameOddsUsage().catch(() => null);
      const now = Date.now();
      const payload = await sportsGameOddsGet('/events', {
        leagueID: leagues.join(','),
        oddsAvailable: 'true',
        ended: 'false',
        cancelled: 'false',
        startsAfter: new Date(now - graceHours() * 3_600_000).toISOString(),
        startsBefore: new Date(now + horizonHours() * 3_600_000).toISOString(),
        includeAltLines: includeAlternates ? 'true' : undefined,
        includeOpenCloseOdds: 'false',
        limit: eventLimit,
      }, {
        ttlSeconds: cacheTtlSeconds(),
        bypassCache: options.force === true,
        timeoutMs: 15_000,
        signal: options.signal || null,
      });

      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const board = normalizeSportsGameOddsEvents(rows, {
        requestedSport: selected,
        includeAlternates,
      });
      board.meta = {
        ...board.meta,
        supported: true,
        fetchedAt: new Date().toISOString(),
        ingestionTimestamp: new Date().toISOString(),
        latencyMs: Date.now() - started,
        leaguesRequested: leagues,
        eventsReturned: rows.length,
        eventLimit,
        cacheSeconds: cacheTtlSeconds(),
        notice: text(payload?.notice) || null,
        accountTier: usage?.tier || null,
        accountUsage: sportsGameOddsHealth().monthly,
      };
      boardCache.set(cacheKey, { value: board, expiresAt: Date.now() + cacheTtlSeconds() * 1000 });
      while (boardCache.size > 80) boardCache.delete(boardCache.keys().next().value);
      return board;
    } catch (error) {
      if (cachedEntry?.value) {
        return {
          ...cachedEntry.value,
          meta: {
            ...(cachedEntry.value.meta || {}),
            cacheHit: true,
            stale: true,
            warning: 'SportsGameOdds refresh failed; retaining the last supplemental board.',
            refreshError: text(error?.code || error?.name || 'SPORTSGAMEODDS_REFRESH_FAILED'),
          },
        };
      }
      throw error;
    }
  })().finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, task);
  return task;
}

export function sportsGameOddsProviderHealth() {
  return {
    ...sportsGameOddsHealth(),
    supportedSports: [...SPORTSGAMEODDS_SPORTS],
    boardTtlSeconds: cacheTtlSeconds(),
    eventHorizonHours: horizonHours(),
    alternateLines: truthy(process.env.SPORTSGAMEODDS_INCLUDE_ALTS),
    cachedBoards: boardCache.size,
  };
}

export function __resetSportsGameOddsProvider() {
  boardCache.clear();
  inflight.clear();
}
