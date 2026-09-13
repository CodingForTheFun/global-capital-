import { record } from './normalize.mjs';
import { http2JsonFetch } from './http2-json-fetch.mjs';

const BASE = 'https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1';
const LEAGUES = Object.freeze({ NFL: 88808, NBA: 42648, MLB: 84240, NHL: 42133 });
const TTL_MS = 10 * 60_000;
const MAX_BYTES = 24 * 1024 * 1024;
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const cache = new Map();
const pending = new Map();
const text = (v) => String(v ?? '').trim();
const list = (v) => Array.isArray(v) ? v : [];
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const int = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

const MARKET_SUFFIXES = Object.freeze({
  NFL: [
    ['Passing Yards', /\s+(?:passing|pass)\s+yards?(?:\s+o\/u)?$/i],
    ['Passing Touchdowns', /\s+(?:passing|pass)\s+(?:touchdowns?|tds?)(?:\s+o\/u)?$/i],
    ['Passing Attempts', /\s+(?:passing|pass)\s+attempts?(?:\s+o\/u)?$/i],
    ['Passing Completions', /\s+(?:passing\s+)?completions?(?:\s+o\/u)?$/i],
    ['Passing Interceptions', /\s+(?:passing\s+)?interceptions?(?:\s+o\/u)?$/i],
    ['Rushing Yards', /\s+rushing\s+yards?(?:\s+o\/u)?$/i],
    ['Rushing Attempts', /\s+rushing\s+attempts?(?:\s+o\/u)?$/i],
    ['Receiving Yards', /\s+receiving\s+yards?(?:\s+o\/u)?$/i],
    ['Receptions', /\s+receptions?(?:\s+o\/u)?$/i],
    ['Tackles + Assists', /\s+tackles?\s*\+\s*assists?(?:\s+o\/u)?$/i],
    ['Sacks', /\s+sacks?(?:\s+o\/u)?$/i],
    ['Field Goals Made', /\s+field\s+goals?\s+made(?:\s+o\/u)?$/i],
    ['Kicking Points', /\s+kicking\s+points?(?:\s+o\/u)?$/i],
  ],
  NBA: [
    ['Points + Rebounds + Assists', /\s+(?:points?|pts)\s*\+\s*(?:rebounds?|reb)\s*\+\s*(?:assists?|ast)(?:\s+o\/u)?$/i],
    ['Points + Rebounds', /\s+(?:points?|pts)\s*\+\s*(?:rebounds?|reb)(?:\s+o\/u)?$/i],
    ['Points + Assists', /\s+(?:points?|pts)\s*\+\s*(?:assists?|ast)(?:\s+o\/u)?$/i],
    ['Rebounds + Assists', /\s+(?:rebounds?|reb)\s*\+\s*(?:assists?|ast)(?:\s+o\/u)?$/i],
    ['Points', /\s+(?:points?|pts)(?:\s+o\/u)?$/i],
    ['Rebounds', /\s+(?:rebounds?|reb)(?:\s+o\/u)?$/i],
    ['Assists', /\s+(?:assists?|ast)(?:\s+o\/u)?$/i],
    ['3-PT Made', /\s+(?:3[- ]?pt|3[- ]?pointers?|threes?)\s+(?:made)?(?:\s+o\/u)?$/i],
    ['Blocks', /\s+blocks?(?:\s+o\/u)?$/i],
    ['Steals', /\s+steals?(?:\s+o\/u)?$/i],
    ['Turnovers', /\s+turnovers?(?:\s+o\/u)?$/i],
  ],
  MLB: [
    ['Total Bases', /\s+total\s+bases?(?:\s+o\/u)?$/i],
    ['Hits Allowed', /\s+hits?\s+allowed(?:\s+o\/u)?$/i],
    ['Walks Allowed', /\s+walks?\s+allowed(?:\s+o\/u)?$/i],
    ['Pitching Outs', /\s+(?:pitching\s+)?outs?(?:\s+recorded)?(?:\s+o\/u)?$/i],
    ['Earned Runs', /\s+earned\s+runs?(?:\s+o\/u)?$/i],
    ['Pitches Thrown', /\s+(?:pitches?|pitches\s+thrown)(?:\s+o\/u)?$/i],
    ['Home Runs', /\s+home\s+runs?(?:\s+o\/u)?$/i],
    ['Stolen Bases', /\s+stolen\s+bases?(?:\s+o\/u)?$/i],
    ['RBI', /\s+(?:rbis?|runs\s+batted\s+in)(?:\s+o\/u)?$/i],
    ['Strikeouts', /\s+strikeouts?(?:\s+o\/u)?$/i],
    ['Hits', /\s+hits?(?:\s+o\/u)?$/i],
    ['Runs', /\s+runs?(?:\s+o\/u)?$/i],
  ],
  NHL: [
    ['Shots on Goal', /\s+shots?\s+on\s+goal(?:\s+o\/u)?$/i],
    ['Blocked Shots', /\s+blocked\s+shots?(?:\s+o\/u)?$/i],
    ['Goals Against', /\s+goals?\s+against(?:\s+o\/u)?$/i],
    ['Saves', /\s+saves?(?:\s+o\/u)?$/i],
    ['Points', /\s+points?(?:\s+o\/u)?$/i],
    ['Assists', /\s+assists?(?:\s+o\/u)?$/i],
    ['Goals', /\s+goals?(?:\s+o\/u)?$/i],
  ],
});

function headers() {
  return { accept: 'application/json,text/plain,*/*', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA, origin: 'https://sportsbook.draftkings.com', referer: 'https://sportsbook.draftkings.com/' };
}
async function directJson(fetcher, url) {
  const response = await fetcher(url, { headers: headers(), redirect: 'follow', signal: AbortSignal.timeout(18_000) });
  if (!response.ok) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_HTTP'), { code: 'DRAFTKINGS_SPORTSBOOK_HTTP', status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_TOO_LARGE'), { code: 'DRAFTKINGS_SPORTSBOOK_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_TOO_LARGE'), { code: 'DRAFTKINGS_SPORTSBOOK_TOO_LARGE' });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_INVALID_JSON'), { code: 'DRAFTKINGS_SPORTSBOOK_INVALID_JSON' }); }
}
async function fetchJson(fetcher, url) {
  try { return { data: await directJson(fetcher, url), transport: 'draftkings-sportscontent-public' }; }
  catch (error) {
    if (fetcher !== globalThis.fetch) throw error;
    const data = await http2JsonFetch(url, { timeoutMs: 18_000, headers: { origin: 'https://sportsbook.draftkings.com', referer: 'https://sportsbook.draftkings.com/' } });
    return { data, transport: 'draftkings-sportscontent-http2' };
  }
}
function american(value) {
  const raw = text(value).replace(/[−–—]/g, '-').toUpperCase();
  if (['EVEN','EV','PK'].includes(raw)) return 100;
  if (!/^[+-]?\d+$/.test(raw)) return null;
  const n = Number(raw); return Number.isFinite(n) ? n : null;
}
function eventTeams(name) {
  const raw = text(name);
  for (const sep of [' @ ', ' vs. ', ' vs ', ' v ']) {
    if (!raw.includes(sep)) continue;
    const [away, home] = raw.split(sep, 2).map(text);
    return { awayTeam: away, homeTeam: home };
  }
  return { awayTeam: '', homeTeam: '' };
}
function futureEvent(event) {
  const start = Date.parse(event?.startEventDate || event?.startDate || event?.startTime || '');
  if (!Number.isFinite(start) || start <= Date.now() - 60_000) return false;
  if (event?.isLive === true || event?.live === true) return false;
  return !/live|started|in.?progress|final|closed/i.test(text(event?.status || event?.eventStatus));
}
function parseMarket(sport, name) {
  const raw = text(name).replace(/\s+/g, ' ');
  if (!raw || /\b(?:alternate|alt\.?|quarter|half|1st inning|first inning|live)\b/i.test(raw)) return null;
  for (const [market, re] of MARKET_SUFFIXES[sport] || []) {
    const match = raw.match(re);
    if (!match) continue;
    const playerName = raw.slice(0, match.index).replace(/\s*[-–—:]\s*$/, '').trim();
    if (!playerName || playerName.split(/\s+/).length < 2 || playerName.length > 80) return null;
    return { playerName, market };
  }
  return null;
}
function categoryCandidates(metadata) {
  const categories = list(metadata?.categories);
  const eligible = categories.filter((row) => {
    const name = text(row?.name);
    if (!name || /future|season|award|milestone|leader|team|game lines?|quarter|half/i.test(name)) return false;
    return /player|passing|rushing|receiving|pitcher|batter|goalie|skater|points|rebounds|assists|strikeouts|hits/i.test(name);
  });
  const score = (name) => {
    name = text(name).toLowerCase();
    if (/player props?/.test(name)) return 0;
    if (/passing|rushing|receiving|pitcher|batter|goalie|skater/.test(name)) return 1;
    return 2;
  };
  return eligible.sort((a,b) => score(a?.name) - score(b?.name)).slice(0, int('AUTOSCOUT_DK_SB_MAX_CATEGORIES_PER_SPORT', 4, 1, 8));
}
function parseDocument(sport, doc) {
  const events = new Map(list(doc?.events).map((event) => [String(event?.id), event]));
  const selectionsByMarket = new Map();
  for (const selection of list(doc?.selections)) {
    const id = String(selection?.marketId ?? '');
    if (!id) continue;
    if (!selectionsByMarket.has(id)) selectionsByMarket.set(id, []);
    selectionsByMarket.get(id).push(selection);
  }
  const grouped = new Map();
  const touchedEvents = new Set();
  for (const marketRow of list(doc?.markets)) {
    if (marketRow?.isAlternate === true || /suspend|closed|settled/i.test(text(marketRow?.status))) continue;
    const event = events.get(String(marketRow?.eventId ?? ''));
    if (!event || !futureEvent(event)) continue;
    const parsed = parseMarket(sport, marketRow?.name);
    if (!parsed) continue;
    const { playerName, market } = parsed;
    const lines = new Map();
    for (const selection of selectionsByMarket.get(String(marketRow?.id)) || []) {
      if (selection?.isAlternate === true || /suspend|closed|settled/i.test(text(selection?.status))) continue;
      const label = text(selection?.label);
      const side = /^over\b/i.test(label) ? 'OVER' : /^under\b/i.test(label) ? 'UNDER' : null;
      const line = num(selection?.points);
      const odds = american(selection?.displayOdds?.american);
      if (!side || line === null || odds === null) continue;
      const key = String(line);
      if (!lines.has(key)) lines.set(key, { line, overOdds: null, underOdds: null });
      if (side === 'OVER') lines.get(key).overOdds = odds;
      else lines.get(key).underOdds = odds;
    }
    const complete = [...lines.values()].filter((row) => row.overOdds !== null && row.underOdds !== null);
    if (complete.length !== 1) continue;
    const pair = complete[0];
    const eventId = String(event?.id ?? marketRow?.eventId ?? '');
    const playerId = playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { homeTeam, awayTeam } = eventTeams(event?.name);
    const normalized = record({
      sourceId: `${eventId}:${marketRow?.id}:${pair.line}`,
      book: 'draftkings', nativePlayerId: playerId, playerName, sport, market, line: pair.line,
      period: 'game', team: '', opponent: '', nativeEventId: eventId, homeTeam, awayTeam,
      gameStartTime: event?.startEventDate || event?.startDate || event?.startTime,
      updatedAt: null, overOdds: pair.overOdds, underOdds: pair.underOdds, sides: ['OVER','UNDER'],
    });
    if (!normalized) continue;
    touchedEvents.add(eventId);
    grouped.set([eventId, playerId, market, pair.line].join('|'), normalized);
  }
  return { records: [...grouped.values()], eventsChecked: touchedEvents.size };
}

export function draftKingsSportsbookSupportedSports() { return Object.keys(LEAGUES); }
export async function fetchDraftKingsSportsbookPublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  const leagueId = LEAGUES[sport];
  if (!leagueId) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_UNSUPPORTED_SPORT'), { code: 'DRAFTKINGS_SPORTSBOOK_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const meta = await fetchJson(fetcher, `${BASE}/leagues/${leagueId}`);
    const categories = categoryCandidates(meta.data);
    if (!categories.length) throw Object.assign(new Error('DRAFTKINGS_NO_PLAYER_PROP_CATEGORIES'), { code: 'DRAFTKINGS_NO_PLAYER_PROP_CATEGORIES' });
    const all = new Map();
    let eventsChecked = 0;
    let transport = meta.transport;
    for (const category of categories) {
      const id = category?.id;
      if (id == null) continue;
      const result = await fetchJson(fetcher, `${BASE}/leagues/${leagueId}/categories/${encodeURIComponent(id)}`);
      transport = result.transport;
      const parsed = parseDocument(sport, result.data);
      eventsChecked += parsed.eventsChecked;
      for (const row of parsed.records) all.set([row.nativeEventId,row.nativePlayerId,row.market,row.line].join('|'), row);
    }
    const value = { records: [...all.values()], fetchedAt: new Date().toISOString(), endpoint: 'sportsbook-nash.draftkings.com', transport, eventsChecked, categoriesChecked: categories.length };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; }
  finally { pending.delete(sport); }
}
