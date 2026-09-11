import { normalizePlayerName } from '../contract.mjs';
// This is the existing pure market dictionary; it makes no provider requests.
import { fieldsFor, marketFromProviderKey } from '../sportsdataio/markets.mjs';

const BASE = 'https://site.web.api.espn.com/apis';
const LEAGUES = new Set(['NBA', 'WNBA']);
const COLUMNS = Object.freeze({
  Points: ['points', 'points'], Rebounds: ['totalRebounds', 'rebounds'],
  Assists: ['assists', 'assists'], Steals: ['steals', 'steals'],
  BlockedShots: ['blocks', 'blocks'], Turnovers: ['turnovers', 'turnovers'],
  ThreePointersMade: ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threes'],
});
const numeric = v => typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : null;
const teamKey = v => String(v || '').replace(/^(nba|wnba)[_:-]/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const TEAM_ALIASES = {
  NBA: { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' },
  WNBA: { NYL: 'NY', LVA: 'LV', LAS: 'LA', PHO: 'PHX', CONN: 'CON', GSV: 'GS', WSH: 'WAS' },
};
function sameTeam(a, b, sport) {
  const aliases = TEAM_ALIASES[sport] || {};
  const clean = v => aliases[teamKey(v)] || teamKey(v);
  return Boolean(clean(a) && clean(b) && clean(a) === clean(b));
}
const unavailable = code => ({ ok: true, available: false, code, gameLog: [],
  message: 'Historical game results are unavailable for this selection.' });

export function resolvePublicAthlete(payload, { sport, playerName } = {}) {
  const league = String(sport || '').toLowerCase();
  const wanted = normalizePlayerName(playerName);
  const candidates = new Map();
  for (const group of payload?.results || []) {
    if (group.type !== 'player') continue;
    // Refuse truncated searches rather than assuming an unseen same-name player
    // does not exist. The cache is league + full normalized name, never name alone.
    if (group.totalFound > (group.contents || []).length) return null;
    for (const row of group.contents || []) {
      if (row.sport !== 'basketball' || row.defaultLeagueSlug !== league || normalizePlayerName(row.displayName) !== wanted) continue;
      const match = String(row.link?.web || '').match(/^https:\/\/www\.espn\.com\/(nba|wnba)\/player\/_\/id\/(\d+)(?:\/|$)/);
      if (!match || match[1] !== league || !String(row.uid || '').endsWith(`~a:${match[2]}`)) continue;
      candidates.set(match[2], { id: match[2], playerName: row.displayName, teamName: row.subtitle || null });
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

export function normalizePublicGameLog(payload, { sport, market, providerMarketKey, now = Date.now() } = {}) {
  const league = String(sport || '').toUpperCase();
  if (!LEAGUES.has(league)) return [];
  // Unknown scoped keys must not fall back to a full-game display label.
  if (providerMarketKey && !marketFromProviderKey(providerMarketKey)) return [];
  const fields = fieldsFor(league, market, providerMarketKey);
  if (!fields?.length || fields.some(f => !COLUMNS[f])) return [];
  const names = payload?.names;
  if (!Array.isArray(names) || new Set(names).size !== names.length) return [];
  const seen = new Set(), output = [];
  for (const season of payload?.seasonTypes || []) {
    if (!/(regular season|postseason|playoffs|play-in)/i.test(season.displayName || '')) continue;
    for (const category of season.categories || []) {
      if (category.type !== 'event') continue;
      for (const row of category.events || []) {
        const event = payload.events?.[row.eventId];
        if (!event || String(event.id) !== String(row.eventId) || seen.has(String(event.id))) continue;
        const date = Date.parse(event.gameDate), status = event.status?.type || event.status;
        const homeScore = numeric(event.homeTeamScore), awayScore = numeric(event.awayTeamScore);
        if (!Number.isFinite(date) || date > now || event.leagueAbbreviation !== league
          || event.team?.isAllStar || event.opponent?.isAllStar
          || !['W','L'].includes(event.gameResult) || homeScore === null || awayScore === null || homeScore === awayScore
          || status?.completed === false || (status?.state && status.state !== 'post')) continue;
        const teamId = String(event.team?.id || ''), opponentId = String(event.opponent?.id || '');
        const isHome = teamId === String(event.homeTeamId);
        if (!teamId || !opponentId || (isHome ? opponentId !== String(event.awayTeamId)
          : teamId !== String(event.awayTeamId) || opponentId !== String(event.homeTeamId))) continue;
        if ((isHome ? homeScore > awayScore : awayScore > homeScore) !== (event.gameResult === 'W')) continue;
        if (!Array.isArray(row.stats) || row.stats.length !== names.length) continue;
        const values = Object.fromEntries(names.map((name, i) => [name, row.stats[i]]));
        const minutes = numeric(values.minutes);
        // DNP and unknown minutes cannot become zero-stat appearances.
        if (minutes === null || minutes <= 0) continue;
        const stats = {}, mapped = {};
        for (const [field, [name, key]] of Object.entries(COLUMNS)) {
          const raw = values[name];
          const pair = field === 'ThreePointersMade' && typeof raw === 'string' ? raw.match(/^(\d+)-(\d+)$/) : null;
          const value = field === 'ThreePointersMade' ? (pair && Number(pair[1]) <= Number(pair[2]) ? Number(pair[1]) : null) : numeric(raw);
          mapped[field] = value;
          stats[key] = value;
        }
        if (fields.some(f => mapped[f] === null)) continue;
        seen.add(String(event.id));
        output.push({ gameId: `${league.toLowerCase()}:${event.id}`, date: new Date(date).toISOString(),
          opponent: event.opponent?.abbreviation || null, opponentName: event.opponent?.displayName || null,
          team: event.team?.abbreviation || null, isHome, started: null, minutes, ...stats,
          value: fields.reduce((sum, f) => sum + mapped[f], 0), seasonType: season.displayName });
      }
    }
  }
  return output.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function createPublicBasketballResearch({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map(), queue = [];
  let active = 0, backoffUntil = 0;
  async function request(path, ttl) {
    const hit = cache.get(path);
    if (hit?.expires > now()) return { ...hit.result, cached: true };
    if (pending.has(path)) return pending.get(path);
    if (now() < backoffUntil || queue.length >= 64) return { data: null };
    const work = (async () => {
      if (active >= 2) await new Promise(resolve => queue.push(resolve));
      active++;
      let result = { data: null };
      try {
        if (now() < backoffUntil) return result;
        const response = await fetchImpl(`${BASE}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
        if (response.status === 429) backoffUntil = now() + 15 * 60_000;
        if (response.ok) result = { data: await response.json(), cached: false };
      } catch { /* Generic absence only; no raw provider error reaches the API. */ }
      finally { active--; queue.shift()?.(); }
      cache.set(path, { result, expires: now() + (result.data ? ttl : 5 * 60_000) });
      while (cache.size > 600) cache.delete(cache.keys().next().value);
      return result;
    })().finally(() => pending.delete(path));
    pending.set(path, work);
    return work;
  }
  return async function fetchResearch(params = {}) {
    const sport = String(params.sport || '').toUpperCase();
    const fields = fieldsFor(sport, params.market, params.providerMarketKey);
    if (!LEAGUES.has(sport) || !fields?.length || fields.some(f => !COLUMNS[f])
      || (params.providerMarketKey && !marketFromProviderKey(params.providerMarketKey))) return unavailable('UNSUPPORTED_MARKET');
    const name = normalizePlayerName(params.playerName);
    if (!name || name.length > 100) return unavailable('PLAYER_NOT_FOUND');
    const search = await request(`/search/v2?${new URLSearchParams({query:name, sport:'basketball'})}`, 24 * 60 * 60_000);
    const athlete = resolvePublicAthlete(search.data, { sport, playerName: params.playerName });
    if (!athlete) return unavailable('PLAYER_NOT_FOUND');
    const path = `/common/v3/sports/basketball/${sport.toLowerCase()}/athletes/${athlete.id}/gamelog`;
    const response = await request(path, 6 * 60 * 60_000);
    let cached = Boolean(search.cached && response.cached);
    let logs = normalizePublicGameLog(response.data, { ...params, sport, now: now() });
    const count = Math.max(15, Math.min(40, Math.floor(Number(params.games) || 20)));
    const filter = response.data?.filters?.find(f => f.name === 'season');
    const previous = filter?.options?.find(o => Number(o.value) === Number(filter.value) - 1);
    if (logs.length < count && previous && /^\d{4}$/.test(previous.value)) {
      const older = await request(`${path}?season=${previous.value}`, 24 * 60 * 60_000);
      cached = cached && Boolean(older.cached);
      logs = [...logs, ...normalizePublicGameLog(older.data, { ...params, sport, now: now() })];
    }
    logs.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (!logs.length) return unavailable('NO_GAME_LOG_DATA');
    if (params.team && !sameTeam(params.team, logs[0].team, sport)
      && teamKey(params.team) !== teamKey(athlete.teamName)) return unavailable('PLAYER_TEAM_MISMATCH');
    const unique = [...new Map(logs.map(row => [row.gameId, row])).values()].slice(0, count);
    const isPlayerTeam = value => value && (sameTeam(value, logs[0].team, sport) || teamKey(value) === teamKey(athlete.teamName));
    const matchupOpponent = params.opponent || (isPlayerTeam(params.homeTeam) ? params.awayTeam
      : isPlayerTeam(params.awayTeam) ? params.homeTeam : null);
    const opponent = logs.find(row => matchupOpponent && (teamKey(row.opponentName) === teamKey(matchupOpponent)
      || sameTeam(row.opponent, matchupOpponent, sport)))?.opponent || matchupOpponent;
    return { ok: true, available: true, source: 'Historical stats', cached, opponent,
      player: { playerName: athlete.playerName, team: logs[0].team, sport }, gameLog: unique,
      coverage: { seasonComplete: false }, season: filter?.value || null };
  };
}

export const fetchPublicBasketballResearch = createPublicBasketballResearch();
