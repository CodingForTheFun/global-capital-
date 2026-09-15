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
async function fetchJson(fetcher, url, transportPrefix) {
  const origin = new URL(url).origin;
  try { return { data: await directJson(fetcher, url), endpoint: new URL(url).host, transport: `${transportPrefix}-public` }; }
  catch (directError) {
    if (fetcher !== globalThis.fetch) throw directError;
    try {
      const data = await http2JsonFetch(url, { timeoutMs: 14_000, headers: headers(origin), maxRedirects: 3 });
      return { data, endpoint: new URL(url).host, transport: `${transportPrefix}-http2` };
    } catch {
      const data = await browserJsonFetch(String(url), { origin, referer: `${origin}/`, userAgent: UA, timeoutMs: 18_000 });
      return { data, endpoint: new URL(url).host, transport: `${transportPrefix}-browser` };
    }
  }
}
function sportsContentUrl(site, leagueId, subcategoryId) {
  const url = new URL(`https://sportsbook-nash.draftkings.com/sites/${site}/api/sportscontent/controldata/league/leagueSubcategory/v1/markets`);
  url.searchParams.set('isBatchable', 'false');
  url.searchParams.set('templateVars', `${leagueId},${subcategoryId}`);
  url.searchParams.set('eventsQuery', `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${subcategoryId}')`);
  url.searchParams.set('marketsQuery', `$filter=clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`);
  url.searchParams.set('include', 'Events');
  url.searchParams.set('entity', 'events');
  return url.toString();
}
function sportsContentShape(data) {
  return Boolean(data && typeof data === 'object' && (Array.isArray(data.events) || Array.isArray(data.markets) || Array.isArray(data.selections)));
}
async function fetchSportsContent(fetcher, leagueId, subcategoryId) {
  let lastError = null;
  for (const site of SITES) {
    const url = sportsContentUrl(site, leagueId, subcategoryId);
    try {
      const fetched = await fetchJson(fetcher, url, 'draftkings-sportscontent');
      if (sportsContentShape(fetched.data)) return { ...fetched, site, subcategoryId };
      lastError = Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_INVALID_SHAPE'), { code: 'DRAFTKINGS_SPORTSCONTENT_INVALID_SHAPE' });
    } catch (error) { lastError = error; }
  }
  throw lastError || Object.assign(new Error('DRAFTKINGS_SPORTSCONTENT_UNAVAILABLE'), { code: 'DRAFTKINGS_SPORTSCONTENT_UNAVAILABLE' });
}
async function fetchEventGroup(fetcher, leagueId) {
  const candidates = [
    `https://sportsbook-us-va.draftkings.com/sites/US-VA-SB/api/v5/eventgroups/${leagueId}?format=json`,
    `https://sportsbook-nash.draftkings.com/sites/US-SB/api/v5/eventgroups/${leagueId}?format=json`,
    `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${leagueId}?format=json`,
  ];
  let lastError = null;
  for (const url of candidates) {
    try { return await fetchJson(fetcher, url, 'draftkings-v5'); }
    catch (error) { lastError = error; }
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
  if (!raw || /\b(?:alternate|alt\.?|quarter|half|period|inning|live|team total|game total|milestone|to record)\b/i.test(raw)) return null;
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
  return Number.isFinite(start) && start > Date.now() - 60_000 && event?.isLive !== true && !/live|started|final|closed|settled/i.test(text(event?.status || event?.eventStatus));
}
function normalizedRow({ event, eventId, playerName, sport, market, line, overOdds, underOdds, sourceId }) {
  const { homeTeam, awayTeam } = eventTeams(event);
  const playerId = playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return record({
    sourceId, book: 'draftkings', nativePlayerId: playerId, playerName, sport, market, line,
    period: 'game', team: '', opponent: '', nativeEventId: eventId, homeTeam, awayTeam,
    gameStartTime: eventStart(event), updatedAt: new Date().toISOString(), overOdds, underOdds, sides: ['OVER', 'UNDER'],
  });
}
function finalizeCandidates(candidates, sport) {
  const byPlayerMarket = new Map();
  for (const row of candidates.values()) {
    if (row.overOdds === null || row.underOdds === null) continue;
    const key = [row.eventId, row.playerName.toLowerCase(), row.market].join('|');
    if (!byPlayerMarket.has(key)) byPlayerMarket.set(key, []);
    byPlayerMarket.get(key).push(row);
  }
  const records = [];
  const touchedEvents = new Set();
  for (const rows of byPlayerMarket.values()) {
    const unique = new Map(rows.map((row) => [String(row.line), row]));
    if (unique.size !== 1) continue;
    const row = [...unique.values()][0];
    const normalized = normalizedRow({ ...row, sport, sourceId: `${row.eventId}:${row.sourceId || row.market}:${row.playerName.toLowerCase()}:${row.line}` });
    if (normalized) { records.push(normalized); touchedEvents.add(row.eventId); }
  }
  return { records, eventsChecked: touchedEvents.size };
}
function parseSportsContent(sport, doc) {
  const events = new Map();
  for (const event of list(doc?.events)) {
    const id = text(event?.id ?? event?.eventId);
    if (id) events.set(id, event);
  }
  const selectionsByMarket = new Map();
  for (const selection of list(doc?.selections)) {
    const marketId = text(selection?.marketId);
    if (!marketId) continue;
    if (!selectionsByMarket.has(marketId)) selectionsByMarket.set(marketId, []);
    selectionsByMarket.get(marketId).push(selection);
  }
  const candidates = new Map();
  for (const marketRow of list(doc?.markets)) {
    if (marketRow?.isAlternate === true || /suspend|closed|settled|milestone/i.test(text(marketRow?.status))) continue;
    const eventId = text(marketRow?.eventId);
    const event = events.get(eventId);
    if (!event || !futureEvent(event)) continue;
    const marketName = text(marketRow?.name || marketRow?.marketType?.name);
    const stat = canonicalMarket(sport, marketName);
    if (!stat) continue;
    const marketSelections = selectionsByMarket.get(text(marketRow?.id)) || [];
    let marketPlayer = cleanPlayer(marketName, stat);
    if (!marketPlayer) {
      const sample = marketSelections.find((row) => text(row?.participant || row?.participantName));
      const participant = text(sample?.participant || sample?.participantName);
      if (participant) marketPlayer = cleanPlayer(participant, { re: /$^/ });
    }
    for (const selection of marketSelections) {
      if (selection?.isAlternate === true || /suspend|closed|settled/i.test(text(selection?.status))) continue;
      const side = sideOf(selection);
      const line = lineOf(selection);
      const odds = american(selection);
      if (!side || line === null || odds === null) continue;
      const participant = text(selection?.participant || selection?.participantName);
      const playerName = participant ? cleanPlayer(participant, { re: /$^/ }) : marketPlayer;
      if (!playerName) continue;
      const key = [eventId, playerName.toLowerCase(), stat.market, line].join('|');
      if (!candidates.has(key)) candidates.set(key, { event, eventId, playerName, market: stat.market, line, overOdds: null, underOdds: null, sourceId: text(marketRow?.id) });
      const row = candidates.get(key);
      if (side === 'OVER') row.overOdds = odds; else row.underOdds = odds;
    }
  }
  return finalizeCandidates(candidates, sport);
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
          if (!candidates.has(key)) candidates.set(key, { event, eventId, playerName, market: stat.market, line, overOdds: null, underOdds: null, sourceId: text(offer?.id || offer?.offerId) });
          const row = candidates.get(key);
          if (side === 'OVER') row.overOdds = odds; else row.underOdds = odds;
        }
      }
    }
  }
  return finalizeCandidates(candidates, sport);
}

export function draftKingsSportsbookSupportedSports() { return Object.keys(LEAGUES); }
export async function fetchDraftKingsSportsbookPublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  const league = LEAGUES[sport];
  if (!league) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_UNSUPPORTED_SPORT'), { code: 'DRAFTKINGS_SPORTSBOOK_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const maxCategories = int('AUTOSCOUT_DK_SB_MAX_CATEGORIES_PER_SPORT', 4, 1, 8);
    const targets = league.subcategories.slice(0, maxCategories);
    const settled = await Promise.allSettled(targets.map((subcategoryId) => fetchSportsContent(fetcher, league.id, subcategoryId)));
    const good = settled.filter((row) => row.status === 'fulfilled').map((row) => row.value);
    if (good.length) {
      const all = new Map();
      const eventIds = new Set();
      for (const fetched of good) {
        const parsed = parseSportsContent(sport, fetched.data);
        for (const row of parsed.records) {
          all.set([row.nativeEventId, row.nativePlayerId, row.market, row.line].join('|'), row);
          eventIds.add(row.nativeEventId);
        }
      }
      const transports = [...new Set(good.map((row) => row.transport).filter(Boolean))];
      const value = {
        records: [...all.values()], fetchedAt: new Date().toISOString(),
        endpoint: good[0]?.endpoint || 'sportsbook-nash.draftkings.com',
        transport: transports.length === 1 ? transports[0] : 'draftkings-sportscontent-mixed',
        eventsChecked: eventIds.size, categoriesChecked: good.length,
      };
      cache.set(sport, { expires: Date.now() + TTL_MS, value });
      return value;
    }

    const rejected = settled.find((row) => row.status === 'rejected');
    let legacy;
    try { legacy = await fetchEventGroup(fetcher, league.id); }
    catch (legacyError) {
      throw legacyError || rejected?.reason || Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_UNAVAILABLE'), { code: 'DRAFTKINGS_SPORTSBOOK_UNAVAILABLE' });
    }
    const parsed = parseV5(sport, legacy.data);
    const value = {
      records: parsed.records, fetchedAt: new Date().toISOString(), endpoint: legacy.endpoint,
      transport: legacy.transport, eventsChecked: parsed.eventsChecked, categoriesChecked: 0,
    };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; }
  finally { pending.delete(sport); }
}
