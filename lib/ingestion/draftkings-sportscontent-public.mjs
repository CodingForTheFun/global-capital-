import { record } from './normalize.mjs';
import { http2JsonFetch } from './http2-json-fetch.mjs';
import { browserJsonFetch } from './browser-json-fetch.mjs';

const LEAGUES = Object.freeze({ NFL: 88808, NBA: 42648, MLB: 84240, NHL: 42133 });
const BASE = 'https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1';
const TTL_MS = 10 * 60_000;
const MAX_BYTES = 32 * 1024 * 1024;
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const cache = new Map();
const pending = new Map();

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const int = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const numeric = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = text(value).replace(/[−–—]/g, '-').replace(/^\+/, '');
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) ? Number(raw) : null;
};

const MARKET_RULES = Object.freeze({
  NFL: [
    ['Passing Yards', /passing\s+(?:yards?|yds?)/i], ['Passing Touchdowns', /passing\s+(?:touchdowns?|tds?)/i],
    ['Passing Attempts', /passing\s+attempts?/i], ['Passing Completions', /(?:passing\s+)?completions?/i],
    ['Passing Interceptions', /(?:passing\s+)?interceptions?(?:\s+thrown)?/i], ['Rushing Yards', /rushing\s+(?:yards?|yds?)/i],
    ['Rushing Attempts', /rushing\s+attempts?|carries/i], ['Rushing Touchdowns', /rushing\s+(?:touchdowns?|tds?)/i],
    ['Receiving Yards', /receiving\s+(?:yards?|yds?)/i], ['Receptions', /\breceptions?\b/i],
    ['Receiving Touchdowns', /receiving\s+(?:touchdowns?|tds?)/i], ['Longest Reception', /longest\s+reception/i],
    ['Tackles + Assists', /tackles?\s*\+\s*assists?/i], ['Solo Tackles', /solo\s+tackles?/i], ['Sacks', /\bsacks?\b/i],
    ['Field Goals Made', /field\s+goals?\s+made/i], ['Kicking Points', /kicking\s+points?/i],
  ],
  NBA: [
    ['Points + Rebounds + Assists', /(?:points?|pts)\s*\+\s*(?:rebounds?|reb)\s*\+\s*(?:assists?|ast)/i],
    ['Points + Rebounds', /(?:points?|pts)\s*\+\s*(?:rebounds?|reb)/i], ['Points + Assists', /(?:points?|pts)\s*\+\s*(?:assists?|ast)/i],
    ['Rebounds + Assists', /(?:rebounds?|reb)\s*\+\s*(?:assists?|ast)/i], ['3-PT Made', /(?:3[- ]?pt|3[- ]?pointers?|three[- ]?pointers?|threes?).*made/i],
    ['Points', /\b(?:points?|pts)\b/i], ['Rebounds', /\b(?:rebounds?|reb)\b/i], ['Assists', /\b(?:assists?|ast)\b/i],
    ['Blocks', /\bblocks?\b/i], ['Steals', /\bsteals?\b/i], ['Turnovers', /\bturnovers?\b/i],
  ],
  MLB: [
    ['Hits Allowed', /hits?\s+allowed/i], ['Walks Allowed', /walks?\s+allowed/i], ['Pitching Outs', /(?:pitching\s+)?outs?(?:\s+recorded)?/i],
    ['Pitches Thrown', /pitches?(?:\s+thrown)?/i], ['Earned Runs', /earned\s+runs?/i], ['Total Bases', /total\s+bases?/i],
    ['Home Runs', /home\s+runs?/i], ['Stolen Bases', /stolen\s+bases?/i], ['RBI', /(?:rbis?|runs\s+batted\s+in)/i],
    ['Strikeouts', /strikeouts?/i], ['Hits', /\bhits?\b/i], ['Runs', /\bruns?\b/i],
  ],
  NHL: [
    ['Shots on Goal', /shots?\s+on\s+goal/i], ['Blocked Shots', /blocked\s+shots?/i], ['Goals Against', /goals?\s+against/i],
    ['Saves', /\bsaves?\b/i], ['Points', /\bpoints?\b/i], ['Assists', /\bassists?\b/i], ['Goals', /\bgoals?\b/i],
  ],
});

function headers() {
  return {
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': UA,
    origin: 'https://sportsbook.draftkings.com',
    referer: 'https://sportsbook.draftkings.com/',
  };
}
async function readJson(response) {
  if (!response.ok) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_HTTP'), { code: 'DRAFTKINGS_SPORTSCONTENT_HTTP', status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_TOO_LARGE'), { code: 'DRAFTKINGS_SPORTSCONTENT_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_TOO_LARGE'), { code: 'DRAFTKINGS_SPORTSCONTENT_TOO_LARGE' });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_INVALID_JSON'), { code: 'DRAFTKINGS_SPORTSCONTENT_INVALID_JSON' }); }
}
async function transportJson(url, fetcher) {
  try {
    const response = await fetcher(url, { headers: headers(), redirect: 'follow', signal: AbortSignal.timeout(14_000) });
    return { data: await readJson(response), transport: 'draftkings-sportscontent-public' };
  } catch (directError) {
    if (fetcher !== globalThis.fetch) throw directError;
    try {
      const data = await http2JsonFetch(url, { timeoutMs: 14_000, headers: headers(), maxRedirects: 3 });
      return { data, transport: 'draftkings-sportscontent-http2' };
    } catch {
      const data = await browserJsonFetch(url, {
        origin: 'https://sportsbook.draftkings.com',
        referer: 'https://sportsbook.draftkings.com/',
        userAgent: UA,
        timeoutMs: 18_000,
      });
      return { data, transport: 'draftkings-sportscontent-browser' };
    }
  }
}
function canonicalMarket(sport, value) {
  const raw = text(value).replace(/\s+/g, ' ');
  if (!raw || /\b(?:alternate|alt\.?|quarter|half|period|inning|live|team total|game total)\b/i.test(raw)) return null;
  for (const [market, re] of MARKET_RULES[sport] || []) if (re.test(raw)) return { market, re };
  return null;
}
function propLikeSubcategory(sport, categoryName, subcategoryName) {
  const combined = `${text(categoryName)} ${text(subcategoryName)}`.replace(/\s+/g, ' ');
  if (/\b(?:alternate|alt\.?|quarter|half|period|inning|futures?|awards?|team props?|game lines?|same game|sgp)\b/i.test(combined)) return false;
  if (canonicalMarket(sport, combined)) return true;
  return /\b(?:player|pitcher|batter|passing|rushing|receiving|receptions?|tackles?|sacks?|kicking|points?|rebounds?|assists?|steals?|blocks?|turnovers?|strikeouts?|hits?|runs?|bases?|shots?|saves?|goals?)\b/i.test(combined);
}
function discoverSubcategories(sport, data) {
  const categories = new Map(list(data?.categories).map((row) => [text(row?.id), text(row?.name)]));
  const found = [];
  for (const sub of list(data?.subcategories)) {
    const categoryId = text(sub?.categoryId);
    const subcategoryId = text(sub?.id);
    const categoryName = categories.get(categoryId) || '';
    const subcategoryName = text(sub?.name);
    if (!categoryId || !subcategoryId || !propLikeSubcategory(sport, categoryName, subcategoryName)) continue;
    const score = /player\s*props?/i.test(categoryName) ? 0 : canonicalMarket(sport, subcategoryName) ? 1 : /player/i.test(`${categoryName} ${subcategoryName}`) ? 2 : 3;
    found.push({ categoryId, subcategoryId, categoryName, subcategoryName, score });
  }
  const seen = new Set();
  return found
    .sort((a, b) => a.score - b.score || a.categoryName.localeCompare(b.categoryName) || a.subcategoryName.localeCompare(b.subcategoryName))
    .filter((row) => {
      const key = `${row.categoryId}:${row.subcategoryId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, int('AUTOSCOUT_DK_SB_MAX_CATEGORIES_PER_SPORT', 12, 1, 24));
}
function american(selection) {
  return numeric(selection?.displayOdds?.american ?? selection?.oddsAmerican ?? selection?.americanOdds);
}
function side(selection) {
  const raw = `${text(selection?.label)} ${text(selection?.name)}`;
  if (/\bover\b/i.test(raw)) return 'OVER';
  if (/\bunder\b/i.test(raw)) return 'UNDER';
  return null;
}
function lineOf(selection) {
  for (const value of [selection?.points, selection?.line, selection?.handicap]) {
    const n = numeric(value);
    if (n !== null) return n;
  }
  const match = text(selection?.label).match(/\b(?:over|under)\s*([+-]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}
function cleanPlayer(marketName, stat) {
  let raw = text(marketName).replace(/\s+/g, ' ');
  raw = raw.replace(stat.re, ' ')
    .replace(/\b(?:o\/?u|over\/under|over|under|player|props?|total|regular|line)\b/ig, ' ')
    .replace(/[|():]/g, ' ').replace(/[–—]/g, '-').replace(/^\s*[-/]\s*|\s*[-/]\s*$/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || /\b(?:team|game|match|home|away)\b/i.test(raw)) return '';
  if (!words.every((word) => /[A-Za-zÀ-ÖØ-öø-ÿ'.-]/.test(word))) return '';
  return raw;
}
function eventStart(event) { return event?.startEventDate || event?.startDate || event?.startTime || null; }
function futureEvent(event) {
  const start = Date.parse(eventStart(event) || '');
  return Number.isFinite(start) && start > Date.now() - 60_000 && event?.isLive !== true && !/live|started|final|closed|settled/i.test(text(event?.status));
}
function eventTeams(event) {
  let homeTeam = '', awayTeam = '';
  for (const participant of list(event?.participants)) {
    const role = text(participant?.venueRole ?? participant?.role).toLowerCase();
    const name = text(participant?.name ?? participant?.displayName);
    if (role === 'home') homeTeam = name;
    if (role === 'away') awayTeam = name;
  }
  if (homeTeam || awayTeam) return { homeTeam, awayTeam };
  const raw = text(event?.name ?? event?.eventName);
  for (const sep of [' @ ', ' at ', ' vs. ', ' vs ']) {
    if (!raw.includes(sep)) continue;
    const [left, right] = raw.split(sep, 2).map(text);
    return sep.trim() === '@' || sep.trim() === 'at' ? { awayTeam: left, homeTeam: right } : { homeTeam: left, awayTeam: right };
  }
  return { homeTeam: '', awayTeam: '' };
}
function parsePayload(sport, data) {
  const events = new Map();
  for (const event of list(data?.events)) {
    const id = text(event?.id ?? event?.eventId);
    if (id) events.set(id, event);
  }
  const selectionsByMarket = new Map();
  for (const selection of list(data?.selections)) {
    const marketId = text(selection?.marketId);
    if (!marketId) continue;
    if (!selectionsByMarket.has(marketId)) selectionsByMarket.set(marketId, []);
    selectionsByMarket.get(marketId).push(selection);
  }
  const candidates = new Map();
  for (const market of list(data?.markets)) {
    if (market?.isAlternate === true || /alternate|alt\.?/i.test(text(market?.name))) continue;
    const marketId = text(market?.id ?? market?.marketId);
    const eventId = text(market?.eventId);
    const event = events.get(eventId);
    if (!marketId || !event || !futureEvent(event)) continue;
    const stat = canonicalMarket(sport, market?.name);
    if (!stat) continue;
    const playerName = cleanPlayer(market?.name, stat);
    if (!playerName) continue;
    for (const selection of selectionsByMarket.get(marketId) || []) {
      const whichSide = side(selection);
      const line = lineOf(selection);
      const odds = american(selection);
      if (!whichSide || line === null || odds === null || odds === 0) continue;
      const key = `${eventId}|${playerName.toLowerCase()}|${stat.market}|${line}`;
      if (!candidates.has(key)) candidates.set(key, { event, eventId, marketId, playerName, market: stat.market, line, overOdds: null, underOdds: null });
      const row = candidates.get(key);
      if (whichSide === 'OVER') row.overOdds = odds; else row.underOdds = odds;
    }
  }
  const grouped = new Map();
  for (const row of candidates.values()) {
    if (row.overOdds === null || row.underOdds === null) continue;
    const key = `${row.eventId}|${row.playerName.toLowerCase()}|${row.market}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const records = [];
  const touchedEvents = new Set();
  for (const rows of grouped.values()) {
    // Multiple complete thresholds are an alternate ladder. Keep only unambiguous main O/U lines.
    if (rows.length !== 1) continue;
    const row = rows[0];
    const { homeTeam, awayTeam } = eventTeams(row.event);
    const playerId = row.playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const normalized = record({
      sourceId: `${row.eventId}:${row.marketId}:${playerId}:${row.line}`,
      book: 'draftkings', nativePlayerId: playerId, playerName: row.playerName, sport,
      market: row.market, line: row.line, period: 'game', team: '', opponent: '', nativeEventId: row.eventId,
      homeTeam, awayTeam, gameStartTime: eventStart(row.event), updatedAt: new Date().toISOString(),
      overOdds: row.overOdds, underOdds: row.underOdds, sides: ['OVER', 'UNDER'],
    });
    if (normalized) { records.push(normalized); touchedEvents.add(row.eventId); }
  }
  return { records, eventsChecked: touchedEvents.size };
}

export function draftKingsSportsContentSupportedSports() { return Object.keys(LEAGUES); }
export async function fetchDraftKingsSportsContentPublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  const leagueId = LEAGUES[sport];
  if (!leagueId) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_UNSUPPORTED_SPORT'), { code: 'DRAFTKINGS_SPORTSCONTENT_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const leagueUrl = `${BASE}/leagues/${leagueId}`;
    const league = await transportJson(leagueUrl, fetcher);
    const targets = discoverSubcategories(sport, league.data);
    if (!targets.length) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_NO_PROP_CATEGORIES'), { code: 'DRAFTKINGS_SPORTSCONTENT_NO_PROP_CATEGORIES' });
    const records = [];
    const events = new Set();
    const transports = new Set([league.transport]);
    for (const target of targets) {
      const url = `${BASE}/leagues/${leagueId}/categories/${encodeURIComponent(target.categoryId)}/subcategories/${encodeURIComponent(target.subcategoryId)}`;
      try {
        const fetched = await transportJson(url, fetcher);
        transports.add(fetched.transport);
        const parsed = parsePayload(sport, fetched.data);
        records.push(...parsed.records);
        for (const row of parsed.records) if (row?.nativeEventId) events.add(row.nativeEventId);
      } catch { /* one stale subcategory must not discard successful prop groups */ }
    }
    if (!records.length) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_NO_PROPS'), { code: 'DRAFTKINGS_SPORTSCONTENT_NO_PROPS' });
    const unique = [...new Map(records.map((row) => [row.id || `${row.nativeEventId}:${row.playerName}:${row.market}:${row.line}`, row])).values()];
    const transport = transports.size === 1 ? [...transports][0] : 'draftkings-sportscontent-mixed';
    const value = {
      records: unique,
      fetchedAt: new Date().toISOString(),
      endpoint: 'sportsbook-nash.draftkings.com',
      transport,
      eventsChecked: events.size,
      categoriesChecked: targets.length,
    };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; } finally { pending.delete(sport); }
}
