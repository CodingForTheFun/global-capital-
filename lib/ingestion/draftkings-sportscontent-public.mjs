import { ingestionSignal } from './operation-deadline.mjs';
import { record } from './normalize.mjs';
import { http2JsonFetch } from './http2-json-fetch.mjs';
import { browserJsonFetch } from './browser-json-fetch.mjs';

const LEAGUES = Object.freeze({
  NFL: { id: 88808, subcategories: [9524, 9514, 14114, 14115, 9522, 9517, 9518, 9525, 15937, 18537, 17061, 17062] },
  NBA: { id: 42648, subcategories: [12488, 12492, 12495, 12497, 5001, 9973, 9976, 9974, 13508, 13782, 13780] },
  MLB: { id: 84240, subcategories: [6607, 15221, 9886, 15219, 17413, 6719] },
  NHL: { id: 42133, subcategories: [12040, 16213, 16215, 16257, 16550] },
});
const SITES = Object.freeze(['US-NJ-SB', 'US-VA-SB', 'US-SB']);
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

function headers(origin = 'https://sportsbook.draftkings.com') {
  return {
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': UA,
    origin,
    referer: `${origin.replace(/\/$/, '')}/`,
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
  const origin = new URL(url).origin;
  try {
    const response = await fetcher(url, { headers: headers(origin), redirect: 'follow', signal: ingestionSignal(AbortSignal.timeout(14_000)) });
    return { data: await readJson(response), transport: 'draftkings-sportscontent-public', endpoint: new URL(url).host };
  } catch (directError) {
    if (fetcher !== globalThis.fetch) throw directError;
    try {
      const data = await http2JsonFetch(url, { timeoutMs: 14_000, headers: headers(origin), maxRedirects: 3 });
      return { data, transport: 'draftkings-sportscontent-http2', endpoint: new URL(url).host };
    } catch {
      const data = await browserJsonFetch(url, { origin, referer: `${origin}/`, userAgent: UA, timeoutMs: 18_000 });
      return { data, transport: 'draftkings-sportscontent-browser', endpoint: new URL(url).host };
    }
  }
}
function currentUrl(site, leagueId, subcategoryId) {
  const url = new URL(`https://sportsbook-nash.draftkings.com/sites/${site}/api/sportscontent/controldata/league/leagueSubcategory/v1/markets`);
  url.searchParams.set('isBatchable', 'false');
  url.searchParams.set('templateVars', `${leagueId},${subcategoryId}`);
  url.searchParams.set('eventsQuery', `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${subcategoryId}')`);
  url.searchParams.set('marketsQuery', `$filter=clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`);
  url.searchParams.set('include', 'Events');
  url.searchParams.set('entity', 'events');
  return url.toString();
}
function currentShape(data) {
  return Boolean(data && typeof data === 'object' && (Array.isArray(data.events) || Array.isArray(data.markets) || Array.isArray(data.selections)));
}
async function fetchSubcategory(fetcher, leagueId, subcategoryId) {
  let lastError = null;
  for (const site of SITES) {
    const url = currentUrl(site, leagueId, subcategoryId);
    try {
      const fetched = await transportJson(url, fetcher);
      if (currentShape(fetched.data)) return { ...fetched, site, subcategoryId };
      lastError = Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_INVALID_SHAPE'), { code: 'DRAFTKINGS_SPORTSCONTENT_INVALID_SHAPE' });
    } catch (error) { lastError = error; }
  }
  throw lastError || Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_UNAVAILABLE'), { code: 'DRAFTKINGS_SPORTSCONTENT_UNAVAILABLE' });
}
function canonicalMarket(sport, value) {
  const raw = text(value).replace(/\s+/g, ' ');
  if (!raw || /\b(?:alternate|alt\.?|quarter|half|period|inning|live|team total|game total|milestone|to record)\b/i.test(raw)) return null;
  for (const [market, re] of MARKET_RULES[sport] || []) if (re.test(raw)) return { market, re };
  return null;
}
function american(selection) {
  return numeric(selection?.displayOdds?.american ?? selection?.oddsAmerican ?? selection?.americanOdds ?? selection?.odds?.american);
}
function side(selection) {
  const raw = `${text(selection?.label)} ${text(selection?.name)} ${text(selection?.description)}`;
  if (/\b(?:over|more)\b/i.test(raw)) return 'OVER';
  if (/\b(?:under|less)\b/i.test(raw)) return 'UNDER';
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
function cleanPlayer(value, stat) {
  let raw = text(value).replace(/\s+/g, ' ');
  raw = raw.replace(stat.re, ' ')
    .replace(/\b(?:o\/?u|over\/under|over|under|more|less|player|props?|total|regular|line)\b/ig, ' ')
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
  return Number.isFinite(start) && start > Date.now() - 60_000 && event?.isLive !== true && !/live|started|final|closed|settled/i.test(text(event?.status || event?.eventStatus));
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
    if (market?.isAlternate === true || /alternate|alt\.?|milestone/i.test(text(market?.name))) continue;
    const marketId = text(market?.id ?? market?.marketId);
    const eventId = text(market?.eventId);
    const event = events.get(eventId);
    if (!marketId || !event || !futureEvent(event)) continue;
    const marketName = text(market?.name || market?.marketType?.name);
    const stat = canonicalMarket(sport, marketName);
    if (!stat) continue;
    const selections = selectionsByMarket.get(marketId) || [];
    const marketPlayer = cleanPlayer(marketName, stat);
    for (const selection of selections) {
      const whichSide = side(selection);
      const line = lineOf(selection);
      const odds = american(selection);
      if (!whichSide || line === null || odds === null || odds === 0) continue;
      const participant = text(selection?.participant ?? selection?.participantName);
      const playerName = participant ? cleanPlayer(participant, { re: /$^/ }) : marketPlayer;
      if (!playerName) continue;
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
    const unique = new Map(rows.map((row) => [String(row.line), row]));
    if (unique.size !== 1) continue;
    const row = [...unique.values()][0];
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
  const league = LEAGUES[sport];
  if (!league) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_UNSUPPORTED_SPORT'), { code: 'DRAFTKINGS_SPORTSCONTENT_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const maxCategories = int('AUTOSCOUT_DK_SB_MAX_CATEGORIES_PER_SPORT', 4, 1, 8);
    const targets = league.subcategories.slice(0, maxCategories);
    const settled = await Promise.allSettled(targets.map((subcategoryId) => fetchSubcategory(fetcher, league.id, subcategoryId)));
    const good = settled.filter((row) => row.status === 'fulfilled').map((row) => row.value);
    if (!good.length) {
      const rejected = settled.find((row) => row.status === 'rejected');
      throw rejected?.reason || Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_UNAVAILABLE'), { code: 'DRAFTKINGS_SPORTSCONTENT_UNAVAILABLE' });
    }
    const records = [];
    const events = new Set();
    const transports = new Set();
    for (const fetched of good) {
      transports.add(fetched.transport);
      const parsed = parsePayload(sport, fetched.data);
      records.push(...parsed.records);
      for (const row of parsed.records) if (row?.nativeEventId) events.add(row.nativeEventId);
    }
    if (!records.length) throw Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_NO_PROPS'), { code: 'DRAFTKINGS_SPORTSCONTENT_NO_PROPS' });
    const unique = [...new Map(records.map((row) => [row.id || `${row.nativeEventId}:${row.playerName}:${row.market}:${row.line}`, row])).values()];
    const transport = transports.size === 1 ? [...transports][0] : 'draftkings-sportscontent-mixed';
    const value = {
      records: unique,
      fetchedAt: new Date().toISOString(),
      endpoint: good[0]?.endpoint || 'sportsbook-nash.draftkings.com',
      transport,
      eventsChecked: events.size,
      categoriesChecked: good.length,
    };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; } finally { pending.delete(sport); }
}
