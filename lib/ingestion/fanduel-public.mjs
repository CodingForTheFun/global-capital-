import { record } from './normalize.mjs';
import { numeric } from '../data-sources/espn/stat-contract.mjs';

const BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const PUBLIC_KEY = 'FhMFpcPWXMeyZxOx';
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TTL_MS = 5 * 60_000;
const MAX_BYTES = 20 * 1024 * 1024;
const SPORT_PAGES = Object.freeze({
  NFL: 'nfl', NBA: 'nba', WNBA: 'wnba', MLB: 'mlb', NHL: 'nhl',
  NCAAF: 'ncaaf', NCAAB: 'ncaab', TENNIS: 'tennis',
});
const MARKET_PATTERNS = Object.freeze([
  [/points\s*\+\s*rebounds\s*\+\s*assists|pts\s*\+\s*reb\s*\+\s*ast/i, 'Points + Rebounds + Assists'],
  [/points\s*\+\s*rebounds|pts\s*\+\s*reb/i, 'Points + Rebounds'],
  [/points\s*\+\s*assists|pts\s*\+\s*ast/i, 'Points + Assists'],
  [/rebounds\s*\+\s*assists|reb\s*\+\s*ast/i, 'Rebounds + Assists'],
  [/passing\s+yards?/i, 'Passing Yards'], [/passing\s+(?:touchdowns?|tds?)/i, 'Passing Touchdowns'],
  [/passing\s+attempts?/i, 'Passing Attempts'], [/passing\s+completions?/i, 'Passing Completions'],
  [/passing\s+interceptions?|interceptions?\s+thrown/i, 'Passing Interceptions'],
  [/rushing\s+yards?/i, 'Rushing Yards'], [/rushing\s+attempts?|carries/i, 'Rushing Attempts'],
  [/rushing\s+(?:touchdowns?|tds?)/i, 'Rushing Touchdowns'],
  [/receiving\s+yards?/i, 'Receiving Yards'], [/receptions?/i, 'Receptions'],
  [/receiving\s+(?:touchdowns?|tds?)/i, 'Receiving Touchdowns'], [/longest\s+reception/i, 'Longest Reception'],
  [/tackles?\s*\+\s*assists?/i, 'Tackles + Assists'], [/solo\s+tackles?/i, 'Solo Tackles'],
  [/field\s+goals?\s+made/i, 'Field Goals Made'], [/kicking\s+points?/i, 'Kicking Points'],
  [/three[- ]?pointers?\s+made|3[- ]?pt\s+made|threes?\s+made/i, '3-PT Made'],
  [/blocked\s+shots?|blocks?/i, 'Blocks'], [/steals?/i, 'Steals'], [/turnovers?/i, 'Turnovers'],
  [/rebounds?/i, 'Rebounds'], [/assists?/i, 'Assists'], [/points?/i, 'Points'],
  [/total\s+bases?/i, 'Total Bases'], [/home\s+runs?/i, 'Home Runs'], [/runs?\s+batted\s+in|rbi/i, 'RBI'],
  [/stolen\s+bases?/i, 'Stolen Bases'], [/hits?\s+allowed/i, 'Hits Allowed'], [/walks?\s+allowed/i, 'Walks Allowed'],
  [/pitching\s+outs?|outs?\s+recorded/i, 'Pitching Outs'], [/earned\s+runs?/i, 'Earned Runs'],
  [/pitches?\s+thrown|total\s+pitches?/i, 'Pitches Thrown'], [/strikeouts?|k'?s\b/i, 'Strikeouts'],
  [/hits?/i, 'Hits'], [/runs?\s+scored/i, 'Runs'],
  [/shots?\s+on\s+goal/i, 'Shots on Goal'], [/blocked\s+shots?/i, 'Blocked Shots'], [/saves?/i, 'Saves'],
  [/goals?\s+against/i, 'Goals Against'], [/goals?/i, 'Goals'],
  [/shots?\s+on\s+target/i, 'Shots on Target'], [/passes?\s+attempted/i, 'Passes Attempted'], [/tackles?/i, 'Tackles'],
  [/double\s+faults?/i, 'Double Faults'], [/aces?/i, 'Aces'], [/games?\s+won/i, 'Games Won'], [/sets?\s+won/i, 'Sets Won'],
]);

const cache = new Map();
const pending = new Map();
const list = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const text = (value) => String(value ?? '').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const int = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
};

function headers() {
  return {
    accept: 'application/json,text/plain,*/*', 'accept-language': 'en-US,en;q=0.9',
    'user-agent': UA, origin: 'https://sportsbook.fanduel.com', referer: 'https://sportsbook.fanduel.com/',
    'x-sportsbook-region': 'NJ',
  };
}
async function fetchJson(fetcher, url) {
  const response = await fetcher(url, { headers: headers(), signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!response.ok) throw Object.assign(new Error('FANDUEL_PUBLIC_HTTP'), { code: 'FANDUEL_PUBLIC_HTTP', status: response.status });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('FANDUEL_PUBLIC_TOO_LARGE'), { code: 'FANDUEL_PUBLIC_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('FANDUEL_PUBLIC_TOO_LARGE'), { code: 'FANDUEL_PUBLIC_TOO_LARGE' });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('FANDUEL_PUBLIC_INVALID_JSON'), { code: 'FANDUEL_PUBLIC_INVALID_JSON' }); }
}
function statMatch(value) {
  const source = text(value);
  for (const [re, label] of MARKET_PATTERNS) if (re.test(source)) return { re, label };
  return null;
}
function sideOf(value) {
  const source = text(value);
  if (/\b(?:over|more)\b/i.test(source)) return 'OVER';
  if (/\b(?:under|less)\b/i.test(source)) return 'UNDER';
  return null;
}
function number(value) {
  const direct = numeric(value);
  if (direct !== null) return direct;
  const raw = text(value).replace(/^\+/, '');
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}
function lineOf(runner) {
  const direct = number(runner?.handicap ?? runner?.line ?? runner?.points);
  if (direct !== null) return direct;
  const source = text(runner?.runnerName || runner?.name);
  const a = source.match(/\b(?:over|under|more|less)\s*\(?\s*([+-]?\d+(?:\.\d+)?)/i);
  if (a) return Number(a[1]);
  const b = source.match(/([+-]?\d+(?:\.\d+)?)\s*\)?\s*\b(?:over|under|more|less)\b/i);
  return b ? Number(b[1]) : null;
}
function oddsOf(runner) {
  const candidates = [
    runner?.winRunnerOdds?.americanDisplayOdds?.americanOdds,
    runner?.winRunnerOdds?.americanOdds,
    runner?.runnerOdds?.americanDisplayOdds?.americanOdds,
    runner?.runnerOdds?.americanOdds,
    runner?.americanOdds, runner?.price,
  ];
  for (const value of candidates) {
    const parsed = number(value);
    if (parsed !== null && parsed !== 0) return parsed;
  }
  return null;
}
function cleanPlayer(value, stat) {
  let source = text(value);
  if (!source) return '';
  source = source.replace(stat.re, ' ')
    .replace(/\b(?:over|under|more|less|player|total|alternate|alt|line|regular)\b/ig, ' ')
    .replace(/[+-]?\d+(?:\.\d+)?/g, ' ')
    .replace(/[()|:]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/^\s*[-/]\s*|\s*[-/]\s*$/g, ' ')
    .replace(/\s+/g, ' ').trim();
  source = source.replace(/^by\s+/i, '').replace(/\s+by$/i, '').trim();
  if (!source || /^(?:player|team|game|match|total|market)$/i.test(source)) return '';
  if (/\b(?:team total|game total|match total|1st quarter|first quarter|first half|second half|quarter|inning)\b/i.test(source)) return '';
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || !words.every((word) => /[A-Za-zÀ-ÖØ-öø-ÿ'.-]/.test(word))) return '';
  return source;
}
function playerOf(marketName, runnerName, stat) {
  const runner = cleanPlayer(runnerName, stat);
  const market = cleanPlayer(marketName, stat);
  if (runner && !/^(?:yes|no)$/i.test(runner)) return runner;
  return market;
}
function eventTeams(event) {
  const participants = list(event?.participants || event?.competitors);
  const home = participants.find((p) => /home/i.test(text(p?.role || p?.alignment || p?.type)))?.name || '';
  const away = participants.find((p) => /away/i.test(text(p?.role || p?.alignment || p?.type)))?.name || '';
  if (home || away) return { homeTeam: text(home), awayTeam: text(away) };
  const name = text(event?.name || event?.eventName);
  const at = name.split(/\s+@\s+/);
  if (at.length === 2) return { awayTeam: at[0].trim(), homeTeam: at[1].trim() };
  const vs = name.split(/\s+(?:v|vs\.?|versus)\s+/i);
  return vs.length === 2 ? { homeTeam: vs[0].trim(), awayTeam: vs[1].trim() } : { homeTeam: '', awayTeam: '' };
}
function eventStart(event) {
  return event?.openDate || event?.startTime || event?.start_time || event?.scheduledStart || null;
}
function validFuture(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) && ms > Date.now() - 60_000;
}
function eventIdOf(event) { return text(event?.eventId ?? event?.id); }
function marketIdOf(market) { return text(market?.marketId ?? market?.id); }
function unavailable(row) {
  return /^(?:suspended|closed|settled|removed|inactive)$/i.test(text(row?.marketStatus || row?.runnerStatus || row?.status));
}
function alternateMarket(market) {
  return market?.isAlternate === true || market?.alternate === true || /\b(?:alternate|alt\.?\s+line)\b|\b(?:1st|first|2nd|second)\s+(?:quarter|half|inning)\b|\bq[1-4]\b/i.test(text(market?.marketName || market?.name));
}
function parseEventPage(payload, sport, fallbackEvent) {
  const eventMap = list(payload?.attachments?.events || payload?.events);
  const event = eventMap.find((row) => eventIdOf(row) === eventIdOf(fallbackEvent)) || eventMap[0] || fallbackEvent || {};
  const eventId = eventIdOf(event) || eventIdOf(fallbackEvent);
  const start = eventStart(event) || eventStart(fallbackEvent);
  if (!eventId || !validFuture(start)) return [];
  const { homeTeam, awayTeam } = eventTeams(event);
  const groups = new Map();
  for (const market of list(payload?.attachments?.markets || payload?.markets)) {
    if (unavailable(market) || alternateMarket(market)) continue;
    const marketName = text(market?.marketName || market?.name || market?.marketType);
    const stat = statMatch(marketName);
    if (!stat) continue;
    for (const runner of list(market?.runners || market?.selections)) {
      if (unavailable(runner)) continue;
      const runnerName = text(runner?.runnerName || runner?.name || runner?.selectionName);
      const side = sideOf(runnerName);
      const line = lineOf(runner);
      if (!side || line === null) continue;
      const playerName = playerOf(marketName, runnerName, stat);
      if (!playerName) continue;
      const key = JSON.stringify([playerName.toLowerCase(), stat.label, line]);
      if (!groups.has(key)) groups.set(key, { playerName, market: stat.label, line, overOdds: null, underOdds: null, marketId: marketIdOf(market) });
      const group = groups.get(key);
      if (side === 'OVER') group.overOdds = oddsOf(runner);
      else group.underOdds = oddsOf(runner);
    }
  }
  const records = [];
  for (const group of groups.values()) {
    if (group.overOdds === null || group.underOdds === null) continue;
    const playerId = group.playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const parsed = record({
      sourceId: `${eventId}:${group.marketId || group.market}:${playerId}:${group.line}`,
      book: 'fanduel', nativePlayerId: playerId, playerName: group.playerName, sport,
      market: group.market, line: group.line, period: 'game', team: '', opponent: '',
      nativeEventId: eventId, homeTeam, awayTeam, gameStartTime: start,
      updatedAt: new Date().toISOString(), overOdds: group.overOdds, underOdds: group.underOdds,
      sides: ['OVER', 'UNDER'],
    });
    if (parsed) records.push(parsed);
  }
  return records;
}

export function fanDuelSupportedSports() { return Object.keys(SPORT_PAGES); }
export async function fetchFanDuelPublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  const pageId = SPORT_PAGES[sport];
  if (!pageId) throw Object.assign(new Error('FANDUEL_UNSUPPORTED_SPORT'), { code: 'FANDUEL_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const pageUrl = new URL(`${BASE}/content-managed-page`);
    pageUrl.searchParams.set('_ak', PUBLIC_KEY); pageUrl.searchParams.set('customPageId', pageId);
    pageUrl.searchParams.set('page', 'CUSTOM'); pageUrl.searchParams.set('timezone', 'America/New_York');
    const page = await fetchJson(fetcher, pageUrl);
    let events = list(page?.attachments?.events || page?.events).filter((event) => eventIdOf(event) && validFuture(eventStart(event)));
    events.sort((a, b) => Date.parse(eventStart(a)) - Date.parse(eventStart(b)));
    events = events.slice(0, int('AUTOSCOUT_FANDUEL_MAX_EVENTS_PER_SPORT', 6, 1, 20));
    const records = [];
    let successes = 0;
    let lastStatus = null;
    for (const event of events) {
      const eventUrl = new URL(`${BASE}/event-page`);
      eventUrl.searchParams.set('_ak', PUBLIC_KEY); eventUrl.searchParams.set('eventId', eventIdOf(event));
      eventUrl.searchParams.set('tab', 'popular');
      try {
        const payload = await fetchJson(fetcher, eventUrl);
        records.push(...parseEventPage(payload, sport, event)); successes += 1;
      } catch (error) { lastStatus = Number(error?.status) || null; }
      await sleep(360);
    }
    if (events.length && successes === 0) throw Object.assign(new Error('FANDUEL_EVENTS_UNAVAILABLE'), { code: 'FANDUEL_EVENTS_UNAVAILABLE', status: lastStatus });
    const value = { records, fetchedAt: new Date().toISOString(), endpoint: 'sbapi.nj.sportsbook.fanduel.com', transport: 'fanduel-public', eventsChecked: events.length };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; }
  finally { pending.delete(sport); }
}
