import { ingestionSignal } from './operation-deadline.mjs';
import { record } from './normalize.mjs';
import { numeric } from '../data-sources/espn/stat-contract.mjs';

const BASE = 'https://eu-offering-api.kambicdn.com/offering/v2018/rsiusnj';
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SPORT_PATHS = Object.freeze({ MLB: 'baseball/mlb', NBA: 'basketball/nba', NFL: 'american_football/nfl', NHL: 'ice_hockey/nhl' });
const TTL_MS = 5 * 60_000;
const MAX_BYTES = 20 * 1024 * 1024;
const cache = new Map();
const pending = new Map();
const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const int = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
};

function number(value) {
  const direct = numeric(value);
  if (direct !== null) return direct;
  const raw = text(value).replace(/^\+/, '');
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}
function decimalToAmerican(decimal) {
  const d = Number(decimal);
  if (!Number.isFinite(d) || d <= 1) return null;
  return Math.round(d >= 2 ? (d - 1) * 100 : -100 / (d - 1));
}
function oddsOf(outcome) {
  const american = number(outcome?.oddsAmerican);
  if (american !== null) return american;
  const scaled = Number(outcome?.odds);
  return Number.isFinite(scaled) && scaled > 1000 ? decimalToAmerican(scaled / 1000) : null;
}
function lineOf(outcome) {
  const raw = number(outcome?.line);
  if (raw === null) return null;
  return Math.abs(raw) >= 1000 ? raw / 1000 : raw;
}
function marketLabel(value) {
  const source = text(value).replace(/^player\s+/i, '').replace(/^total\s+/i, '').trim();
  const rules = [
    [/points\s*\+\s*rebounds\s*\+\s*assists|pts\s*\+\s*reb\s*\+\s*ast/i, 'Points + Rebounds + Assists'],
    [/passing\s+yards?/i, 'Passing Yards'], [/passing\s+(?:touchdowns?|tds?)/i, 'Passing Touchdowns'],
    [/rushing\s+yards?/i, 'Rushing Yards'], [/receiving\s+yards?/i, 'Receiving Yards'], [/receptions?/i, 'Receptions'],
    [/three[- ]?pointers?\s+made|3[- ]?pt\s+made/i, '3-PT Made'], [/rebounds?/i, 'Rebounds'], [/assists?/i, 'Assists'], [/points?/i, 'Points'],
    [/total\s+bases?|bases/i, 'Total Bases'], [/home\s+runs?/i, 'Home Runs'], [/runs?\s+batted\s+in|rbi/i, 'RBI'],
    [/hits?\s+allowed/i, 'Hits Allowed'], [/walks?\s+allowed/i, 'Walks Allowed'], [/pitching\s+outs?|outs?\s+recorded/i, 'Pitching Outs'],
    [/strikeouts?/i, 'Strikeouts'], [/hits?/i, 'Hits'], [/shots?\s+on\s+goal/i, 'Shots on Goal'], [/blocked\s+shots?/i, 'Blocked Shots'], [/saves?/i, 'Saves'], [/goals?/i, 'Goals'],
  ];
  for (const [re, label] of rules) if (re.test(source)) return label;
  return source && source.length <= 72 ? source : '';
}
async function fetchJson(fetcher, url) {
  const response = await fetcher(url, {
    headers: { accept: 'application/json,text/plain,*/*', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA, origin: 'https://ny.betrivers.com', referer: 'https://ny.betrivers.com/' },
    signal: ingestionSignal(AbortSignal.timeout(20_000)), redirect: 'follow',
  });
  if (!response.ok) throw Object.assign(new Error('BETRIVERS_PUBLIC_HTTP'), { code: 'BETRIVERS_PUBLIC_HTTP', status: response.status });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('BETRIVERS_PUBLIC_TOO_LARGE'), { code: 'BETRIVERS_PUBLIC_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('BETRIVERS_PUBLIC_TOO_LARGE'), { code: 'BETRIVERS_PUBLIC_TOO_LARGE' });
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('BETRIVERS_PUBLIC_INVALID_JSON'), { code: 'BETRIVERS_PUBLIC_INVALID_JSON' }); }
}
function futureEvent(event) {
  const ms = Date.parse(event?.start || '');
  return Number.isFinite(ms) && ms > Date.now() - 60_000 && text(event?.state || 'NOT_STARTED') === 'NOT_STARTED';
}
function parseOffers(sport, event, offers) {
  if (!futureEvent(event)) return [];
  const eventId = text(event?.id);
  const start = event?.start;
  const homeTeam = text(event?.homeName), awayTeam = text(event?.awayName);
  if (!eventId || !start || !homeTeam || !awayTeam) return [];
  const out = [];
  for (const offer of list(offers)) {
    if (text(offer?.eventId) !== eventId) continue;
    if (!list(offer?.tags).includes('MAIN_LINE') && list(offer?.tags).length && list(offer?.tags).some((tag) => /alternate|alt/i.test(text(tag)))) continue;
    const market = marketLabel(offer?.criterion?.label || offer?.betOfferType?.name);
    if (!market || /\b(?:team|game|match)\b/i.test(market)) continue;
    let playerName = '', line = null, overOdds = null, underOdds = null;
    for (const outcome of list(offer?.outcomes)) {
      if (text(outcome?.status).toUpperCase() !== 'OPEN') continue;
      const participant = text(outcome?.participant);
      if (participant && !playerName) playerName = participant;
      const label = text(outcome?.label).toLowerCase(), type = text(outcome?.type).toUpperCase();
      const side = label.includes('over') || type === 'OT_OVER' ? 'OVER' : label.includes('under') || type === 'OT_UNDER' ? 'UNDER' : null;
      if (!side) continue;
      const odds = oddsOf(outcome), point = lineOf(outcome);
      if (odds === null || point === null) continue;
      if (line === null) line = point;
      if (Math.abs(line - point) > 1e-9) continue;
      if (side === 'OVER') overOdds = odds; else underOdds = odds;
    }
    const words = playerName.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6 || line === null || overOdds === null || underOdds === null) continue;
    const playerId = playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const parsed = record({
      sourceId: `${eventId}:${text(offer?.id || offer?.criterion?.id || market)}:${playerId}:${line}`, book: 'betrivers', nativePlayerId: playerId,
      playerName, sport, market, line, period: 'game', team: '', opponent: '', nativeEventId: eventId,
      homeTeam, awayTeam, gameStartTime: start, updatedAt: new Date().toISOString(), overOdds, underOdds, sides: ['OVER','UNDER'],
    });
    if (parsed) out.push(parsed);
  }
  return out;
}

export function betRiversSupportedSports() { return Object.keys(SPORT_PATHS); }
export async function fetchBetRiversPublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  const path = SPORT_PATHS[sport];
  if (!path) throw Object.assign(new Error('BETRIVERS_UNSUPPORTED_SPORT'), { code: 'BETRIVERS_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const listUrl = `${BASE}/listView/${path}/all/all/matches.json?lang=en_US&market=US`;
    const payload = await fetchJson(fetcher, listUrl);
    let wrappers = list(payload?.events).filter((wrapper) => futureEvent(wrapper?.event));
    wrappers.sort((a, b) => Date.parse(a.event.start) - Date.parse(b.event.start));
    wrappers = wrappers.slice(0, int('AUTOSCOUT_BETRIVERS_MAX_EVENTS_PER_SPORT', 6, 1, 20));
    const records = [];
    let successes = 0, lastStatus = null;
    for (const wrapper of wrappers) {
      const event = wrapper.event;
      try {
        const eventPayload = await fetchJson(fetcher, `${BASE}/betoffer/event/${encodeURIComponent(event.id)}.json?lang=en_US&market=US`);
        records.push(...parseOffers(sport, event, eventPayload?.betOffers)); successes += 1;
      } catch (error) { lastStatus = Number(error?.status) || null; }
    }
    if (wrappers.length && successes === 0) throw Object.assign(new Error('BETRIVERS_EVENTS_UNAVAILABLE'), { code: 'BETRIVERS_EVENTS_UNAVAILABLE', status: lastStatus });
    const value = { records, fetchedAt: new Date().toISOString(), endpoint: 'eu-offering-api.kambicdn.com', transport: 'betrivers-public', eventsChecked: wrappers.length };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; } finally { pending.delete(sport); }
}
