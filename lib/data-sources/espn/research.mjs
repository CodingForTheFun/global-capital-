import { normalizePlayerName } from '../contract.mjs';
// This is the existing pure market dictionary; it makes no provider requests.
import { fieldsFor, marketFromProviderKey } from '../sportsdataio/markets.mjs';

const BASE = 'https://site.web.api.espn.com/apis';
export const PUBLIC_LEAGUES = Object.freeze({
  NFL: ['football', 'nfl'], NBA: ['basketball', 'nba'], MLB: ['baseball', 'mlb'],
  NHL: ['hockey', 'nhl'], WNBA: ['basketball', 'wnba'], NCAAF: ['football', 'college-football'],
});
const basketball = {
  Points: ['points', 'points'], Rebounds: ['totalRebounds', 'rebounds'],
  Assists: ['assists', 'assists'], Steals: ['steals', 'steals'],
  BlockedShots: ['blocks', 'blocks'], Turnovers: ['turnovers', 'turnovers'],
  ThreePointersMade: ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threes'],
};
const football = {
  PassingAttempts: ['passingAttempts', 'passingAttempts'], PassingCompletions: ['completions', 'passingCompletions'],
  PassingYards: ['passingYards', 'passingYards'], PassingTouchdowns: ['passingTouchdowns', 'passingTouchdowns'],
  PassingInterceptions: ['interceptions', 'passingInterceptions'], RushingAttempts: ['rushingAttempts', 'rushingAttempts'],
  RushingYards: ['rushingYards', 'rushingYards'], RushingTouchdowns: ['rushingTouchdowns', 'rushingTouchdowns'],
  Receptions: ['receptions', 'receptions'], ReceivingYards: ['receivingYards', 'receivingYards'],
  ReceivingTargets: ['receivingTargets', 'targets'], ReceivingTouchdowns: ['receivingTouchdowns', 'receivingTouchdowns'],
};
const COLUMNS = {
  NBA: basketball, WNBA: basketball, NFL: football, NCAAF: football,
  MLB: { Hits:['hits','hits'], Runs:['runs','runs'], RunsBattedIn:['RBIs','runsBattedIn'],
    Strikeouts:['strikeouts','strikeouts'], Doubles:['doubles','doubles'], Triples:['triples','triples'],
    HomeRuns:['homeRuns','homeRuns'], StolenBases:['stolenBases','stolenBases'], Walks:['walks','walks'],
    EarnedRuns:['earnedRuns','earnedRuns'], HitsAllowed:['hits','hitsAllowed'],
    TotalBases:['totalBases','totalBases'], Singles:['singles','singles'] },
  NHL: { Goals:['goals','goals'], Assists:['assists','assists'], ShotsOnGoal:['shotsTotal','shotsOnGoal'],
    Saves:['saves','saves'], Hits:['hits','hits'], BlockedShots:['blockedShots','blocks'],
    PowerPlayPoints:['powerPlayPoints','powerPlayPoints'] },
};
const numeric = v => typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v.trim()) ? Number(v) : null;
const teamKey = v => String(v || '').replace(/^(nfl|nba|wnba|mlb|nhl|ncaaf)[_:-]/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function marketFields(sport, market, key) {
  const extra = { batter_home_runs:['HomeRuns'], batter_strikeouts:['Strikeouts'], pitcher_hits_allowed:['HitsAllowed'], pitcher_earned_runs:['EarnedRuns'] };
  if (sport === 'MLB' && extra[key]) return extra[key];
  if (key && !marketFromProviderKey(key)) return null;
  return fieldsFor(sport, market, key);
}
function categoryFor(sport, fields, key) {
  return sport !== 'MLB' ? null : String(key || '').startsWith('pitcher_')
    || (!String(key || '').startsWith('batter_') && fields?.some(f => ['Strikeouts','EarnedRuns','HitsAllowed'].includes(f))) ? 'pitching' : 'batting';
}
const TEAM_ALIASES = {
  NBA: { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' },
  NFL: { WSH:'WAS', JAC:'JAX', LA:'LAR' }, MLB: { NYY:'NYY', SD:'SD', SDP:'SD', SFG:'SF', KCR:'KC', TBR:'TB', WSH:'WSH', WAS:'WSH' },
  NHL: { LAK:'LA', SJS:'SJ', TBL:'TB', NJD:'NJ' },
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
  const config = PUBLIC_LEAGUES[String(sport || '').toUpperCase()];
  if (!config) return null;
  const [sportPath, league] = config;
  const wanted = normalizePlayerName(playerName);
  const candidates = new Map();
  for (const group of payload?.results || []) {
    if (group.type !== 'player') continue;
    // Refuse truncated searches rather than assuming an unseen same-name player
    // does not exist. Each identity match is scoped to the requested league.
    if (group.totalFound > (group.contents || []).length) return null;
    for (const row of group.contents || []) {
      if (row.sport !== sportPath || row.defaultLeagueSlug !== league || normalizePlayerName(row.displayName) !== wanted) continue;
      const match = String(row.link?.web || '').match(/^https:\/\/www\.espn\.com\/(nba|wnba|nfl|mlb|nhl|college-football)\/player\/_\/id\/(\d+)(?:\/|$)/);
      if (!match || match[1] !== league || !String(row.uid || '').endsWith(`~a:${match[2]}`)) continue;
      candidates.set(match[2], { id: match[2], playerName: row.displayName, teamName: row.subtitle || null });
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

function seasonType(group, category) {
  const declared = group.seasonType?.id ?? group.seasonType ?? category?.seasonType ?? category?.splitType;
  if (['1','2','3'].includes(String(declared))) return Number(declared);
  const name = String(group.displayName || '');
  return /preseason|spring training|all.star/i.test(name) ? 1
    : /postseason|playoffs|play-in/i.test(name) ? 3 : /regular season/i.test(name) ? 2 : null;
}
function elapsedMinutes(value) {
  const n = numeric(value);
  if (n !== null) return n;
  const m = typeof value === 'string' && value.match(/^(\d+):(\d{2})$/);
  return m && Number(m[2]) < 60 ? Number(m[1]) + Number(m[2])/60 : null;
}
function inspectGameLog(payload, { sport, market, providerMarketKey, now = Date.now() } = {}) {
  const league = String(sport || '').toUpperCase(), columns = COLUMNS[league];
  const fields = marketFields(league, market, providerMarketKey), names = payload?.names;
  const empty = { rows: [], complete: false };
  if (!columns || !fields?.length || fields.some(f => !columns[f]) || !Array.isArray(names) || new Set(names).size !== names.length) return empty;
  const category = categoryFor(league, fields, providerMarketKey);
  if (category && payload.filters?.find(f => f.name === 'category')?.value !== category) return empty;
  const season = payload.filters?.find(f => f.name === 'season')?.value ?? null;
  const seen = new Set(), expected = new Set(), output = [];
  let validSeason = false, unresolved = false;
  for (const group of payload?.seasonTypes || []) {
    for (const cat of group.categories || []) {
      const type = seasonType(group, cat);
      if (![2,3].includes(type) || cat.type !== 'event') continue;
      validSeason = true;
      for (const row of cat.events || []) {
        const event = payload.events?.[row.eventId];
        if (!event || String(event.id) !== String(row.eventId)) { unresolved = true; continue; }
        const date = Date.parse(event.gameDate), status = event.status?.type || event.status;
        const homeScore = numeric(event.homeTeamScore), awayScore = numeric(event.awayTeamScore);
        if (!Number.isFinite(date) || date > now || event.leagueAbbreviation !== league
          || event.team?.isAllStar || event.opponent?.isAllStar
          || !['W','L','T'].includes(event.gameResult) || homeScore === null || awayScore === null
          || status?.completed === false || (status?.state && status.state !== 'post')) continue;
        const teamId = String(event.team?.id || ''), opponentId = String(event.opponent?.id || '');
        const isHome = teamId === String(event.homeTeamId);
        if (!teamId || !opponentId || (isHome ? opponentId !== String(event.awayTeamId)
          : teamId !== String(event.awayTeamId) || opponentId !== String(event.homeTeamId))) continue;
        const scoreFor = isHome ? homeScore : awayScore, scoreAgainst = isHome ? awayScore : homeScore;
        if ((scoreFor === scoreAgainst ? 'T' : scoreFor > scoreAgainst ? 'W' : 'L') !== event.gameResult) continue;
        if (row.didNotPlay === true || row.active === false) continue;
        const values = Object.fromEntries(names.map((name, i) => [name, row.stats?.[i]]));
        const minutes = elapsedMinutes(values.minutes ?? values.timeOnIcePerGame);
        if (PUBLIC_LEAGUES[league][0] === 'basketball' && (minutes === null || minutes <= 0)) continue;
        if (league === 'NHL' && minutes !== null && minutes <= 0) continue;
        const id = String(event.id);
        expected.add(id);
        if (!Array.isArray(row.stats) || row.stats.length !== names.length || seen.has(id)) continue;
        const stats = {}, mapped = {};
        for (const [field, [name, key]] of Object.entries(columns)) {
          const raw = values[name];
          const pair = field === 'ThreePointersMade' && typeof raw === 'string' ? raw.match(/^(\d+)-(\d+)$/) : null;
          const value = field === 'ThreePointersMade' ? (pair && Number(pair[1]) <= Number(pair[2]) ? Number(pair[1]) : null) : numeric(raw);
          mapped[field] = value; stats[key] = value;
        }
        if (league === 'MLB' && category === 'batting') {
          mapped.HitsAllowed = null; stats.hitsAllowed = null;
          const components = ['Hits','Doubles','Triples','HomeRuns'].map(k => mapped[k]);
          if (components.every(v => v !== null && v >= 0) && mapped.Hits >= mapped.Doubles + mapped.Triples + mapped.HomeRuns) {
            mapped.TotalBases = mapped.Hits + mapped.Doubles + 2*mapped.Triples + 3*mapped.HomeRuns;
            mapped.Singles = mapped.Hits - mapped.Doubles - mapped.Triples - mapped.HomeRuns;
            stats.totalBases = mapped.TotalBases; stats.singles = mapped.Singles;
          }
        }
        if (league === 'MLB' && category === 'pitching') {
          stats.hits = null; stats.runs = null; stats.runsAllowed = mapped.Runs;
        }
        if (league === 'NHL') {
          const g = numeric(values.powerPlayGoals), a = numeric(values.powerPlayAssists);
          mapped.PowerPlayPoints = g !== null && a !== null ? g+a : null;
          stats.powerPlayPoints = mapped.PowerPlayPoints;
          stats.points = mapped.Goals !== null && mapped.Assists !== null ? mapped.Goals+mapped.Assists : null;
        }
        if (fields.some(f => mapped[f] === null)) continue;
        seen.add(id);
        output.push({ gameId: `${league.toLowerCase()}:${event.id}`, date: new Date(date).toISOString(),
          opponentId: `${league}:${opponentId}`, teamId: `${league}:${teamId}`,
          opponent: event.opponent?.abbreviation || null, opponentName: event.opponent?.displayName || null,
          team: event.team?.abbreviation || null, teamName: event.team?.displayName || null,
          isHome, started: typeof row.started === 'boolean' ? row.started : null,
          scoreFor, scoreAgainst, gameResult: event.gameResult, minutes, ...stats,
          value: fields.reduce((sum, f) => sum + mapped[f], 0), season, seasonType: type });
      }
    }
  }
  return { rows: output.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    complete: !unresolved && validSeason && season !== null && expected.size === seen.size && !payload?.nextPage && !payload?.hasMore };
}
export function normalizePublicGameLog(payload, params) { return inspectGameLog(payload, params).rows; }

export function createPublicResearch({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
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
    const fields = marketFields(sport, params.market, params.providerMarketKey);
    if (!PUBLIC_LEAGUES[sport] || !fields?.length || fields.some(f => !COLUMNS[sport][f])) return unavailable('UNSUPPORTED_MARKET');
    const [sportPath, leaguePath] = PUBLIC_LEAGUES[sport];
    const category = categoryFor(sport, fields, params.providerMarketKey);
    const name = normalizePlayerName(params.playerName);
    if (!name || name.length > 100) return unavailable('PLAYER_NOT_FOUND');
    const search = await request(`/search/v2?${new URLSearchParams({query:name, sport:sportPath})}`, 24 * 60 * 60_000);
    const athlete = resolvePublicAthlete(search.data, { sport, playerName: params.playerName });
    if (!athlete) return unavailable('PLAYER_NOT_FOUND');
    const path = `/common/v3/sports/${sportPath}/${leaguePath}/athletes/${athlete.id}/gamelog`;
    const query = category ? `?category=${category}` : '';
    const response = await request(path + query, 6 * 60 * 60_000);
    let cached = Boolean(search.cached && response.cached);
    const current = inspectGameLog(response.data, { ...params, sport, now: now() });
    let logs = current.rows;
    const count = Math.max(15, Math.min(40, Math.floor(Number(params.games) || 20)));
    const filter = response.data?.filters?.find(f => f.name === 'season');
    const previous = filter?.options?.find(o => Number(o.value) === Number(filter.value) - 1);
    if (logs.length < count && previous && /^\d{4}$/.test(previous.value)) {
      const older = await request(`${path}${query}${query ? '&' : '?'}season=${previous.value}`, 24 * 60 * 60_000);
      cached = cached && Boolean(older.cached);
      logs = [...logs, ...normalizePublicGameLog(older.data, { ...params, sport, now: now() })];
    }
    logs.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (!logs.length) return unavailable('NO_GAME_LOG_DATA');
    if (params.team && !sameTeam(params.team, logs[0].team, sport)
      && teamKey(params.team) !== teamKey(athlete.teamName)) return unavailable('PLAYER_TEAM_MISMATCH');
    const unique = [...new Map(logs.map(row => [row.gameId, row])).values()];
    const isPlayerTeam = value => value && (sameTeam(value, logs[0].team, sport) || teamKey(value) === teamKey(athlete.teamName));
    const matchupOpponent = params.opponent || (isPlayerTeam(params.homeTeam) ? params.awayTeam
      : isPlayerTeam(params.awayTeam) ? params.homeTeam : null);
    const matchedOpponent = logs.find(row => matchupOpponent && (teamKey(row.opponentName) === teamKey(matchupOpponent)
      || sameTeam(row.opponent, matchupOpponent, sport)));
    const opponent = matchedOpponent?.opponent || matchupOpponent;
    const opponentId = matchedOpponent?.opponentId || null;
    return { ok: true, available: true, source: 'Historical stats', cached, opponent, opponentId,
      player: { playerName: athlete.playerName, team: logs[0].team, sport }, gameLog: unique,
      coverage: { seasonComplete: current.complete }, season: filter?.value || null };
  };
}

export const fetchPublicResearch = createPublicResearch();
// Preserve imports used by the already deployed basketball integration/tests.
export const createPublicBasketballResearch = createPublicResearch;
export const fetchPublicBasketballResearch = fetchPublicResearch;
