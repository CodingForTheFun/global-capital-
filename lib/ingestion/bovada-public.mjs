import { record } from './normalize.mjs';
import { numeric } from '../data-sources/espn/stat-contract.mjs';

const BASE = 'https://www.bovada.lv/services/sports/event/coupon/events/A/description';
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SPORT_PATHS = Object.freeze({
  MLB: 'baseball/mlb', NBA: 'basketball/nba', NFL: 'football/nfl', NHL: 'hockey/nhl',
  NCAAF: 'football/college-football', NCAAB: 'basketball/college-basketball',
});
const TTL_MS = 5 * 60_000;
const MAX_BYTES = 24 * 1024 * 1024;
const cache = new Map();
const pending = new Map();
const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];

function number(value) {
  const direct = numeric(value);
  if (direct !== null) return direct;
  const raw = text(value).replace(/^\+/, '');
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}
function marketLabel(value) {
  const source = text(value).replace(/^total\s+/i, '').trim();
  const rules = [
    [/points\s*\+\s*rebounds\s*\+\s*assists|pts\s*\+\s*reb\s*\+\s*ast/i, 'Points + Rebounds + Assists'],
    [/passing\s+yards?/i, 'Passing Yards'], [/passing\s+(?:touchdowns?|tds?)/i, 'Passing Touchdowns'],
    [/rushing\s+yards?/i, 'Rushing Yards'], [/receiving\s+yards?/i, 'Receiving Yards'], [/receptions?/i, 'Receptions'],
    [/three[- ]?pointers?\s+made|3[- ]?pt\s+made/i, '3-PT Made'], [/rebounds?/i, 'Rebounds'], [/assists?/i, 'Assists'], [/points?/i, 'Points'],
    [/total\s+bases?|bases/i, 'Total Bases'], [/home\s+runs?/i, 'Home Runs'], [/runs?\s+batted\s+in|rbi/i, 'RBI'],
    [/hits?\s+allowed/i, 'Hits Allowed'], [/walks?\s+allowed/i, 'Walks Allowed'], [/pitching\s+outs?|outs?\s+recorded/i, 'Pitching Outs'],
    [/strikeouts?/i, 'Strikeouts'], [/hits?/i, 'Hits'], [/runs?\s+scored|runs?/i, 'Runs'],
    [/shots?\s+on\s+goal/i, 'Shots on Goal'], [/blocked\s+shots?/i, 'Blocked Shots'], [/saves?/i, 'Saves'], [/goals?/i, 'Goals'],
  ];
  for (const [re, label] of rules) if (re.test(source)) return label;
  return source && source.length <= 72 ? source : '';
}
function eventTeams(event) {
  let home = '', away = '';
  for (const competitor of list(event?.competitors)) {
    if (competitor?.home === true) home = text(competitor?.name);
    else away = text(competitor?.name);
  }
  return { homeTeam: home, awayTeam: away };
}
function startIso(event) {
  const raw = event?.startTime;
  if (Number.isFinite(Number(raw))) {
    const ms = Number(raw);
    const date = new Date(ms > 10_000_000_000 ? ms : ms * 1000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const ms = Date.parse(raw || '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function playerFromDescription(description) {
  const source = text(description);
  if (!source.includes(' - ')) return '';
  const value = source.split(' - ', 2)[1].replace(/\s*\([^)]*\)\s*$/, '').trim();
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 6 ? value : '';
}
function american(outcome) { return number(outcome?.price?.american ?? outcome?.americanOdds); }
function handicap(outcome, market) { return number(outcome?.price?.handicap ?? outcome?.handicap ?? market?.line); }
function parseEvent(event, sport) {
  if (event?.live === true) return [];
  const gameStartTime = startIso(event);
  if (!gameStartTime || Date.parse(gameStartTime) <= Date.now() - 60_000) return [];
  const { homeTeam, awayTeam } = eventTeams(event);
  const eventId = text(event?.id);
  if (!eventId) return [];
  const out = [];
  for (const group of list(event?.displayGroups)) {
    if (/^game lines$/i.test(text(group?.description))) continue;
    for (const market of list(group?.markets)) {
      if (text(market?.status).toUpperCase() !== 'O' || /alternate|alt\.?\s+line|1st quarter|first quarter|first half|second half|inning/i.test(text(market?.description))) continue;
      const description = text(market?.description);
      const playerName = playerFromDescription(description);
      const label = marketLabel(description.split(' - ', 1)[0]);
      if (!playerName || !label) continue;
      let line = null, overOdds = null, underOdds = null;
      for (const outcome of list(market?.outcomes)) {
        if (text(outcome?.status).toUpperCase() !== 'O') continue;
        const name = text(outcome?.description).toLowerCase();
        const side = name.includes('over') ? 'OVER' : name.includes('under') ? 'UNDER' : null;
        if (!side) continue;
        const price = american(outcome), point = handicap(outcome, market);
        if (price === null || point === null) continue;
        if (line === null) line = point;
        if (Math.abs(line - point) > 1e-9) continue;
        if (side === 'OVER') overOdds = price; else underOdds = price;
      }
      if (line === null || overOdds === null || underOdds === null) continue;
      const playerId = playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const parsed = record({
        sourceId: `${eventId}:${text(market?.id || description)}:${playerId}:${line}`, book: 'bvda', nativePlayerId: playerId,
        playerName, sport, market: label, line, period: 'game', team: '', opponent: '', nativeEventId: eventId,
        homeTeam, awayTeam, gameStartTime, updatedAt: new Date().toISOString(), overOdds, underOdds, sides: ['OVER','UNDER'],
      });
      if (parsed) out.push(parsed);
    }
  }
  return out;
}
async function fetchJson(fetcher, url) {
  const response = await fetcher(url, { headers: { accept: 'application/json,text/plain,*/*', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!response.ok) throw Object.assign(new Error('BOVADA_PUBLIC_HTTP'), { code: 'BOVADA_PUBLIC_HTTP', status: response.status });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('BOVADA_PUBLIC_TOO_LARGE'), { code: 'BOVADA_PUBLIC_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('BOVADA_PUBLIC_TOO_LARGE'), { code: 'BOVADA_PUBLIC_TOO_LARGE' });
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('BOVADA_PUBLIC_INVALID_JSON'), { code: 'BOVADA_PUBLIC_INVALID_JSON' }); }
}

export function bovadaSupportedSports() { return Object.keys(SPORT_PATHS); }
export async function fetchBovadaPublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  const path = SPORT_PATHS[sport];
  if (!path) throw Object.assign(new Error('BOVADA_UNSUPPORTED_SPORT'), { code: 'BOVADA_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const payload = await fetchJson(fetcher, `${BASE}/${path}?lang=en`);
    const events = Array.isArray(payload) && payload.length ? list(payload[0]?.events) : [];
    const records = events.flatMap((event) => parseEvent(event, sport));
    const value = { records, fetchedAt: new Date().toISOString(), endpoint: 'www.bovada.lv', transport: 'bovada-public', eventsChecked: events.length };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; } finally { pending.delete(sport); }
}
