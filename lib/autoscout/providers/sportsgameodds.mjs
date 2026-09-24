import {
  fetchSportsGameOddsUsage,
  sportsGameOddsConfigured,
  sportsGameOddsGet,
  sportsGameOddsHealth,
  sportsGameOddsMonthlyUsage,
} from '../../data-sources/sportsgameodds/client.mjs';
import { normalizeSportsGameOddsEvents } from '../../data-sources/sportsgameodds/normalize.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
  PGA: Object.freeze(['PGA_MEN', 'LIV_TOUR']),
  CFL: Object.freeze(['CFL']),
  // Tennis league IDs are account/catalog specific and are resolved dynamically.\n  TENNIS: Object.freeze([]),
});

export const SPORTSGAMEODDS_SPORT_IDS = Object.freeze({
  AUSSIE_RULES: 'AUSSIE_RULES_FOOTBALL',
  BADMINTON: 'BADMINTON',
  BANDY: 'BANDY',
  BASEBALL: 'BASEBALL',
  BASKETBALL: 'BASKETBALL',
  BEACH_VOLLEYBALL: 'BEACH_VOLLEYBALL',
  BOXING: 'BOXING',
  CRICKET: 'CRICKET',
  DARTS: 'DARTS',
  ESPORTS: 'ESPORTS',
  FLOORBALL: 'FLOORBALL',
  FOOTBALL: 'FOOTBALL',
  FUTSAL: 'FUTSAL',
  GOLF: 'GOLF',
  HANDBALL: 'HANDBALL',
  HOCKEY: 'HOCKEY',
  HORSE_RACING: 'HORSE_RACING',
  LACROSSE: 'LACROSSE',
  MMA: 'MMA',
  MOTORSPORTS: 'MOTORSPORTS',
  RUGBY: 'RUGBY',
  SNOOKER: 'SNOOKER',
  SOCCER: 'SOCCER',
  TABLE_TENNIS: 'TABLE_TENNIS',
  TENNIS: 'TENNIS',
  VOLLEYBALL: 'VOLLEYBALL',
  WATER_POLO: 'WATER_POLO',
});

export const SPORTSGAMEODDS_SPORTS = Object.freeze([
  ...new Set([...Object.keys(SPORTSGAMEODDS_LEAGUES), ...Object.keys(SPORTSGAMEODDS_SPORT_IDS)]),
]);

const boardCache = new Map();
const inflight = new Map();
const catalogState = {
  fetchedAt: null,
  sports: [],
  leagues: [],
  lastError: null,
};

export async function fetchSportsGameOddsCatalog({ force = false, signal = null } = {}) {
  try {
    const [sportsPayload, leaguesPayload] = await Promise.all([
      sportsGameOddsGet('/sports', {}, {
        ttlSeconds: 43_200,
        bypassCache: force,
        timeoutMs: 10_000,
        signal,
      }),
      sportsGameOddsGet('/leagues', {}, {
        ttlSeconds: 43_200,
        bypassCache: force,
        timeoutMs: 10_000,
        signal,
      }),
    ]);
    const sports = list(sportsPayload?.data)
      .map((row) => ({ id: text(row?.sportID || row?.id).toUpperCase(), name: text(row?.name) }))
      .filter((row) => row.id && row.id !== 'NON_SPORTS');
    const leagues = list(leaguesPayload?.data)
      .map((row) => ({
        id: text(row?.leagueID || row?.id).toUpperCase(),
        name: text(row?.name),
        sportID: text(row?.sportID).toUpperCase(),
      }))
      .filter((row) => row.id && row.sportID !== 'NON_SPORTS');
    catalogState.fetchedAt = new Date().toISOString();
    catalogState.sports = sports;
    catalogState.leagues = leagues;
    catalogState.lastError = null;
    return { fetchedAt: catalogState.fetchedAt, sports, leagues };
  } catch (error) {
    catalogState.lastError = text(error?.code || error?.name || 'SPORTSGAMEODDS_CATALOG_FAILED');
    return { fetchedAt: catalogState.fetchedAt, sports: [...catalogState.sports], leagues: [...catalogState.leagues], error: catalogState.lastError };
  }
}

export function sportsGameOddsCatalogHealth() {
  return {
    fetchedAt: catalogState.fetchedAt,
    sports: catalogState.sports.map((row) => row.id),
    leagues: catalogState.leagues.map((row) => row.id),
    sportCount: catalogState.sports.length,
    leagueCount: catalogState.leagues.length,
    lastError: catalogState.lastError,
  };
}

function cacheTtlSeconds() {
  return clamp(process.env.SPORTSGAMEODDS_BOARD_TTL_SECONDS, 240, 120, 1800);
}

function horizonHours() {
  return clamp(process.env.SPORTSGAMEODDS_EVENT_HORIZON_HOURS, 72, 12, 168);
}

function graceHours() {
  return clamp(process.env.SPORTSGAMEODDS_EVENT_GRACE_HOURS, 4, 0, 24);
}

function metadataHydrationEnabled() {
  return !truthy(process.env.SPORTSGAMEODDS_METADATA_HYDRATION_DISABLED);
}

function metadataTtlSeconds() {
  return clamp(process.env.SPORTSGAMEODDS_METADATA_TTL_SECONDS, 43_200, 3_600, 604_800);
}

function metadataPolicy(usage) {
  const monthly = sportsGameOddsMonthlyUsage(usage);
  const limit = Number(monthly.max);
  const reserveObjects = Number.isFinite(limit) && limit > 0
    ? Math.max(5_000, Math.ceil(limit * 0.10))
    : 10_000;
  return {
    monthly,
    reserveObjects,
    minHeadroomObjects: clamp(process.env.SPORTSGAMEODDS_METADATA_MIN_HEADROOM, 500, 100, 5_000),
    maxPlayerEvents: clamp(process.env.SPORTSGAMEODDS_METADATA_PLAYER_EVENTS, 2, 0, 4),
    playerPageLimit: clamp(process.env.SPORTSGAMEODDS_METADATA_PLAYER_LIMIT, 100, 25, 100),
    maxPlayerPages: clamp(process.env.SPORTSGAMEODDS_METADATA_PLAYER_PAGES, 2, 1, 3),
    maxTeamIds: clamp(process.env.SPORTSGAMEODDS_METADATA_TEAM_IDS, 20, 0, 50),
    maxMarketIds: clamp(process.env.SPORTSGAMEODDS_METADATA_MARKET_IDS, 40, 0, 100),
    ttlSeconds: metadataTtlSeconds(),
  };
}

function playerName(row) {
  const names = object(row?.names);
  return text(row?.name || row?.displayName || names.display || [names.firstName, names.lastName].filter(Boolean).join(' '));
}

function teamName(row) {
  const names = object(row?.names);
  return text(row?.name || names.long || names.medium || names.short);
}

function playerPropOdds(event) {
  return Object.values(object(event?.odds)).filter((odd) => {
    const entity = text(odd?.statEntityID);
    if (!entity || ['all','home','away'].includes(entity.toLowerCase())) return false;
    if (text(odd?.betTypeID).toLowerCase() !== 'ou') return false;
    return ['over','under'].includes(text(odd?.sideID).toLowerCase());
  });
}

function cloneForMetadata(event) {
  const teams = object(event?.teams);
  return {
    ...event,
    teams: {
      ...teams,
      home: { ...object(teams.home) },
      away: { ...object(teams.away) },
    },
    players: { ...object(event?.players) },
    odds: Object.fromEntries(Object.entries(object(event?.odds)).map(([key, odd]) => [key, { ...object(odd) }])),
  };
}

function missingPlayerIds(event) {
  const players = object(event?.players);
  return [...new Set(playerPropOdds(event)
    .map((odd) => text(odd?.statEntityID))
    .filter((id) => id && !playerName(players[id])))];
}

function missingTeamIds(events) {
  const ids = [];
  for (const event of events) {
    for (const side of ['home','away']) {
      const row = object(event?.teams?.[side]);
      const id = text(row.teamID || row.id);
      if (id && !teamName(row)) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function missingMarketIds(events) {
  const ids = [];
  for (const event of events) {
    for (const odd of playerPropOdds(event)) {
      if (text(odd?.marketName || odd?.statName)) continue;
      const id = text(odd?.oddID);
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function safeMetaError(error) {
  return text(error?.code || error?.name || 'SPORTSGAMEODDS_METADATA_FAILED');
}

async function hydrateMetadata(rows, usage, { signal = null } = {}) {
  const events = rows.map(cloneForMetadata);
  const policy = metadataPolicy(usage);
  const remaining = Number(policy.monthly.remaining);
  const report = {
    enabled: metadataHydrationEnabled(),
    attempted: false,
    reason: null,
    calls: { players: 0, teams: 0, markets: 0 },
    requested: { playerEvents: 0, teamIds: 0, marketIds: 0 },
    hydrated: { players: 0, teams: 0, markets: 0 },
    truncated: { playerEvents: false, teamIds: false, marketIds: false },
    errors: [],
    reserveObjects: policy.reserveObjects,
    monthlyRemaining: Number.isFinite(remaining) ? remaining : null,
  };

  if (!report.enabled) {
    report.reason = 'disabled';
    return { rows: events, report };
  }
  if (!Number.isFinite(remaining)) {
    report.reason = 'usage_unavailable';
    return { rows: events, report };
  }
  if (remaining - policy.reserveObjects < policy.minHeadroomObjects) {
    report.reason = 'monthly_reserve';
    return { rows: events, report };
  }

  const playerGapEvents = events.filter((event) => missingPlayerIds(event).length);
  const selectedPlayerEvents = playerGapEvents.slice(0, policy.maxPlayerEvents);
  report.requested.playerEvents = selectedPlayerEvents.length;
  report.truncated.playerEvents = playerGapEvents.length > selectedPlayerEvents.length;

  const teamGapIds = missingTeamIds(events);
  const selectedTeamIds = teamGapIds.slice(0, policy.maxTeamIds);
  report.requested.teamIds = selectedTeamIds.length;
  report.truncated.teamIds = teamGapIds.length > selectedTeamIds.length;

  const marketGapIds = missingMarketIds(events);
  const selectedMarketIds = marketGapIds.slice(0, policy.maxMarketIds);
  report.requested.marketIds = selectedMarketIds.length;
  report.truncated.marketIds = marketGapIds.length > selectedMarketIds.length;

  if (!selectedPlayerEvents.length && !selectedTeamIds.length && !selectedMarketIds.length) {
    report.reason = 'complete_event_metadata';
    return { rows: events, report };
  }
  report.attempted = true;

  for (const event of selectedPlayerEvents) {
    const eventID = text(event?.eventID || event?.id);
    const wanted = new Set(missingPlayerIds(event));
    if (!eventID || !wanted.size) continue;
    let cursor = null;
    for (let page = 0; page < policy.maxPlayerPages && wanted.size; page += 1) {
      try {
        report.calls.players += 1;
        const payload = await sportsGameOddsGet('/players', {
          eventID,
          limit: policy.playerPageLimit,
          cursor: cursor || undefined,
        }, {
          ttlSeconds: policy.ttlSeconds,
          timeoutMs: 10_000,
          signal,
        });
        for (const row of list(payload?.data)) {
          const id = text(row?.playerID || row?.id);
          if (!id || !wanted.has(id) || !playerName(row)) continue;
          event.players[id] = { ...object(event.players[id]), ...row };
          wanted.delete(id);
          report.hydrated.players += 1;
        }
        cursor = text(payload?.nextCursor);
        if (!cursor) break;
      } catch (error) {
        report.errors.push({ endpoint: 'players', code: safeMetaError(error) });
        break;
      }
    }
  }

  if (selectedTeamIds.length) {
    try {
      report.calls.teams += 1;
      const payload = await sportsGameOddsGet('/teams', {
        teamID: selectedTeamIds.join(','),
        limit: selectedTeamIds.length,
      }, {
        ttlSeconds: Math.max(policy.ttlSeconds, 86_400),
        timeoutMs: 10_000,
        signal,
      });
      const byId = new Map(list(payload?.data).map((row) => [text(row?.teamID || row?.id), row]).filter(([id]) => id));
      for (const event of events) {
        for (const side of ['home','away']) {
          const current = object(event?.teams?.[side]);
          const id = text(current.teamID || current.id);
          const source = byId.get(id);
          if (!source || !teamName(source)) continue;
          event.teams[side] = { ...current, ...source };
          report.hydrated.teams += 1;
        }
      }
    } catch (error) {
      report.errors.push({ endpoint: 'teams', code: safeMetaError(error) });
    }
  }

  if (selectedMarketIds.length) {
    try {
      report.calls.markets += 1;
      const payload = await sportsGameOddsGet('/markets', {
        oddID: selectedMarketIds.join(','),
        isSupported: 'true',
        limit: selectedMarketIds.length,
      }, {
        ttlSeconds: Math.max(policy.ttlSeconds, 86_400),
        timeoutMs: 10_000,
        signal,
      });
      const byId = new Map(list(payload?.data).map((row) => [text(row?.oddID), row]).filter(([id]) => id));
      for (const event of events) {
        const sportID = text(event?.sportID).toUpperCase();
        for (const [key, odd] of Object.entries(object(event?.odds))) {
          const id = text(odd?.oddID || key);
          const source = byId.get(id);
          if (!source) continue;
          const bySport = object(source?.marketGroupNameBySport);
          const label = text(bySport[sportID] || source?.marketGroupNameAlias || source?.marketGroupName);
          event.odds[key] = {
            ...odd,
            marketName: text(odd?.marketName || odd?.statName) || label || text(source?.statID),
            sgoMarketGroupId: text(source?.marketGroupID) || null,
            sgoMarketGroupName: text(source?.marketGroupName) || null,
            sgoPropType: text(source?.propType) || null,
            sgoIsProp: typeof source?.isProp === 'boolean' ? source.isProp : null,
            sgoIsSubPeriod: typeof source?.isSubPeriod === 'boolean' ? source.isSubPeriod : null,
            sgoIsSupported: typeof source?.isSupported === 'boolean' ? source.isSupported : null,
          };
          report.hydrated.markets += 1;
        }
      }
    } catch (error) {
      report.errors.push({ endpoint: 'markets', code: safeMetaError(error) });
    }
  }

  report.reason = report.errors.length ? 'partial' : 'hydrated_missing_metadata';
  return { rows: events, report };
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
      preferredProvider: 'SportsGameOdds',
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
  let leagues = SPORTSGAMEODDS_LEAGUES[selected] || [];
  let sportID = leagues.length ? null : (SPORTSGAMEODDS_SPORT_IDS[selected] || null);
  const includeAlternates = options.includeAlternates === true || truthy(process.env.SPORTSGAMEODDS_INCLUDE_ALTS);
  const eventLimit = clamp(options.eventLimit, 8, 1, 30);
  if (!leagues.length && !sportID) return emptyBoard(selected, { supported: false });
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
      // Resolve Tennis from the exact league IDs returned for this account.
      // The production account rejected guessed ATP/WTA/ITF IDs with HTTP 400.
      const catalog = (sportID || selected === 'TENNIS')
        ? await fetchSportsGameOddsCatalog({ signal: options.signal || null })
        : { sports: [...catalogState.sports], leagues: [...catalogState.leagues] };
      let requestedLeagues = leagues;
      if (selected === 'TENNIS') {
        const entitled = catalog.leagues
          .filter((row) => row.sportID === 'TENNIS')
          .map((row) => row.id)
          .filter(Boolean);
        if (entitled.length) {
          requestedLeagues = [...new Set(entitled)];
          sportID = null;
        } else {
          requestedLeagues = [];
          sportID = SPORTSGAMEODDS_SPORT_IDS.TENNIS || 'TENNIS';
        }
      }
      if (sportID && catalog.sports.length && !catalog.sports.some((row) => row.id === sportID)) {
        return emptyBoard(selected, {
          supported: false,
          entitlementMissing: true,
          requestedSportID: sportID,
          availableSportIDs: catalog.sports.map((row) => row.id),
        });
      }
      const now = Date.now();
      const payload = await sportsGameOddsGet('/events', {
        leagueID: sportID ? undefined : requestedLeagues.join(','),
        sportID: sportID || undefined,
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
      const hydrated = await hydrateMetadata(rows, usage, { signal: options.signal || null });
      const board = normalizeSportsGameOddsEvents(hydrated.rows, {
        requestedSport: selected,
        includeAlternates,
      });
      board.meta = {
        ...board.meta,
        supported: true,
        fetchedAt: new Date().toISOString(),
        ingestionTimestamp: new Date().toISOString(),
        latencyMs: Date.now() - started,
        leaguesRequested: sportID ? [] : requestedLeagues,
        sportIDsRequested: sportID ? [sportID] : [],
        eventsReturned: rows.length,
        entitledSports: catalog.sports.map((row) => row.id),
        entitledLeagues: catalog.leagues.map((row) => row.id),
        eventLimit,
        cacheSeconds: cacheTtlSeconds(),
        notice: text(payload?.notice) || null,
        accountTier: usage?.tier || null,
        accountUsage: sportsGameOddsHealth().monthly,
        metadataHydration: hydrated.report,
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
    metadataHydration: {
      enabled: metadataHydrationEnabled(),
      ttlSeconds: metadataTtlSeconds(),
    },
    cachedBoards: boardCache.size,
    catalog: sportsGameOddsCatalogHealth(),
  };
}

export const sportsGameOddsProvider = Object.freeze({
  id: 'sportsgameodds',
  name: 'SportsGameOdds',
  kind: 'odds',
  capabilities: Object.freeze([
    'events',
    'player-props',
    'bookmaker-lines',
    'american-odds',
    'stable-player-ids',
    'metadata-hydration',
  ]),
  supportedSports: SPORTSGAMEODDS_SPORTS,
  isConfigured: () => sportsGameOddsConfigured(),
  fetchBoard: fetchSportsGameOddsBoard,
  health: () => sportsGameOddsProviderHealth(),
});

export function __resetSportsGameOddsProvider() {
  boardCache.clear();
  inflight.clear();
  catalogState.fetchedAt = null;
  catalogState.sports = [];
  catalogState.leagues = [];
  catalogState.lastError = null;
}
