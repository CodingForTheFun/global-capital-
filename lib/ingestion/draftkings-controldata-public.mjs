import { record } from './normalize.mjs';
import { http2JsonFetch } from './http2-json-fetch.mjs';
import { browserJsonFetch } from './browser-json-fetch.mjs';
import {
  fetchDraftKingsSportsbookPublic as fetchExistingDraftKingsSportsbookPublic,
  draftKingsSportsbookSupportedSports,
} from './draftkings-sportsbook-public.mjs';

const SITE = String(process.env.AUTOSCOUT_DRAFTKINGS_SITE || 'US-SB').trim().toUpperCase() || 'US-SB';
const CONTROL_BASE = `https://sportsbook-nash.draftkings.com/sites/${SITE}/api/sportscontent/controldata/league/leagueSubcategory/v1/markets`;
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BYTES = 24 * 1024 * 1024;
const TTL_MS = 3 * 60_000;
const cache = new Map();
const pending = new Map();

const LEAGUES = Object.freeze({ NFL: '88808', NBA: '42648', MLB: '84240', NHL: '42133' });

// Pregame, two-sided player-prop subcategories observed on DraftKings' public
// leagueSubcategory feed. We intentionally start with core main-line markets and
// cap requests using the existing AUTOSCOUT_DK_SB_MAX_CATEGORIES_PER_SPORT knob.
const SUBCATEGORIES = Object.freeze({
  NFL: [
    ['9524', 'Passing Yards'],
    ['9514', 'Rushing Yards'],
    ['14114', 'Receiving Yards'],
    ['14115', 'Receptions'],
    ['9525', 'Passing Touchdowns'],
    ['9522', 'Passing Completions'],
    ['9517', 'Passing Attempts'],
    ['9518', 'Rushing Attempts'],
    ['15937', 'Passing Interceptions'],
    ['17061', 'Field Goals Made'],
    ['17062', 'Kicking Points'],
    ['18537', 'Tackles + Assists'],
  ],
  NBA: [
    ['12488', 'Points'],
    ['12492', 'Rebounds'],
    ['12495', 'Assists'],
    ['12497', '3-PT Made'],
    ['5001', 'Points + Rebounds + Assists'],
    ['9976', 'Points + Rebounds'],
    ['9973', 'Points + Assists'],
    ['9974', 'Rebounds + Assists'],
    ['2713508', 'Steals'],
    ['2713780', 'Blocks'],
  ],
  MLB: [
    ['6719', 'Hits'],
    ['6607', 'Total Bases'],
    ['15221', 'Strikeouts'],
    ['9886', 'Hits Allowed'],
    ['17407', 'Runs'],
    ['8025', 'RBI'],
    ['17412', 'Earned Runs'],
    ['17413', 'Pitching Outs'],
    ['15219', 'Walks Allowed'],
    ['17408', 'Stolen Bases'],
  ],
  NHL: [],
});

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = text(value).replace(/[−–—]/g, '-').replace(/^\+/, '');
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) ? Number(raw) : null;
};
const int = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
};

function headers() {
  return {
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': UA,
    origin: 'https://sportsbook.draftkings.com',
    referer: 'https://sportsbook.draftkings.com/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
}

function buildUrl(leagueId, subcategoryId) {
  const url = new URL(CONTROL_BASE);
  const eventsQuery = `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${subcategoryId}')`;
  const marketsQuery = `$filter=clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`;
  url.searchParams.set('isBatchable', 'false');
  url.searchParams.set('templateVars', `${leagueId},${subcategoryId}`);
  url.searchParams.set('eventsQuery', eventsQuery);
  url.searchParams.set('marketsQuery', marketsQuery);
  url.searchParams.set('include', 'Events');
  url.searchParams.set('entity', 'events');
  return url;
}

async function readResponse(response) {
  if (!response.ok) throw Object.assign(new Error('DRAFTKINGS_CONTROLDATA_HTTP'), { code: 'DRAFTKINGS_CONTROLDATA_HTTP', status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_CONTROLDATA_TOO_LARGE'), { code: 'DRAFTKINGS_CONTROLDATA_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('DRAFTKINGS_CONTROLDATA_TOO_LARGE'), { code: 'DRAFTKINGS_CONTROLDATA_TOO_LARGE' });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('DRAFTKINGS_CONTROLDATA_INVALID_JSON'), { code: 'DRAFTKINGS_CONTROLDATA_INVALID_JSON' }); }
}

async function fetchJson(url, fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(url, { headers: headers(), redirect: 'follow', signal: AbortSignal.timeout(18_000) });
    return { data: await readResponse(response), transport: 'draftkings-controldata-public' };
  } catch (directError) {
    if (fetcher !== globalThis.fetch) throw directError;
    try {
      const data = await http2JsonFetch(url, { timeoutMs: 18_000, headers: headers(), maxRedirects: 3 });
      return { data, transport: 'draftkings-controldata-http2' };
    } catch {
      const data = await browserJsonFetch(String(url), {
        origin: 'https://sportsbook.draftkings.com',
        referer: 'https://sportsbook.draftkings.com/',
        userAgent: UA,
        timeoutMs: 22_000,
        headers: headers(),
      });
      return { data, transport: 'draftkings-controldata-browser' };
    }
  }
}

function american(selection) {
  const raw = selection?.displayOdds?.american ?? selection?.americanOdds ?? selection?.oddsAmerican;
  const value = text(raw).replace(/[−–—]/g, '-').toUpperCase();
  if (['EV', 'EVEN', 'PK'].includes(value)) return 100;
  if (!/^[+-]?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function sideAndLine(selection) {
  const rawLabel = text(selection?.label);
  const outcome = text(selection?.outcomeType).toUpperCase();
  const side = outcome === 'OVER' || outcome === 'UNDER'
    ? outcome
    : /^over\b/i.test(rawLabel) ? 'OVER' : /^under\b/i.test(rawLabel) ? 'UNDER' : null;
  let line = number(selection?.points ?? selection?.line ?? selection?.handicap);
  if (line === null) {
    const match = rawLabel.match(/\b(?:over|under)\s*([+-]?[0-9]+(?:\.[0-9]+)?)/i);
    if (match) line = number(match[1]);
  }
  return { side, line };
}

function eventTeams(event) {
  let homeTeam = '';
  let awayTeam = '';
  for (const participant of list(event?.participants)) {
    if (text(participant?.type).toLowerCase() !== 'team') continue;
    const role = text(participant?.venueRole ?? participant?.alignment).toLowerCase();
    if (role === 'home') homeTeam = text(participant?.name);
    if (role === 'away') awayTeam = text(participant?.name);
  }
  if (!homeTeam || !awayTeam) {
    const raw = text(event?.name);
    for (const sep of [' @ ', ' at ', ' vs. ', ' vs ']) {
      if (!raw.includes(sep)) continue;
      const [away, home] = raw.split(sep, 2).map(text);
      awayTeam ||= away;
      homeTeam ||= home;
      break;
    }
  }
  return { homeTeam, awayTeam };
}

function futureGame(event) {
  const start = Date.parse(event?.startEventDate || event?.startDate || event?.startTime || '');
  if (!Number.isFinite(start) || start <= Date.now() - 60_000) return false;
  if (event?.isLive === true || event?.live === true) return false;
  return !/live|started|in.?progress|final|closed|settled/i.test(text(event?.status || event?.eventStatus));
}

function plausiblePlayer(value) {
  const raw = text(value).replace(/\s+/g, ' ').trim();
  if (!raw || raw.length > 80) return '';
  const words = raw.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 6) return '';
  if (/\b(?:team|game|match|regular season|season|total|over|under|alternate|milestone|spread|moneyline|touchdown scorer)\b/i.test(raw)) return '';
  if (/\d/.test(raw)) return '';
  return raw;
}

function playerFromMarket(marketName, statLabel) {
  let raw = text(marketName).replace(/\s+/g, ' ');
  if (!raw || /\b(?:alternate|milestone|regular season|season total)\b/i.test(raw)) return '';
  const escaped = statLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ \+\\ /g, '\\s*\\+\\s*');
  raw = raw
    .replace(new RegExp(`\\b${escaped}\\b`, 'ig'), ' ')
    .replace(/\b(?:o\/u|over\/under|player prop|player props|total)\b/ig, ' ')
    .replace(/[|()–—:]+/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plausiblePlayer(raw);
}

function playerFromEvent(event) {
  const raw = text(event?.name).replace(/\s+/g, ' ');
  if (!raw || /\s(?:@|at|vs\.?|v)\s/i.test(raw)) return '';
  const afterDash = raw.includes(' - ') ? raw.split(' - ').pop() : raw;
  return plausiblePlayer(afterDash.replace(/^[A-Z]{2,6}\s+\d{4}(?:\/\d{2,4})?\s*/i, '').trim());
}

function directPlayer(selection) {
  for (const candidate of [
    selection?.playerName,
    selection?.participantName,
    selection?.participant?.name,
    selection?.metadata?.playerName,
    selection?.metadata?.participantName,
  ]) {
    const valid = plausiblePlayer(candidate);
    if (valid) return valid;
  }
  return '';
}

function chooseMainPair(selections) {
  const byLine = new Map();
  for (const selection of selections) {
    if (selection?.isAlternate === true || /alternate/i.test(text(selection?.tags))) continue;
    const { side, line } = sideAndLine(selection);
    const odds = american(selection);
    if (!side || line === null || line < 0 || odds === null) continue;
    const key = String(line);
    if (!byLine.has(key)) byLine.set(key, { line, overOdds: null, underOdds: null, mainOver: false, mainUnder: false, selections: [] });
    const pair = byLine.get(key);
    pair.selections.push(selection);
    if (side === 'OVER') { pair.overOdds = odds; pair.mainOver ||= selection?.main === true; }
    else { pair.underOdds = odds; pair.mainUnder ||= selection?.main === true; }
  }
  const complete = [...byLine.values()].filter((pair) => pair.overOdds !== null && pair.underOdds !== null);
  const explicitlyMain = complete.filter((pair) => pair.mainOver && pair.mainUnder);
  if (explicitlyMain.length === 1) return explicitlyMain[0];
  return complete.length === 1 ? complete[0] : null;
}

export function parseDraftKingsControlData(sport, statLabel, doc) {
  const events = new Map(list(doc?.events).map((event) => [String(event?.id), event]));
  const byMarket = new Map();
  for (const selection of list(doc?.selections)) {
    const marketId = String(selection?.marketId ?? '');
    if (!marketId) continue;
    if (!byMarket.has(marketId)) byMarket.set(marketId, []);
    byMarket.get(marketId).push(selection);
  }

  const records = [];
  const touchedEvents = new Set();
  for (const market of list(doc?.markets)) {
    if (market?.isAlternate === true || /alternate|milestone|regular season/i.test(text(market?.name))) continue;
    if (/suspend|closed|settled/i.test(text(market?.status))) continue;
    const event = events.get(String(market?.eventId ?? ''));
    if (!event || !futureGame(event)) continue;
    const selections = byMarket.get(String(market?.id)) || [];
    const pair = chooseMainPair(selections);
    if (!pair) continue;
    const playerName = playerFromMarket(market?.name, statLabel)
      || selections.map(directPlayer).find(Boolean)
      || playerFromEvent(event);
    if (!playerName) continue;

    const playerId = playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const eventId = String(event?.id ?? market?.eventId ?? '');
    const { homeTeam, awayTeam } = eventTeams(event);
    const normalized = record({
      sourceId: `${eventId}:${market?.id}:${playerId}:${statLabel}:${pair.line}`,
      book: 'draftkings',
      nativePlayerId: playerId,
      playerName,
      sport,
      market: statLabel,
      line: pair.line,
      period: 'game',
      team: '',
      opponent: '',
      nativeEventId: eventId,
      homeTeam,
      awayTeam,
      gameStartTime: event?.startEventDate || event?.startDate || event?.startTime,
      updatedAt: null,
      overOdds: pair.overOdds,
      underOdds: pair.underOdds,
      sides: ['OVER', 'UNDER'],
    });
    if (!normalized) continue;
    touchedEvents.add(eventId);
    records.push(normalized);
  }
  return { records, eventsChecked: touchedEvents.size };
}

async function fetchControlData(sport, { fetcher = globalThis.fetch } = {}) {
  const leagueId = LEAGUES[sport];
  const configured = SUBCATEGORIES[sport] || [];
  if (!leagueId || !configured.length) return null;
  const max = int('AUTOSCOUT_DK_SB_MAX_CATEGORIES_PER_SPORT', 4, 1, 8);
  const selected = configured.slice(0, max);
  const records = new Map();
  let eventsChecked = 0;
  let successfulRequests = 0;
  let transport = '';
  let lastError = null;

  for (const [subcategoryId, statLabel] of selected) {
    try {
      const fetched = await fetchJson(buildUrl(leagueId, subcategoryId), fetcher);
      successfulRequests += 1;
      transport = fetched.transport;
      const parsed = parseDraftKingsControlData(sport, statLabel, fetched.data);
      eventsChecked += parsed.eventsChecked;
      for (const row of parsed.records) records.set([row.nativeEventId, row.nativePlayerId, row.market, row.line].join('|'), row);
    } catch (error) {
      lastError = error;
    }
  }

  if (!successfulRequests) throw lastError || Object.assign(new Error('DRAFTKINGS_CONTROLDATA_FAILED'), { code: 'DRAFTKINGS_CONTROLDATA_FAILED' });
  return {
    records: [...records.values()],
    fetchedAt: new Date().toISOString(),
    endpoint: `sportsbook-nash.draftkings.com/sites/${SITE}`,
    transport: transport || 'draftkings-controldata-public',
    eventsChecked,
    categoriesChecked: selected.length,
  };
}

export { draftKingsSportsbookSupportedSports };

export async function fetchDraftKingsSportsbookPublic(sport, options = {}) {
  sport = text(sport).toUpperCase();
  if (!LEAGUES[sport]) throw Object.assign(new Error('DRAFTKINGS_SPORTSBOOK_UNSUPPORTED_SPORT'), { code: 'DRAFTKINGS_SPORTSBOOK_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!options.force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);

  const task = (async () => {
    let controlError = null;
    try {
      const value = await fetchControlData(sport, options);
      if (value && value.records.length) {
        cache.set(sport, { expires: Date.now() + TTL_MS, value });
        return value;
      }
      // A successful zero-row response can simply mean this slate currently has
      // no posted props; keep the legacy adapter as a second public route.
    } catch (error) {
      controlError = error;
    }

    try {
      const legacy = await fetchExistingDraftKingsSportsbookPublic(sport, { ...options, force: true });
      const value = { ...legacy, fallbackFrom: controlError?.code || 'controldata-zero' };
      cache.set(sport, { expires: Date.now() + TTL_MS, value });
      return value;
    } catch (legacyError) {
      if (controlError?.status && !legacyError?.status) legacyError.status = controlError.status;
      legacyError.code = controlError?.code || legacyError?.code || 'DRAFTKINGS_PUBLIC_FAILED';
      throw legacyError;
    }
  })();

  pending.set(sport, task);
  try { return await task; }
  finally { pending.delete(sport); }
}
