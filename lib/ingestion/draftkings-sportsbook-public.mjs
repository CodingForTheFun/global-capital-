import { record } from './normalize.mjs';
import { http2JsonFetch } from './http2-json-fetch.mjs';
import { browserJsonFetch } from './browser-json-fetch.mjs';

const LEAGUES = Object.freeze({ NFL: 88808, NBA: 42648, MLB: 84240, NHL: 42133, MLS: Number(process.env.AUTOSCOUT_DRAFTKINGS_MLS_LEAGUE_ID || 40252), EPL: Number(process.env.AUTOSCOUT_DRAFTKINGS_EPL_LEAGUE_ID || 40253), UCL: Number(process.env.AUTOSCOUT_DRAFTKINGS_UCL_LEAGUE_ID || 40685) });
const TTL_MS = 10 * 60_000;
const MAX_BYTES = 32 * 1024 * 1024;
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const cache = new Map();
const pending = new Map();
const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];

const MARKET_RULES = Object.freeze({
  NFL: [
    ['Passing Yards', /passing\s+(?:yards?|yds?)/i], ['Passing Touchdowns', /passing\s+(?:touchdowns?|tds?)/i],
    ['Passing Attempts', /passing\s+attempts?/i], ['Passing Completions', /(?:passing\s+)?completions?/i],
    ['Passing Interceptions', /(?:passing\s+)?interceptions?(?:\s+thrown)?/i],
    ['Rushing Yards', /rushing\s+(?:yards?|yds?)/i], ['Rushing Attempts', /rushing\s+attempts?|carries/i],
    ['Rushing Touchdowns', /rushing\s+(?:touchdowns?|tds?)/i], ['Receiving Yards', /receiving\s+(?:yards?|yds?)/i],
    ['Receptions', /\breceptions?\b/i], ['Receiving Touchdowns', /receiving\s+(?:touchdowns?|tds?)/i],
    ['Longest Reception', /longest\s+reception/i], ['Tackles + Assists', /tackles?\s*\+\s*assists?/i],
    ['Solo Tackles', /solo\s+tackles?/i], ['Sacks', /\bsacks?\b/i],
    ['Field Goals Made', /field\s+goals?\s+made/i], ['Kicking Points', /kicking\s+points?/i],
  ],
  NBA: [
    ['Points + Rebounds + Assists', /(?:points?|pts)\s*\+\s*(?:rebounds?|reb)\s*\+\s*(?:assists?|ast)/i],
    ['Points + Rebounds', /(?:points?|pts)\s*\+\s*(?:rebounds?|reb)/i],
    ['Points + Assists', /(?:points?|pts)\s*\+\s*(?:assists?|ast)/i],
    ['Rebounds + Assists', /(?:rebounds?|reb)\s*\+\s*(?:assists?|ast)/i],
    ['3-PT Made', /(?:3[- ]?pt|3[- ]?pointers?|three[- ]?pointers?|threes?).*made/i],
    ['Points', /\b(?:points?|pts)\b/i], ['Rebounds', /\b(?:rebounds?|reb)\b/i], ['Assists', /\b(?:assists?|ast)\b/i],
    ['Blocks', /\bblocks?\b/i], ['Steals', /\bsteals?\b/i], ['Turnovers', /\bturnovers?\b/i],
  ],
  MLB: [
    ['Hits Allowed', /hits?\s+allowed/i], ['Walks Allowed', /walks?\s+allowed/i],
    ['Pitching Outs', /(?:pitching\s+)?outs?(?:\s+recorded)?/i], ['Pitches Thrown', /pitches?(?:\s+thrown)?/i],
    ['Earned Runs', /earned\s+runs?/i], ['Total Bases', /total\s+bases?/i], ['Home Runs', /home\s+runs?/i],
    ['Stolen Bases', /stolen\s+bases?/i], ['RBI', /(?:rbis?|runs\s+batted\s+in)/i], ['Strikeouts', /strikeouts?/i],
    ['Hits', /\bhits?\b/i], ['Runs', /\bruns?\b/i],
  ],
  NHL: [
    ['Shots on Goal', /shots?\s+on\s+goal/i], ['Blocked Shots', /blocked\s+shots?/i],
    ['Goals Against', /goals?\s+against/i], ['Saves', /\bsaves?\b/i],
    ['Points', /\bpoints?\b/i], ['Assists', /\bassists?\b/i], ['Goals', /\bgoals?\b/i],
  ],
  MLS: [
    ['Shots on Target', /shots?\s+on\s+target/i], ['Passes Attempted', /passes?\s+attempted/i], ['Passes Completed', /passes?\s+completed/i],
    ['Attempted Dribbles', /attempted\s+dribbles?/i], ['Clearances', /clearances?/i], ['Tackles', /\btackles?\b/i],
    ['Saves', /\b(?:goalie\s+)?saves?\b/i], ['Assists', /\bassists?\b/i], ['Goals', /\bgoals?\b/i], ['Shots', /\bshots?\b/i],
  ],
  EPL: [
    ['Shots on Target', /shots?\s+on\s+target/i], ['Passes Attempted', /passes?\s+attempted/i], ['Passes Completed', /passes?\s+completed/i],
    ['Attempted Dribbles', /attempted\s+dribbles?/i], ['Clearances', /clearances?/i], ['Tackles', /\btackles?\b/i],
    ['Saves', /\b(?:goalie\s+)?saves?\b/i], ['Assists', /\bassists?\b/i], ['Goals', /\bgoals?\b/i], ['Shots', /\bshots?\b/i],
  ],
  UCL: [
    ['Shots on Target', /shots?\s+on\s+target/i], ['Passes Attempted', /passes?\s+attempted/i], ['Passes Completed', /passes?\s+completed/i],
    ['Attempted Dribbles', /attempted\s+dribbles?/i], ['Clearances', /clearances?/i], ['Tackles', /\btackles?\b/i],
    ['Saves', /\b(?:goalie\s+)?saves?\b/i], ['Assists', /\bassists?\b/i], ['Goals', /\bgoals?\b/i], ['Shots', /\bshots?\b/i],
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
async function directJson(fetcher, url) {
  const origin = new URL(url).origin;
  const response = await fetcher(url, { headers: headers(origin), redirect: 'follow', signal: AbortSignal.timeout(14_000) });
  if (!response.ok) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_HTTP'), { code: 'DRAFTKINGS_SPORTSBOOK_HTTP', status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_TOO_LARGE'), { code: 'DRAFTKINGS_SPORTSBOOK_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_TOO_LARGE'), { code: 'DRAFTKINGS_SPORTSBOOK_TOO_LARGE' });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_INVALID_JSON'), { code: 'DRAFTKINGS_SPORTSBOOK_INVALID_JSON' }); }
}
async function fetchEventGroup(fetcher, leagueId) {
  const candidates = [
    `https://sportsbook-us-va.draftkings.com/sites/US-VA-SB/api/v5/eventgroups/${leagueId}?format=json`,
    `https://sportsbook-nash.draftkings.com/sites/US-SB/api/v5/eventgroups/${leagueId}?format=json`,
    `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${leagueId}?format=json`,
  ];
  let lastError = null;
  for (const url of candidates) {
    const origin = new URL(url).origin;
    try { return { data: await directJson(fetcher, url), endpoint: new URL(url).host, transport: 'draftkings-v5-public' }; }
    catch (error) { lastError = error; }
    if (fetcher !== globalThis.fetch) continue;
    try {
      const data = await http2JsonFetch(url, { timeoutMs: 14_000, headers: headers(origin), maxRedirects: 3 });
      return { data, endpoint: new URL(url).host, transport: 'draftkings-v5-http2' };
    } catch (error) { lastError = error; }
  }
  if (fetcher === globalThis.fetch) {
    const url = candidates[0];
    const origin = new URL(url).origin;
    try {
      const data = await browserJsonFetch(url, {
        origin, referer: `${origin}/`,
        userAgent: UA, timeoutMs: 18_000,
      });
      return { data, endpoint: new URL(url).host, transport: 'draftkings-v5-browser' };
    } catch (error) { lastError = error; }
  }
  throw lastError || Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_UNAVAILABLE'), { code: 'DRAFTKINGS_SPORTSBOOK_UNAVAILABLE' });
}
function number(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = text(value).replace(/[−–—]/g, '-').replace(/^\+/, '');
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}
function american(outcome) {
  for (const value of [outcome?.oddsAmerican, outcome?.americanOdds, outcome?.displayOdds?.american, outcome?.odds?.american]) {
    const n = number(value);
    if (n !== null && n !== 0) return n;
  }
  return null;
}
function lineOf(outcome) {
  for (const value of [outcome?.line, outcome?.points, outcome?.handicap]) {
    const n = number(value);
    if (n !== null) return n;
  }
  const match = text(outcome?.label).match(/(?:over|under)\s*([+-]?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}
function sideOf(outcome) {
  const raw = `${text(outcome?.label)} ${text(outcome?.name)} ${text(outcome?.description)}`;
  if (/\b(?:over|more)\b/i.test(raw)) return 'OVER';
  if (/\b(?:under|less)\b/i.test(raw)) return 'UNDER';
  return null;
}
function canonicalMarket(sport, value) {
  const raw = text(value).replace(/\s+/g, ' ');
  if (!raw || /\b(?:alternate|alt\.?|quarter|half|period|inning|live|team total|game total)\b/i.test(raw)) return null;
  for (const [market, re] of MARKET_RULES[sport] || []) if (re.test(raw)) return { market, re };
  return null;
}
function cleanPlayer(label, stat) {
  let raw = text(label).replace(/\s+/g, ' ');
  raw = raw.replace(stat.re, ' ')
    .replace(/\b(?:o\/?u|over\/under|over|under|more|less|player|props?|total|regular|line)\b/ig, ' ')
    .replace(/[|():]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/^\s*[-/]\s*|\s*[-/]\s*$/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || /\b(?:team|game|match|home|away)\b/i.test(raw)) return '';
  if (!words.every((word) => /[A-Za-zÀ-ÖØ-öø-ÿ'.-]/.test(word))) return '';
  return raw;
}
function eventTeams(event) {
  const home = text(event?.homeTeam || event?.homeTeamName);
  const away = text(event?.awayTeam || event?.awayTeamName);
  if (home || away) return { homeTeam: home, awayTeam: away };
  const raw = text(event?.name || event?.eventName);
  for (const sep of [' @ ', ' at ', ' vs. ', ' vs ']) {
    if (!raw.includes(sep)) continue;
    const [left, right] = raw.split(sep, 2).map(text);
    return sep.trim() === '@' || sep.trim() === 'at' ? { awayTeam: left, homeTeam: right } : { homeTeam: left, awayTeam: right };
  }
  return { homeTeam: '', awayTeam: '' };
}
function eventStart(event) { return event?.startDate || event?.startEventDate || event?.startTime || null; }
function futureEvent(event) {
  const start = Date.parse(eventStart(event) || '');
  return Number.isFinite(start) && start > Date.now() - 60_000 && event?.isLive !== true && !/live|started|final|closed|settled/i.test(text(event?.status));
}
function flattenOffers(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenOffers(item, out);
  } else if (value && typeof value === 'object' && Array.isArray(value.outcomes)) out.push(value);
  return out;
}
function parseV5(sport, payload) {
  const group = payload?.eventGroup || payload || {};
  const events = new Map();
  for (const event of list(group?.events || payload?.events)) {
    const id = text(event?.eventId ?? event?.id);
    if (id) events.set(id, event);
  }
  const candidates = new Map();
  const touchedEvents = new Set();
  for (const category of list(group?.offerCategories || payload?.offerCategories)) {
    const categoryName = text(category?.name);
    if (/future|season|award|milestone|team props?|game lines?|quarter|half/i.test(categoryName)) continue;
    for (const descriptor of list(category?.offerSubcategoryDescriptors || category?.offerSubcategories)) {
      const subName = text(descriptor?.name || descriptor?.offerSubcategory?.name);
      if (/alternate|alt\.?|quarter|half|period|inning|live/i.test(subName)) continue;
      const offers = flattenOffers(descriptor?.offerSubcategory?.offers || descriptor?.offers || []);
      for (const offer of offers) {
        if (offer?.isAlternate === true || /suspend|closed|settled/i.test(text(offer?.status))) continue;
        const eventId = text(offer?.eventId);
        const event = events.get(eventId);
        if (!event || !futureEvent(event)) continue;
        const offerLabel = text(offer?.label || offer?.name);
        const stat = canonicalMarket(sport, `${offerLabel} ${subName} ${categoryName}`);
        if (!stat) continue;
        let playerName = cleanPlayer(offerLabel, stat);
        const outcomes = list(offer?.outcomes);
        if (!playerName && outcomes.length) {
          const participant = text(outcomes[0]?.participant || outcomes[0]?.participantName);
          playerName = cleanPlayer(participant, { re: /$^/ });
        }
        if (!playerName) continue;
        for (const outcome of outcomes) {
          const side = sideOf(outcome);
          const line = lineOf(outcome);
          const odds = american(outcome);
          if (!side || line === null || odds === null) continue;
          const key = [eventId, playerName.toLowerCase(), stat.market, line].join('|');
          if (!candidates.has(key)) candidates.set(key, { event, eventId, playerName, market: stat.market, line, overOdds: null, underOdds: null, offerId: text(offer?.id || offer?.offerId) });
          const row = candidates.get(key);
          if (side === 'OVER') row.overOdds = odds; else row.underOdds = odds;
        }
      }
    }
  }
  const byPlayerMarket = new Map();
  for (const row of candidates.values()) {
    if (row.overOdds === null || row.underOdds === null) continue;
    const key = [row.eventId, row.playerName.toLowerCase(), row.market].join('|');
    if (!byPlayerMarket.has(key)) byPlayerMarket.set(key, []);
    byPlayerMarket.get(key).push(row);
  }
  const records = [];
  for (const rows of byPlayerMarket.values()) {
    // More than one complete threshold is an alternate ladder; keep regular lines only.
    if (rows.length !== 1) continue;
    const row = rows[0];
    const { homeTeam, awayTeam } = eventTeams(row.event);
    const playerId = row.playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const normalized = record({
      sourceId: `${row.eventId}:${row.offerId || row.market}:${playerId}:${row.line}`,
      book: 'draftkings', nativePlayerId: playerId, playerName: row.playerName, sport,
      market: row.market, line: row.line, period: 'game', team: '', opponent: '', nativeEventId: row.eventId,
      homeTeam, awayTeam, gameStartTime: eventStart(row.event), updatedAt: new Date().toISOString(),
      overOdds: row.overOdds, underOdds: row.underOdds, sides: ['OVER', 'UNDER'],
    });
    if (normalized) { records.push(normalized); touchedEvents.add(row.eventId); }
  }
  return { records, eventsChecked: touchedEvents.size };
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
    const fetched = await fetchEventGroup(fetcher, leagueId);
    const parsed = parseV5(sport, fetched.data);
    const value = {
      records: parsed.records,
      fetchedAt: new Date().toISOString(), endpoint: fetched.endpoint,
      transport: fetched.transport, eventsChecked: parsed.eventsChecked,
    };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; }
  finally { pending.delete(sport); }
}
