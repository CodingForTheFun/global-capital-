import { ingestionSignal } from './operation-deadline.mjs';
import { record } from './normalize.mjs';
import { numeric } from '../data-sources/espn/stat-contract.mjs';
import { browserJsonFetch } from './browser-json-fetch.mjs';

const BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';
const PUBLIC_WEB_KEY = 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R';
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BYTES = 20 * 1024 * 1024;
const TTL_MS = 10 * 60_000;
const SPORTS_TTL_MS = 30 * 60_000;
const SPORT_NAME = Object.freeze({
  NFL: /football/i, NCAAF: /football/i, NBA: /basketball/i, WNBA: /basketball/i, NCAAB: /basketball/i,
  MLB: /baseball/i, NHL: /hockey/i, TENNIS: /tennis/i,
});
const UNIT_LABELS = Object.freeze({
  PointsReboundsAssist: 'Points + Rebounds + Assists', PointsRebounds: 'Points + Rebounds', PointsAssists: 'Points + Assists', ReboundsAssists: 'Rebounds + Assists',
  Points: 'Points', Rebounds: 'Rebounds', Assists: 'Assists', Steals: 'Steals', Blocks: 'Blocks', Turnovers: 'Turnovers', ThreePointersMade: '3-PT Made', ThreesMade: '3-PT Made',
  PassingYards: 'Passing Yards', PassingTouchdowns: 'Passing Touchdowns', PassingAttempts: 'Passing Attempts', PassingCompletions: 'Passing Completions', PassingInterceptions: 'Passing Interceptions',
  RushingYards: 'Rushing Yards', RushingAttempts: 'Rushing Attempts', ReceivingYards: 'Receiving Yards', Receptions: 'Receptions',
  Hits: 'Hits', TotalBases: 'Total Bases', HomeRuns: 'Home Runs', Runs: 'Runs', RunsBattedIn: 'RBI', StolenBases: 'Stolen Bases', Strikeouts: 'Strikeouts',
  HitsAllowed: 'Hits Allowed', WalksAllowed: 'Walks Allowed', PitchingOuts: 'Pitching Outs', EarnedRuns: 'Earned Runs', PitchesThrown: 'Pitches Thrown',
  ShotsOnGoal: 'Shots on Goal', Goals: 'Goals', AssistsHockey: 'Assists', BlockedShots: 'Blocked Shots', Saves: 'Saves', GoalsAgainst: 'Goals Against',
  Aces: 'Aces', DoubleFaults: 'Double Faults', GamesWon: 'Games Won', SetsWon: 'Sets Won',
});

const cache = new Map();
const pending = new Map();
let sportsCache = { expires: 0, rows: null };
const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const int = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
};

// Pinnacle's current guest web feed is strict about request shape. Keep the
// headers intentionally minimal: these match the anonymous browser client.
function headers() {
  return {
    accept: 'application/json',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': UA,
    referer: 'https://www.pinnacle.com/',
    'x-api-key': PUBLIC_WEB_KEY,
  };
}
async function directJson(fetcher, url) {
  const response = await fetcher(url, { headers: headers(), signal: ingestionSignal(AbortSignal.timeout(18_000)), redirect: 'follow' });
  if (!response.ok) throw Object.assign(new Error('PINNACLE_PUBLIC_HTTP'), { code: 'PINNACLE_PUBLIC_HTTP', status: response.status });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('PINNACLE_PUBLIC_TOO_LARGE'), { code: 'PINNACLE_PUBLIC_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('PINNACLE_PUBLIC_TOO_LARGE'), { code: 'PINNACLE_PUBLIC_TOO_LARGE' });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('PINNACLE_PUBLIC_INVALID_JSON'), { code: 'PINNACLE_PUBLIC_INVALID_JSON' }); }
}
async function fetchJson(fetcher, path) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  try { return await directJson(fetcher, url); }
  catch (error) {
    if (fetcher !== globalThis.fetch) throw error;
    return browserJsonFetch(url, {
      origin: 'https://www.pinnacle.com', referer: 'https://www.pinnacle.com/', userAgent: UA, timeoutMs: 18_000,
      headers: { 'x-api-key': PUBLIC_WEB_KEY, accept: 'application/json' },
    });
  }
}
async function sports(fetcher) {
  if (sportsCache.rows && sportsCache.expires > Date.now()) return sportsCache.rows;
  const rows = await fetchJson(fetcher, '/sports');
  if (!Array.isArray(rows)) throw Object.assign(new Error('PINNACLE_SPORTS_SCHEMA'), { code: 'PINNACLE_SPORTS_SCHEMA' });
  sportsCache = { expires: Date.now() + SPORTS_TTL_MS, rows };
  return rows;
}
function leagueMatches(sport, matchup) {
  const league = text(matchup?.league?.name || matchup?.leagueName);
  if (!league && sport !== 'TENNIS') return false;
  if (sport === 'NFL') return /\bNFL\b|National Football League/i.test(league);
  if (sport === 'NCAAF') return /NCAA|College/i.test(league) && !/basketball/i.test(league);
  if (sport === 'NBA') return /\bNBA\b|National Basketball Association/i.test(league) && !/WNBA|G League|Summer League/i.test(league);
  if (sport === 'WNBA') return /\bWNBA\b/i.test(league);
  if (sport === 'NCAAB') return /NCAA|College/i.test(league);
  if (sport === 'MLB') return /\bMLB\b|Major League Baseball/i.test(league);
  if (sport === 'NHL') return /\bNHL\b|National Hockey League/i.test(league);
  return sport === 'TENNIS';
}
function sportIdFor(sport, rows) {
  const re = SPORT_NAME[sport];
  if (!re) return null;
  const candidates = rows.filter((row) => re.test(text(row?.name)));
  if (!candidates.length) return null;
  if (sport === 'NFL' || sport === 'NCAAF') {
    const american = candidates.find((row) => /american|football/i.test(text(row?.name)) && !/soccer/i.test(text(row?.name)));
    if (american) return american.id;
  }
  return candidates[0]?.id ?? null;
}
function future(matchup) {
  const ms = Date.parse(matchup?.startTime || '');
  return Number.isFinite(ms) && ms > Date.now() - 60_000 && matchup?.isLive !== true && matchup?.state !== 'live';
}
function teams(matchup) {
  const participants = list(matchup?.participants);
  const home = participants.find((p) => /home/i.test(text(p?.alignment)))?.name || participants[0]?.name || '';
  const away = participants.find((p) => /away/i.test(text(p?.alignment)))?.name || participants[1]?.name || '';
  return { homeTeam: text(home), awayTeam: text(away) };
}
function labelForUnits(units) {
  const raw = text(units);
  if (UNIT_LABELS[raw]) return UNIT_LABELS[raw];
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  const allowed = /^(?:points?|rebounds?|assists?|steals?|blocks?|turnovers?|passing yards?|passing touchdowns?|passing attempts?|passing completions?|passing interceptions?|rushing yards?|rushing attempts?|receiving yards?|receptions?|hits?|total bases?|home runs?|runs?|rbi|strikeouts?|hits allowed|walks allowed|pitching outs|earned runs|pitches thrown|shots on goal|blocked shots?|goals?|saves?|goals against|aces?|double faults?|games won|sets won)$/i;
  return allowed.test(spaced) ? spaced.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}
function labelForSpecial(special, description) {
  const label = labelForUnits(special?.units || special?.special?.units);
  if (/^Runs$/i.test(label) && /\bEarned\s+Runs\s*$/i.test(text(description))) return 'Earned Runs';
  return label;
}
function cleanPlayer(description, label) {
  let source = text(description).trim();
  if (!source) return '';
  // Common current shapes: "Sidney Crosby (Points)" and
  // "Anthony Edwards Total Threes Made".
  const paren = source.match(/^(.+?)\s*\(([^)]+)\)/);
  if (paren) source = paren[1].trim();
  const by = source.match(/\bby\s+(.+)$/i);
  if (by) source = by[1];
  source = source.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    .replace(/\b(?:over|under|player|total)\b/ig, ' ').replace(/[()|:]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || /\b(?:team|game|match|total)\b/i.test(source)) return '';
  return source;
}
function sideOf(price, participantNames = null) {
  const designation = text(price?.designation || price?.side).toLowerCase();
  if (designation === 'over') return 'OVER';
  if (designation === 'under') return 'UNDER';
  const participant = participantNames?.get?.(String(price?.participantId ?? '')) || '';
  if (participant === 'over') return 'OVER';
  if (participant === 'under') return 'UNDER';
  return null;
}
function specialCategory(row) { return text(row?.special?.category || row?.category).toLowerCase(); }
function isPlayerSpecial(row) {
  if (text(row?.type).toLowerCase() !== 'special') return false;
  const category = specialCategory(row);
  return !category || /player\s*props?|player|performance/i.test(category);
}
function parsePlayerSpecials(sport, main, related, markets) {
  const start = main?.startTime;
  if (!future(main)) return [];
  const { homeTeam, awayTeam } = teams(main);
  const participantNames = new Map();
  for (const special of list(related)) {
    for (const participant of list(special?.participants)) {
      const id = String(participant?.id ?? '');
      const name = text(participant?.name).toLowerCase();
      if (id && (name === 'over' || name === 'under')) participantNames.set(id, name);
    }
  }
  const records = [];
  for (const special of list(related)) {
    if (!isPlayerSpecial(special)) continue;
    const description = special?.special?.description || special?.description;
    const label = labelForSpecial(special, description);
    const playerName = cleanPlayer(description, label);
    if (!label || !playerName || special?.isLive === true) continue;
    const specialId = String(special?.id ?? '');
    if (!specialId) continue;
    const byLine = new Map();
    for (const market of list(markets)) {
      if (String(market?.matchupId ?? '') !== specialId || text(market?.type).toLowerCase() !== 'total' || market?.isAlternate === true) continue;
      if (market?.period != null && Number(market.period) !== 0) continue;
      if (/^(?:suspended|closed|settled)$/i.test(text(market?.status))) continue;
      for (const price of list(market?.prices)) {
        const side = sideOf(price, participantNames);
        const line = numeric(price?.points);
        const odds = numeric(price?.price);
        if (!side || line === null || odds === null) continue;
        const key = String(line);
        if (!byLine.has(key)) byLine.set(key, { line, overOdds: null, underOdds: null });
        if (side === 'OVER') byLine.get(key).overOdds = odds;
        else byLine.get(key).underOdds = odds;
      }
    }
    const complete = [...byLine.values()].filter((pair) => pair.overOdds !== null && pair.underOdds !== null);
    if (complete.length !== 1) continue;
    const pair = complete[0];
    const playerId = playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const parsed = record({
      sourceId: `${main.id}:${specialId}:${playerId}:${label}:${pair.line}`,
      book: 'pinnacle', nativePlayerId: playerId, playerName, sport, market: label, line: pair.line,
      period: 'game', team: '', opponent: '', nativeEventId: String(main.id), homeTeam, awayTeam,
      gameStartTime: start, updatedAt: new Date().toISOString(), overOdds: pair.overOdds, underOdds: pair.underOdds,
      sides: ['OVER', 'UNDER'],
    });
    if (parsed) records.push(parsed);
  }
  return records;
}

export function pinnacleSupportedSports() { return Object.keys(SPORT_NAME); }
export async function fetchPinnaclePublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  if (!SPORT_NAME[sport]) throw Object.assign(new Error('PINNACLE_UNSUPPORTED_SPORT'), { code: 'PINNACLE_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const availableSports = await sports(fetcher);
    const sportId = sportIdFor(sport, availableSports);
    if (sportId == null) throw Object.assign(new Error('PINNACLE_SPORT_NOT_FOUND'), { code: 'PINNACLE_SPORT_NOT_FOUND' });
    const matchups = await fetchJson(fetcher, `/sports/${encodeURIComponent(sportId)}/matchups?brandId=0`);
    if (!Array.isArray(matchups)) throw Object.assign(new Error('PINNACLE_MATCHUPS_SCHEMA'), { code: 'PINNACLE_MATCHUPS_SCHEMA' });
    let games = matchups.filter((row) => text(row?.type).toLowerCase() === 'matchup' && !row?.parentId && future(row) && row?.hasMarkets !== false && leagueMatches(sport, row));
    games.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    games = games.slice(0, int('AUTOSCOUT_PINNACLE_MAX_EVENTS_PER_SPORT', 4, 1, 12));
    const records = [];
    let successes = 0;
    let lastStatus = null;
    for (const main of games) {
      try {
        const [related, markets] = await Promise.all([
          fetchJson(fetcher, `/matchups/${encodeURIComponent(main.id)}/related`),
          fetchJson(fetcher, `/matchups/${encodeURIComponent(main.id)}/markets/related/straight`),
        ]);
        records.push(...parsePlayerSpecials(sport, main, related, markets)); successes += 1;
      } catch (error) { lastStatus = Number(error?.status) || null; }
    }
    if (games.length && successes === 0) throw Object.assign(new Error('PINNACLE_EVENTS_UNAVAILABLE'), { code: 'PINNACLE_EVENTS_UNAVAILABLE', status: lastStatus });
    const value = { records, fetchedAt: new Date().toISOString(), endpoint: 'guest.api.arcadia.pinnacle.com', transport: 'pinnacle-public', eventsChecked: games.length };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; }
  finally { pending.delete(sport); }
}
