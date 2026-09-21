import { sportradarConfigured, sportradarGet, sportradarHealth } from '../../data-sources/sportradar/client.mjs';
import { mergeSportradarBoards, normalizeSportradarPlayerProps } from '../../data-sources/sportradar/normalize.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

export const SPORTRADAR_PROP_SPORTS = Object.freeze(['NFL','NBA','MLB','NHL','NCAAF','SOCCER','MLS','EPL','UCL']);

const DESCRIPTORS = Object.freeze({
  NBA: { sport: [/^basketball$/i], competitions: [/^NBA$/i] },
  NFL: { sport: [/american football/i], competitions: [/^NFL$/i] },
  MLB: { sport: [/^baseball$/i], competitions: [/^MLB$/i] },
  NHL: { sport: [/ice hockey/i], competitions: [/^NHL$/i] },
  NCAAF: { sport: [/american football/i], competitions: [/NCAA/i, /college football/i] },
  MLS: { sport: [/^soccer$/i], competitions: [/major league soccer/i, /^MLS$/i] },
  EPL: { sport: [/^soccer$/i], competitions: [/^Premier League$/i] },
  UCL: { sport: [/^soccer$/i], competitions: [/UEFA Champions League/i, /Champions League/i] },
  SOCCER: { sport: [/^soccer$/i], competitions: [/major league soccer/i, /^Premier League$/i, /UEFA Champions League/i] },
});

const discovery = new Map();
const boardCache = new Map();
const inflight = new Map();

function boardTtlSeconds() {
  return clamp(process.env.SPORTRADAR_PROP_BOARD_TTL_SECONDS, 60, 30, 600);
}

function eventLimit() {
  return clamp(process.env.SPORTRADAR_PROP_EVENTS_PER_REFRESH, 8, 1, 24);
}

function competitionLimit() {
  return clamp(process.env.SPORTRADAR_PROP_COMPETITIONS_PER_SPORT, 3, 1, 6);
}

function emptyBoard(sport, meta = {}) {
  const now = new Date().toISOString();
  return {
    props: [],
    data: { events: [], players: [], props: [], lines: [] },
    meta: {
      schemaVersion: 1,
      provider: 'Sportradar',
      preferredProvider: 'Sportradar',
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

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(text(value)));
}

async function discoverCompetitions(sport, { signal = null } = {}) {
  const selected = text(sport).toUpperCase();
  const descriptor = DESCRIPTORS[selected];
  if (!descriptor) return [];

  const hit = discovery.get(selected);
  if (hit && hit.expiresAt > Date.now()) return hit.competitions;

  const sports = await sportradarGet('/sports.json', {}, {
    ttlSeconds: 3600,
    signal,
  });
  const sportRows = list(sports?.payload?.sports);
  const sportRow = sportRows.find((row) => matchesAny(row?.name, descriptor.sport));
  if (!sportRow?.id) return [];

  const competitionsPayload = await sportradarGet(`/sports/${encodeURIComponent(sportRow.id)}/competitions.json`, {}, {
    ttlSeconds: 3600,
    signal,
  });
  const rows = list(competitionsPayload?.payload?.competitions)
    .filter((row) => row?.player_props !== false)
    .filter((row) => matchesAny(row?.name, descriptor.competitions));

  const unique = [...new Map(rows.map((row) => [text(row?.id), {
    id: text(row?.id),
    name: text(row?.name),
    sportId: text(sportRow.id),
  }]).filter(([id]) => id)).values()].slice(0, competitionLimit());

  discovery.set(selected, {
    competitions: unique,
    expiresAt: Date.now() + 6 * 3600_000,
  });
  return unique;
}

async function fetchCompetition(competition, sport, { signal = null, force = false, limit = eventLimit() } = {}) {
  const parts = [];
  let total = null;
  for (let start = 0; start < limit; start += 1) {
    const response = await sportradarGet(
      `/competitions/${encodeURIComponent(competition.id)}/players_props.json`,
      { start },
      {
        ttlSeconds: boardTtlSeconds(),
        bypassCache: force,
        timeoutMs: 15_000,
        signal,
      },
    );
    if (total === null && Number.isFinite(Number(response?.headers?.maxResults))) {
      total = Number(response.headers.maxResults);
    }
    const normalized = normalizeSportradarPlayerProps(response?.payload, {
      sport,
      fetchedAt: new Date().toISOString(),
    });
    if (normalized.props.length || normalized.data.events.length) parts.push(normalized);
    if (total !== null && start + 1 >= total) break;

    const containers = response?.payload?.competition_sport_events_players_props;
    if (Array.isArray(containers) && containers.length === 0) break;
  }
  return { parts, total };
}

export async function fetchSportradarBoard(sport, options = {}) {
  const selected = text(sport).toUpperCase();
  const descriptor = DESCRIPTORS[selected];
  if (!descriptor) return emptyBoard(selected, { supported: false });
  if (!sportradarConfigured()) {
    throw Object.assign(new Error('Sportradar is not configured.'), { code: 'SPORTRADAR_NOT_CONFIGURED' });
  }

  const cachedEntry = boardCache.get(selected);
  const cached = cachedCopy(cachedEntry);
  if (options.cacheOnly === true) {
    return cached || emptyBoard(selected, {
      supported: true,
      cacheHit: true,
      stale: true,
      warning: 'Sportradar prop cache has not been warmed yet.',
    });
  }
  if (cached && cached.meta.stale !== true && options.force !== true) return cached;
  if (inflight.has(selected)) return inflight.get(selected);

  const task = (async () => {
    const started = Date.now();
    try {
      const competitions = await discoverCompetitions(selected, { signal: options.signal || null });
      if (!competitions.length) {
        const board = emptyBoard(selected, {
          supported: true,
          warning: 'No Sportradar player-props competition is available for this sport entitlement.',
          competitions: [],
        });
        boardCache.set(selected, { value: board, expiresAt: Date.now() + boardTtlSeconds() * 1000 });
        return board;
      }

      const maxEvents = clamp(options.eventLimit, eventLimit(), 1, 24);
      const allParts = [];
      const coverage = [];
      let remaining = maxEvents;
      for (const competition of competitions) {
        if (remaining <= 0) break;
        const result = await fetchCompetition(competition, selected, {
          signal: options.signal || null,
          force: options.force === true,
          limit: remaining,
        });
        allParts.push(...result.parts);
        const eventCount = result.parts.reduce((sum, part) => sum + Number(part?.data?.events?.length || 0), 0);
        remaining -= eventCount;
        coverage.push({
          competitionId: competition.id,
          competition: competition.name,
          availableEvents: result.total,
          normalizedEvents: eventCount,
        });
      }

      const merged = mergeSportradarBoards(allParts);
      const books = [...new Set(merged.props.map((row) => text(row?.sportsbookKey).toLowerCase()).filter(Boolean))].sort();
      const fetchedAt = new Date().toISOString();
      const board = {
        props: merged.props,
        data: merged.data,
        meta: {
          schemaVersion: 1,
          provider: 'Sportradar',
          preferredProvider: 'Sportradar',
          sport: selected,
          supported: true,
          fetchedAt,
          ingestionTimestamp: fetchedAt,
          latencyMs: Date.now() - started,
          events: merged.data.events.length,
          propCount: merged.data.props.length,
          lineCount: merged.data.lines.length,
          sportsbooks: books,
          sportsbookCount: books.length,
          regularLinesOnly: true,
          includesAlternates: false,
          cacheHit: false,
          stale: false,
          cacheSeconds: boardTtlSeconds(),
          competitions: coverage,
          skipped: merged.skipped,
          health: sportradarHealth(),
        },
      };
      boardCache.set(selected, { value: board, expiresAt: Date.now() + boardTtlSeconds() * 1000 });
      return board;
    } catch (error) {
      if (cachedEntry?.value) {
        return {
          ...cachedEntry.value,
          meta: {
            ...(cachedEntry.value.meta || {}),
            cacheHit: true,
            stale: true,
            warning: 'Sportradar refresh failed; retaining the last successful prop board.',
            refreshError: text(error?.code || error?.name || 'SPORTRADAR_REFRESH_FAILED'),
          },
        };
      }
      throw error;
    }
  })().finally(() => inflight.delete(selected));

  inflight.set(selected, task);
  return task;
}

export const sportradarProvider = Object.freeze({
  id: 'sportradar',
  name: 'Sportradar',
  kind: 'odds',
  capabilities: Object.freeze([
    'events',
    'player-props',
    'bookmaker-lines',
    'american-odds',
    'stable-player-ids',
    'opening-lines',
  ]),
  supportedSports: SPORTRADAR_PROP_SPORTS,
  isConfigured: () => sportradarConfigured(),
  fetchBoard: fetchSportradarBoard,
  health: () => ({
    ...sportradarHealth(),
    supportedSports: [...SPORTRADAR_PROP_SPORTS],
    boardTtlSeconds: boardTtlSeconds(),
    eventsPerRefresh: eventLimit(),
  }),
});

export function __resetSportradarProvider() {
  discovery.clear();
  boardCache.clear();
  inflight.clear();
}
