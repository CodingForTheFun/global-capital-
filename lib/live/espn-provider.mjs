const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

export const LIVE_FEEDS = Object.freeze({
  NFL: [{ family: 'football', league: 'nfl', label: 'NFL' }],
  NCAAF: [{ family: 'football', league: 'college-football', label: 'NCAAF' }],
  NBA: [{ family: 'basketball', league: 'nba', label: 'NBA' }],
  WNBA: [{ family: 'basketball', league: 'wnba', label: 'WNBA' }],
  NCAAB: [{ family: 'basketball', league: 'mens-college-basketball', label: 'NCAAB' }],
  MLB: [{ family: 'baseball', league: 'mlb', label: 'MLB' }],
  NHL: [{ family: 'hockey', league: 'nhl', label: 'NHL' }],
  SOCCER: [
    { family: 'soccer', league: 'usa.1', label: 'MLS' },
    { family: 'soccer', league: 'eng.1', label: 'Premier League' },
    { family: 'soccer', league: 'uefa.champions', label: 'Champions League' },
    { family: 'soccer', league: 'usa.nwsl', label: 'NWSL' },
  ],
  TENNIS: [
    { family: 'tennis', league: 'atp', label: 'ATP' },
    { family: 'tennis', league: 'wta', label: 'WTA' },
  ],
});

export const LIVE_SPORTS = Object.freeze(Object.keys(LIVE_FEEDS));

const SCOREBOARD_TTL_MS = 15_000;
const DETAIL_TTL_MS = 10_000;
const ERROR_TTL_MS = 20_000;
const BACKOFF_MS = 5 * 60_000;
const MAX_PLAYS = 120;
const MAX_ATHLETES_PER_GROUP = 40;

const clean = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};
const numeric = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return Number(value);
  return null;
};
const unique = (items) => [...new Set(items.filter(Boolean))];

function entity(competitor) {
  const source = competitor?.team || competitor?.athlete || competitor || {};
  const logo = source.logo || source.logos?.[0]?.href || source.headshot?.href || source.headshot || null;
  return {
    id: clean(source.id ?? competitor?.id),
    abbreviation: clean(source.abbreviation ?? source.shortName),
    name: clean(source.displayName ?? source.fullName ?? source.name ?? source.shortDisplayName),
    shortName: clean(source.shortDisplayName ?? source.shortName ?? source.displayName ?? source.fullName ?? source.name),
    logo: clean(logo),
    color: clean(source.color),
  };
}

function canonicalState(status = {}) {
  const type = status.type || {};
  const detail = String(type.detail || type.description || type.name || status.type || '').toLowerCase();
  if (/cancel/.test(detail)) return 'CANCELED';
  if (/postpon|suspend/.test(detail)) return 'POSTPONED';
  if (/delay/.test(detail)) return 'DELAYED';
  if (type.completed === true || type.state === 'post' || status.state === 'post') return 'FINAL';
  if (type.state === 'in' || status.state === 'in') return 'LIVE';
  if (type.state === 'pre' || status.state === 'pre') return 'SCHEDULED';
  return clean(type.state || status.state)?.toUpperCase() || 'SCHEDULED';
}

function statusMeta(competition = {}) {
  const status = competition.status || {};
  const type = status.type || {};
  return {
    status: canonicalState(status),
    providerStatus: clean(type.description ?? type.name),
    statusDetail: clean(type.shortDetail ?? type.detail ?? status.displayClock),
    period: numeric(status.period),
    periodLabel: clean(type.shortDetail ?? type.detail) || (numeric(status.period) !== null ? String(status.period) : null),
    clock: clean(status.displayClock),
  };
}

function participantPair(competition = {}) {
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  let home = competitors.find((row) => row?.homeAway === 'home') || null;
  let away = competitors.find((row) => row?.homeAway === 'away') || null;
  if (!home && competitors.length) home = competitors[competitors.length - 1];
  if (!away && competitors.length > 1) away = competitors.find((row) => row !== home) || competitors[0];
  return { home, away };
}

function broadcastNames(competition = {}) {
  const rows = Array.isArray(competition.broadcasts) ? competition.broadcasts : [];
  return unique(rows.flatMap((row) => Array.isArray(row?.names) ? row.names : [row?.name]).map(clean));
}

function possessionFor(competition = {}) {
  const row = (competition.competitors || []).find((competitor) => competitor?.possession === true);
  if (!row) return null;
  const value = entity(row);
  return value.abbreviation || value.shortName || value.name;
}

export function normalizeScoreboardCompetition(sport, feed, event, competition) {
  if (!event || !competition) return null;
  const { home, away } = participantPair(competition);
  const homeEntity = entity(home);
  const awayEntity = entity(away);
  const competitionId = clean(competition.id ?? event.id);
  const eventId = clean(event.id ?? competition.id);
  if (!eventId || !competitionId || (!homeEntity.name && !awayEntity.name)) return null;
  const status = statusMeta(competition);
  const venue = competition.venue || event.venue || {};
  const startTime = clean(competition.date ?? event.date);
  const game = {
    id: `${sport}:${feed.league}:${competitionId}`,
    gameId: competitionId,
    eventId,
    competitionId,
    sport,
    league: feed.label || sport,
    providerLeague: feed.league,
    homeTeam: homeEntity.abbreviation || homeEntity.shortName || homeEntity.name,
    homeTeamName: homeEntity.name,
    homeTeamId: homeEntity.id,
    homeLogo: homeEntity.logo,
    awayTeam: awayEntity.abbreviation || awayEntity.shortName || awayEntity.name,
    awayTeamName: awayEntity.name,
    awayTeamId: awayEntity.id,
    awayLogo: awayEntity.logo,
    homeScore: numeric(home?.score),
    awayScore: numeric(away?.score),
    startTime,
    ...status,
    possession: possessionFor(competition),
    venue: clean(venue.fullName ?? venue.name),
    city: clean(venue.address?.city),
    broadcasts: broadcastNames(competition),
    playByPlayAvailable: competition.playByPlayAvailable !== false,
    updatedAt: clean(competition.status?.lastUpdated ?? event.status?.lastUpdated) || null,
  };
  return game;
}

export function normalizeScoreboard(sport, feed, payload) {
  const games = [];
  for (const event of Array.isArray(payload?.events) ? payload.events : []) {
    const competitions = Array.isArray(event?.competitions) && event.competitions.length ? event.competitions : [event];
    for (const competition of competitions) {
      const game = normalizeScoreboardCompetition(sport, feed, event, competition);
      if (game) games.push(game);
    }
  }
  return games;
}

function teamLookup(competition = {}) {
  const map = new Map();
  for (const competitor of competition.competitors || []) {
    const item = entity(competitor);
    if (item.id) map.set(String(item.id), item);
  }
  return map;
}

function scoreFromPlay(value) {
  return numeric(value);
}

function normalizePlay(play, teams) {
  if (!play || typeof play !== 'object') return null;
  const teamId = clean(play.team?.id ?? play.teamId);
  const team = teamId ? teams.get(teamId) : null;
  const text = clean(play.shortText ?? play.text ?? play.type?.text ?? play.type?.description);
  if (!text) return null;
  return {
    id: clean(play.id ?? play.sequenceNumber ?? `${play.period?.number || 0}:${play.clock?.displayValue || ''}:${text}`),
    text,
    type: clean(play.type?.text ?? play.type?.description),
    scoringPlay: play.scoringPlay === true,
    scoreValue: numeric(play.scoreValue),
    period: numeric(play.period?.number ?? play.period),
    periodLabel: clean(play.period?.displayValue ?? play.period?.name),
    clock: clean(play.clock?.displayValue ?? play.clock),
    teamId,
    team: team?.abbreviation || team?.shortName || team?.name || clean(play.team?.abbreviation),
    homeScore: scoreFromPlay(play.homeScore),
    awayScore: scoreFromPlay(play.awayScore),
    wallclock: clean(play.wallclock ?? play.date),
  };
}

function normalizeTeamStats(payload = {}) {
  return (Array.isArray(payload?.boxscore?.teams) ? payload.boxscore.teams : []).map((row) => {
    const team = entity(row.team || row);
    const stats = (Array.isArray(row.statistics) ? row.statistics : []).map((stat) => ({
      name: clean(stat.name),
      label: clean(stat.label ?? stat.shortDisplayName ?? stat.displayName ?? stat.name),
      value: clean(stat.displayValue ?? stat.value),
    })).filter((stat) => stat.label && stat.value !== null);
    return { team, stats };
  }).filter((row) => row.team.name || row.team.abbreviation);
}

function normalizePlayerGroups(payload = {}) {
  const groups = [];
  for (const teamRow of Array.isArray(payload?.boxscore?.players) ? payload.boxscore.players : []) {
    const team = entity(teamRow.team || teamRow);
    for (const category of Array.isArray(teamRow.statistics) ? teamRow.statistics : []) {
      const labels = Array.isArray(category.labels) ? category.labels.map(clean).filter(Boolean) : [];
      const athletes = (Array.isArray(category.athletes) ? category.athletes : []).slice(0, MAX_ATHLETES_PER_GROUP).map((row) => {
        const athlete = entity(row.athlete || row);
        const stats = Array.isArray(row.stats) ? row.stats.map((value) => clean(value)) : [];
        return {
          id: athlete.id,
          name: athlete.name || athlete.shortName,
          shortName: athlete.shortName,
          logo: athlete.logo,
          position: clean(row.athlete?.position?.abbreviation ?? row.position?.abbreviation),
          starter: row.starter === true,
          didNotPlay: row.didNotPlay === true,
          stats,
        };
      }).filter((row) => row.name);
      if (!athletes.length) continue;
      groups.push({
        team,
        name: clean(category.displayName ?? category.name) || 'Players',
        shortName: clean(category.abbreviation ?? category.name),
        labels,
        athletes,
      });
    }
  }
  return groups;
}

function normalizeLeaders(payload = {}) {
  const output = [];
  for (const teamRow of Array.isArray(payload?.leaders) ? payload.leaders : []) {
    const team = entity(teamRow.team || teamRow);
    for (const category of Array.isArray(teamRow.leaders) ? teamRow.leaders : []) {
      const leader = Array.isArray(category.leaders) ? category.leaders[0] : null;
      if (!leader) continue;
      const athlete = entity(leader.athlete || leader);
      output.push({
        team,
        category: clean(category.displayName ?? category.name),
        athlete,
        value: clean(leader.displayValue ?? leader.value),
      });
    }
  }
  return output;
}

export function normalizeSummary(sport, feed, payload, { eventId, competitionId } = {}) {
  const headerCompetitions = Array.isArray(payload?.header?.competitions) ? payload.header.competitions : [];
  const competition = headerCompetitions.find((row) => String(row?.id) === String(competitionId)) || headerCompetitions[0] || null;
  const headerEvent = payload?.header || { id: eventId };
  const game = competition ? normalizeScoreboardCompetition(sport, feed, headerEvent, competition) : null;
  const teams = teamLookup(competition || {});
  const rawPlays = Array.isArray(payload?.plays) ? payload.plays : [];
  const rawScoring = Array.isArray(payload?.scoringPlays) ? payload.scoringPlays : [];
  const merged = rawPlays.length ? rawPlays : rawScoring;
  const plays = merged.slice(-MAX_PLAYS).map((play) => normalizePlay(play, teams)).filter(Boolean);
  const scoringPlays = (rawScoring.length ? rawScoring : rawPlays.filter((play) => play?.scoringPlay === true))
    .slice(-60).map((play) => normalizePlay(play, teams)).filter(Boolean);
  const boxscore = normalizeTeamStats(payload);
  const playerGroups = normalizePlayerGroups(payload);
  const leaders = normalizeLeaders(payload);
  const article = Array.isArray(payload?.article?.story) ? payload.article.story[0] : payload?.article;
  return {
    available: Boolean(game || plays.length || boxscore.length || playerGroups.length),
    sport,
    league: feed.label || sport,
    providerLeague: feed.league,
    eventId: clean(eventId ?? headerEvent?.id),
    competitionId: clean(competitionId ?? competition?.id),
    game,
    plays,
    scoringPlays,
    teamStats: boxscore,
    playerGroups,
    leaders,
    note: clean(article?.description),
  };
}

function resolveFeeds(sport, providerLeague = null) {
  const key = String(sport || '').trim().toUpperCase();
  const feeds = LIVE_FEEDS[key] || [];
  if (!providerLeague) return feeds;
  return feeds.filter((feed) => feed.league === providerLeague);
}

export function createEspnLiveProvider({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map();
  const pending = new Map();
  let backoffUntil = 0;
  const metrics = { requests: 0, cacheHits: 0, errors: 0, rateLimited: 0 };

  async function request(url, { ttlMs, force = false } = {}) {
    const time = now();
    const hit = cache.get(url);
    if (hit && hit.expires > time && (!force || time - hit.fetchedAt < 4_000)) {
      metrics.cacheHits++;
      return { ...hit.result, cached: true };
    }
    if (pending.has(url)) return pending.get(url);
    if (time < backoffUntil) return { ok: false, status: 429, reason: 'RATE_LIMIT_BACKOFF', data: null, cached: false };
    const work = (async () => {
      metrics.requests++;
      let result = { ok: false, status: 0, reason: 'PROVIDER_ERROR', data: null, cached: false };
      try {
        const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
        if (response.status === 429) {
          metrics.rateLimited++;
          backoffUntil = now() + BACKOFF_MS;
        }
        if (response.ok) result = { ok: true, status: response.status, reason: null, data: await response.json(), cached: false };
        else result = { ok: false, status: response.status, reason: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', data: null, cached: false };
      } catch {
        metrics.errors++;
      }
      const fetchedAt = now();
      cache.set(url, { result, fetchedAt, expires: fetchedAt + (result.ok ? ttlMs : ERROR_TTL_MS) });
      if (cache.size > 256) cache.delete(cache.keys().next().value);
      return result;
    })().finally(() => pending.delete(url));
    pending.set(url, work);
    return work;
  }

  async function scoreboard(sport, { force = false } = {}) {
    const feeds = resolveFeeds(sport);
    if (!feeds.length) return { sport: String(sport || '').toUpperCase(), status: 404, errorType: 'UNSUPPORTED_SPORT', games: [] };
    const started = now();
    const rows = await Promise.all(feeds.map(async (feed) => {
      const url = `${BASE}/${feed.family}/${feed.league}/scoreboard`;
      const result = await request(url, { ttlMs: SCOREBOARD_TTL_MS, force });
      return { feed, result };
    }));
    const games = rows.flatMap(({ feed, result }) => result.ok ? normalizeScoreboard(String(sport).toUpperCase(), feed, result.data) : []);
    const statuses = rows.map(({ result }) => result.status || 0);
    const okCount = rows.filter(({ result }) => result.ok).length;
    return {
      sport: String(sport || '').toUpperCase(),
      status: okCount ? 200 : (statuses.find(Boolean) || 0),
      errorType: okCount ? (okCount === rows.length ? null : 'PARTIAL_COVERAGE') : 'PROVIDER_UNAVAILABLE',
      latencyMs: Math.max(0, now() - started),
      games,
      feedCount: feeds.length,
      activeFeedCount: okCount,
    };
  }

  async function detail({ sport, providerLeague, eventId, competitionId, force = false } = {}) {
    const key = String(sport || '').trim().toUpperCase();
    const feeds = resolveFeeds(key, clean(providerLeague));
    if (!eventId || !feeds.length) return { ok: false, status: 404, errorType: 'GAME_NOT_FOUND', detail: null };
    const feed = feeds[0];
    const url = `${BASE}/${feed.family}/${feed.league}/summary?event=${encodeURIComponent(String(eventId))}`;
    const started = now();
    const result = await request(url, { ttlMs: DETAIL_TTL_MS, force });
    if (!result.ok) return { ok: false, status: result.status || 0, errorType: result.reason || 'PROVIDER_UNAVAILABLE', latencyMs: Math.max(0, now() - started), detail: null };
    return {
      ok: true,
      status: 200,
      errorType: null,
      latencyMs: Math.max(0, now() - started),
      detail: normalizeSummary(key, feed, result.data, { eventId, competitionId }),
    };
  }

  return {
    scoreboard,
    detail,
    supportedSports: () => [...LIVE_SPORTS],
    stats: () => ({ ...metrics, backoffUntil: backoffUntil || null, cacheEntries: cache.size }),
    clear: () => { cache.clear(); backoffUntil = 0; },
  };
}
