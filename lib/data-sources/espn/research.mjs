import { normalizePlayerName } from '../contract.mjs';
// This is the existing pure market dictionary; it makes no provider requests.
import { fieldsFor, marketFromProviderKey, marketKey } from '../sportsdataio/markets.mjs';

const BASE = 'https://site.web.api.espn.com/apis';
const SITE_BASE = 'https://site.api.espn.com/apis';
export const PUBLIC_LEAGUES = Object.freeze({
  NFL: ['football', 'nfl'], NBA: ['basketball', 'nba'], MLB: ['baseball', 'mlb'],
  NHL: ['hockey', 'nhl'], WNBA: ['basketball', 'wnba'], NCAAF: ['football', 'college-football'], NCAAB: ['basketball', 'mens-college-basketball'],
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
  DefensiveSacks: ['sacks', 'defensiveSacks'], SoloTackles: ['soloTackles', 'soloTackles'],
  AssistedTackles: ['assistTackles', 'assistedTackles'], TotalTackles: ['totalTackles', 'totalTackles'],
  DefensiveInterceptions: ['interceptions', 'defensiveInterceptions'],
  FieldGoalsMade: ['fieldGoalsMade-fieldGoalAttempts', 'fieldGoalsMade'],
  ExtraPointsMade: ['extraPointsMade-extraPointAttempts', 'extraPointsMade'],
  KickingPoints: ['totalKickingPoints', 'kickingPoints'],
  LongestPass: ['longPassing', 'longestPass'], LongestRush: ['longRushing', 'longestRush'],
  LongestReception: ['longReception', 'longestReception'],
};
const COLUMNS = {
  NBA: basketball, WNBA: basketball, NCAAB: basketball, NFL: football, NCAAF: football,
  MLB: { Hits:['hits','hits'], Runs:['runs','runs'], RunsBattedIn:['RBIs','runsBattedIn'],
    Strikeouts:['strikeouts','strikeouts'], Doubles:['doubles','doubles'], Triples:['triples','triples'],
    HomeRuns:['homeRuns','homeRuns'], StolenBases:['stolenBases','stolenBases'], Walks:['walks','walks'],
    EarnedRuns:['earnedRuns','earnedRuns'], HitsAllowed:['hits','hitsAllowed'],
    TotalBases:['totalBases','totalBases'], Singles:['singles','singles'], Outs:['innings','outs'] },
  NHL: { Goals:['goals','goals'], Assists:['assists','assists'], ShotsOnGoal:['shotsTotal','shotsOnGoal'],
    Saves:['saves','saves'], Hits:['hits','hits'], BlockedShots:['blockedShots','blocks'],
    PowerPlayPoints:['powerPlayPoints','powerPlayPoints'] },
};
const numeric = v => typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v.trim()) ? Number(v) : null;
const teamKey = v => String(v || '').replace(/^(nfl|nba|wnba|mlb|nhl|ncaaf|ncaab)[_:-]/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Provider keys are scoped to a sport. A wrong/unknown key must never fall
// back to an unrelated display label, period, team total or fantasy score.
const FOOTBALL_EXTRA = {
  player_sacks:['DefensiveSacks'], player_solo_tackles:['SoloTackles'],
  player_assists:['AssistedTackles'], player_tackles_assists:['TotalTackles'],
  player_defensive_interceptions:['DefensiveInterceptions'],
  player_field_goals:['FieldGoalsMade'], player_pats:['ExtraPointsMade'],
  player_kicking_points:['KickingPoints'], player_pass_rush_yds:['PassingYards','RushingYards'],
  player_pass_longest_completion:['LongestPass'], player_rush_longest:['LongestRush'],
  player_reception_longest:['LongestReception'],
};
const FOOTBALL_LABELS = {
  sacks:['DefensiveSacks'], 'defensive sacks':['DefensiveSacks'],
  'solo tackles':['SoloTackles'], assists:['AssistedTackles'],
  'tackles+assists':['TotalTackles'], 'tackles + assists':['TotalTackles'],
  'field goals':['FieldGoalsMade'], 'field goals made':['FieldGoalsMade'],
  'kicking points':['KickingPoints'], 'defensive interceptions':['DefensiveInterceptions'],
};
function marketFields(sport, market, key) {
  key = String(key || '').trim().toLowerCase();
  if (/^(batter|pitcher)_/.test(key) && sport !== 'MLB') return null;
  const extra = sport === 'NFL' || sport === 'NCAAF' ? FOOTBALL_EXTRA : sport === 'MLB' ? {
    batter_home_runs:['HomeRuns'], batter_strikeouts:['Strikeouts'], batter_runs_scored:['Runs'],
    batter_triples:['Triples'], pitcher_hits_allowed:['HitsAllowed'], pitcher_earned_runs:['EarnedRuns'],
    pitcher_walks:['Walks'], pitcher_outs:['Outs'],
  } : sport === 'NHL' ? { player_blocked_shots:['BlockedShots'] } : {};
  if (key && Object.hasOwn(extra, key)) return extra[key];
  if (key) {
    const canonical = marketFromProviderKey(key);
    return canonical ? fieldsFor(sport, canonical)?.map(f => f === 'PitchingHits' ? 'HitsAllowed' : f) : null;
  }
  const label = marketKey(market);
  if ((sport === 'NFL' || sport === 'NCAAF') && Object.hasOwn(FOOTBALL_LABELS, label)) return FOOTBALL_LABELS[label];
  return fieldsFor(sport, market)?.map(f => f === 'PitchingHits' ? 'HitsAllowed' : f) || null;
}
function categoryFor(sport, fields, key) {
  return sport !== 'MLB' ? null : String(key || '').trim().toLowerCase().startsWith('pitcher_')
    || (!String(key || '').trim().toLowerCase().startsWith('batter_') && fields?.some(f => ['Strikeouts','EarnedRuns','HitsAllowed','Outs'].includes(f))) ? 'pitching' : 'batting';
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
      const match = String(row.link?.web || '').match(/^https:\/\/www\.espn\.com\/(nba|wnba|nfl|mlb|nhl|college-football|mens-college-basketball)\/player\/_\/id\/(\d+)(?:\/|$)/);
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
  const declaredLeague = payload.filters?.find(f => f.name === 'league')?.value;
  if (declaredLeague && declaredLeague !== PUBLIC_LEAGUES[league][1]) return empty;
  // ESPN calls both a QB's sacks taken and a defender's sacks 'sacks', and
  // both passing and defensive interceptions 'interceptions'. Require role
  // evidence, not just that shared column name.
  if (['NFL','NCAAF'].includes(league)) {
    const defensive = names.includes('soloTackles') && names.includes('assistTackles') && !names.includes('passingAttempts');
    if (fields.some(f => ['DefensiveSacks','SoloTackles','AssistedTackles','TotalTackles','DefensiveInterceptions'].includes(f)) && !defensive) return empty;
    if (fields.some(f => f.startsWith('Passing') || f === 'LongestPass') && !names.includes('passingAttempts')) return empty;
  }
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
        // Deliberately excluded games do not imply incomplete played-game
        // coverage. Malformed completed rows do: their omission must not turn
        // the surviving sample into a claimed full season.
        if (row.didNotPlay === true || row.active === false || event.team?.isAllStar || event.opponent?.isAllStar
          || date > now || status?.completed === false || (status?.state && status.state !== 'post')) continue;
        if (!Number.isFinite(date) || !(league === 'NCAAB' ? ['NCAAB','NCAAM'] : [league]).includes(event.leagueAbbreviation)
          || !['W','L','T'].includes(event.gameResult) || homeScore === null || awayScore === null) { unresolved = true; continue; }
        const teamId = String(event.team?.id || ''), opponentId = String(event.opponent?.id || '');
        const isHome = teamId === String(event.homeTeamId);
        if (!teamId || !opponentId || (isHome ? opponentId !== String(event.awayTeamId)
          : teamId !== String(event.awayTeamId) || opponentId !== String(event.homeTeamId))) { unresolved = true; continue; }
        const scoreFor = isHome ? homeScore : awayScore, scoreAgainst = isHome ? awayScore : homeScore;
        if ((scoreFor === scoreAgainst ? 'T' : scoreFor > scoreAgainst ? 'W' : 'L') !== event.gameResult) { unresolved = true; continue; }
        const values = Object.fromEntries(names.map((name, i) => [name, row.stats?.[i]]));
        const minutes = elapsedMinutes(values.minutes ?? values.timeOnIcePerGame);
        if (PUBLIC_LEAGUES[league][0] === 'basketball' && minutes === null) { unresolved = true; continue; }
        if (PUBLIC_LEAGUES[league][0] === 'basketball' && minutes <= 0) continue;
        if (league === 'NHL' && minutes !== null && minutes <= 0) continue;
        const id = String(event.id);
        expected.add(id);
        if (!Array.isArray(row.stats) || row.stats.length !== names.length || seen.has(id)) continue;
        const stats = {}, mapped = {};
        for (const [field, [name, key]] of Object.entries(columns)) {
          const raw = values[name];
          const paired = ['ThreePointersMade','FieldGoalsMade','ExtraPointsMade'].includes(field);
          const pair = paired && typeof raw === 'string' ? raw.match(/^(\d+)-(\d+)$/) : null;
          const innings = field === 'Outs' ? String(raw ?? '').match(/^(\d+)(?:\.([012]))?$/) : null;
          const value = paired ? (pair && Number(pair[1]) <= Number(pair[2]) ? Number(pair[1]) : null)
            : field === 'Outs' ? (innings ? 3*Number(innings[1])+Number(innings[2] || 0) : null) : numeric(raw);
          mapped[field] = value; stats[key] = value;
        }
        if (['NFL','NCAAF'].includes(league)) {
          const defense = names.includes('soloTackles') && names.includes('assistTackles') && !names.includes('passingAttempts');
          if (defense) { mapped.PassingInterceptions = null; stats.passingInterceptions = null; }
          else { mapped.DefensiveSacks = mapped.DefensiveInterceptions = null; stats.defensiveSacks = stats.defensiveInterceptions = null; }
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

// Cache policy. Successfully resolved name->athlete-id mappings never expire.
// Negative/ambiguous searches expire after five minutes so they can recover.
// Completed game logs hold for two hours, which is well inside the gap between
// a game finishing and the next one starting.
export const ID_MAP_TTL = Infinity;
export const GAME_LOG_TTL = 2 * 60 * 60_000;
// Batch hydration resolves a whole slate at once, so the old limit of two
// in-flight requests made the first board load serial. Six keeps the free
// endpoint politely used while letting a slate resolve in parallel.
const MAX_CONCURRENT = 6;

export function createPublicResearch({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map(), queue = [];
  let active = 0, backoffUntil = 0;
  async function request(path, ttl, accepts = () => true) {
    const hit = cache.get(path);
    if (hit && (hit.expires === Infinity || hit.expires > now())) return { ...hit.result, cached: true };
    if (pending.has(path)) return pending.get(path);
    if (now() < backoffUntil || queue.length >= 256) return { data: null };
    const work = (async () => {
      if (active >= MAX_CONCURRENT) await new Promise(resolve => queue.push(resolve));
      active++;
      let result = { data: null };
      try {
        if (now() < backoffUntil) return result;
        const response = await fetchImpl(`${path.startsWith('/site/v2/') ? SITE_BASE : BASE}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
        if (response.status === 429) backoffUntil = now() + 15 * 60_000;
        if (response.ok) result = { data: await response.json(), cached: false };
      } catch { /* Generic absence only; no raw provider error reaches the API. */ }
      finally { active--; queue.shift()?.(); }
      const expires = !result.data || !accepts(result.data) ? now() + 5 * 60_000 : ttl === Infinity ? Infinity : now() + ttl;
      cache.set(path, { result, expires });
      // Evict expiring entries first so a permanent id mapping is not thrown
      // away to make room for a game log that will go stale in two hours.
      for (const [key, entry] of cache) {
        if (cache.size <= 4000) break;
        if (entry.expires !== Infinity) cache.delete(key);
      }
      while (cache.size > 6000) cache.delete(cache.keys().next().value);
      return result;
    })().finally(() => pending.delete(path));
    pending.set(path, work);
    return work;
  }
  // On ambiguous/truncated name searches, verify a unique player on the
  // requested current team(s). Never reuse another provider's numeric id.
  async function rosterAthlete(params, sportPath, leaguePath) {
    const hints = [...new Set((params.team ? [params.team] : [params.homeTeam, params.awayTeam]).filter(Boolean))];
    if (!hints.length || hints.length > 2) return null;
    const catalog = await request(`/site/v2/sports/${sportPath}/${leaguePath}/teams?limit=1000`, 24*60*60_000);
    const leagues = (catalog.data?.sports || []).flatMap(s => s.leagues || []).filter(l => l.slug === leaguePath);
    const teams = leagues.flatMap(l => l.teams || []).map(t => t.team).filter(t => /^\d+$/.test(String(t?.id)));
    const matched = hints.map(h => teams.filter(t => sameTeam(h,t.abbreviation,params.sport) || teamKey(h) === teamKey(t.displayName)));
    if (matched.some(rows => rows.length !== 1)) return null;
    const unique = [...new Map(matched.map(([t]) => [String(t.id),t])).values()];
    const candidates = new Map();
    for (const team of unique) {
      const roster = await request(`/site/v2/sports/${sportPath}/${leaguePath}/teams/${team.id}/roster`, 6*60*60_000);
      const d = roster.data;
      if (!Array.isArray(d?.athletes) || String(d.team?.id) !== String(team.id) || d.hasMore || d.nextPage) return null;
      const prefix = String(team.uid || '').split('~t:')[0];
      if (!/^s:\d+~l:\d+$/.test(prefix)) return null;
      for (const row of d.athletes.flatMap(g => Array.isArray(g.items) ? g.items : [g])) {
        if (!/^\d+$/.test(String(row.id)) || row.uid !== `${prefix}~a:${row.id}`
          || normalizePlayerName(row.displayName || row.fullName) !== normalizePlayerName(params.playerName)) continue;
        candidates.set(String(row.id), { id:String(row.id), playerName:row.displayName || row.fullName,
          teamName:team.displayName, team:team.abbreviation, position:row.position?.abbreviation || null });
      }
    }
    return candidates.size === 1 ? [...candidates.values()][0] : null;
  }
  return async function fetchResearch(params = {}) {
    const sport = String(params.sport || '').toUpperCase();
    const fields = marketFields(sport, params.market, params.providerMarketKey);
    if (!PUBLIC_LEAGUES[sport] || !fields?.length || fields.some(f => !COLUMNS[sport][f])) return unavailable('UNSUPPORTED_MARKET');
    const [sportPath, leaguePath] = PUBLIC_LEAGUES[sport];
    const category = categoryFor(sport, fields, params.providerMarketKey);
    const name = normalizePlayerName(params.playerName);
    if (!name || name.length > 100) return unavailable('PLAYER_NOT_FOUND');
    const search = await request(`/search/v2?${new URLSearchParams({query:name, sport:sportPath})}`, ID_MAP_TTL,
      data => Boolean(resolvePublicAthlete(data, { sport, playerName:params.playerName })));
    let athlete = resolvePublicAthlete(search.data, { sport, playerName: params.playerName });
    if (!athlete) athlete = await rosterAthlete({ ...params, sport }, sportPath, leaguePath);
    if (!athlete) return unavailable('PLAYER_NOT_FOUND');
    const path = `/common/v3/sports/${sportPath}/${leaguePath}/athletes/${athlete.id}/gamelog`;
    const query = category ? `?category=${category}` : '';
    const response = await request(path + query, GAME_LOG_TTL);
    let cached = Boolean(search.cached && response.cached);
    const current = inspectGameLog(response.data, { ...params, sport, now: now() });
    let logs = current.rows;
    const count = Math.max(15, Math.min(40, Math.floor(Number(params.games) || 20)));
    const filter = response.data?.filters?.find(f => f.name === 'season');
    const previousSeasons = [...new Set((filter?.options || []).map(o => String(o.value)))]
      .filter(v => /^\d{4}$/.test(v) && Number(v) < Number(filter.value))
      .sort((a,b) => Number(b)-Number(a)).slice(0,2);
    for (const previousValue of previousSeasons) {
      if (logs.length >= count) break;
      const previous = { value: previousValue };
      const older = await request(`${path}${query}${query ? '&' : '?'}season=${previous.value}`, GAME_LOG_TTL);
      cached = cached && Boolean(older.cached);
      // Some upstream failures ignore the requested year. Never label those
      // responses as a previous-season backfill or count duplicate current games.
      if (String(older.data?.filters?.find(f => f.name === 'season')?.value) === previous.value) {
        logs = [...logs, ...normalizePublicGameLog(older.data, { ...params, sport, now: now() })];
      }
    }
    logs.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (!logs.length) return unavailable('NO_GAME_LOG_DATA');
    if (params.team && !sameTeam(params.team, athlete.team || logs[0].team, sport)
      && teamKey(params.team) !== teamKey(athlete.teamName)) return unavailable('PLAYER_TEAM_MISMATCH');
    const unique = [...new Map(logs.map(row => [row.gameId, row])).values()];
    const isPlayerTeam = value => value && (sameTeam(value, athlete.team || logs[0].team, sport) || teamKey(value) === teamKey(athlete.teamName));
    const matchupOpponent = params.opponent || (isPlayerTeam(params.homeTeam) ? params.awayTeam
      : isPlayerTeam(params.awayTeam) ? params.homeTeam : null);
    const matchedOpponent = logs.find(row => matchupOpponent && (teamKey(row.opponentName) === teamKey(matchupOpponent)
      || sameTeam(row.opponent, matchupOpponent, sport)));
    const opponent = matchedOpponent?.opponent || matchupOpponent;
    const opponentId = matchedOpponent?.opponentId || null;
    return { ok: true, available: true, source: 'Historical stats', cached, opponent, opponentId,
      player: { playerName: athlete.playerName, team: athlete.team || logs[0].team, sport }, gameLog: unique,
      coverage: { seasonComplete: current.complete, historySeasons: [...new Set(unique.map(r => r.season))] }, season: filter?.value || null };
  };
}

export const fetchPublicResearch = createPublicResearch();
// Preserve imports used by the already deployed basketball integration/tests.
export const createPublicBasketballResearch = createPublicResearch;
export const fetchPublicBasketballResearch = fetchPublicResearch;
