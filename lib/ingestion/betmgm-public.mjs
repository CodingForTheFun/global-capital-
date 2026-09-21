import { ingestionSignal } from './operation-deadline.mjs';
import { record } from './normalize.mjs';
import { http2JsonFetch } from './http2-json-fetch.mjs';
import { browserJsonFetch } from './browser-json-fetch.mjs';

const STATE = String(process.env.AUTOSCOUT_BETMGM_STATE || 'nj').trim().toLowerCase() || 'nj';
const BASE_ORIGIN = `https://www.${STATE}.betmgm.com`;
const FIXTURE_BASE = `${BASE_ORIGIN}/cds-api/bettingoffer/fixtures`;
const GRID_BASE = `${BASE_ORIGIN}/cds-api/offer-grouping/grid-view/all`;
const CONFIG_URL = `${BASE_ORIGIN}/en/api/clientconfig`;
// Public web-client id used by BetMGM's own frontend. Client-config discovery is
// preferred so rotations do not require code changes.
const FALLBACK_ACCESS_ID = 'ZTllNjllODUtOWQwNS00YmU4LWE4NTEtZGZjOTkzMGM5OWU4';
const IDS = Object.freeze({
  NFL: { sportId: '11', competitionId: '35' },
  NBA: { sportId: '7', competitionId: '6004' },
  MLB: { sportId: '23', competitionId: '75' },
  NHL: { sportId: '12', competitionId: '25' },
});
const TTL_MS = 10 * 60_000;
const ACCESS_TTL_MS = 6 * 60 * 60_000;
const GRID_TTL_MS = 30 * 60_000;
const MAX_BYTES = 32 * 1024 * 1024;
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const cache = new Map();
const pending = new Map();
let accessCache = { value: '', expires: 0 };
let gridCache = { bySport: new Map(), expires: 0 };

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const numeric = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = text(value).replace(',', '').replace(/^\+/, '');
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) ? Number(raw) : null;
};
const int = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
function localized(value) {
  if (typeof value === 'string' || typeof value === 'number') return text(value);
  if (value && typeof value === 'object') return text(value.value ?? value.name ?? value.label ?? value.text ?? '');
  return '';
}
function american(option) {
  const raw = option?.price?.americanOdds ?? option?.price?.american ?? option?.americanOdds ?? option?.american;
  const value = text(raw).replace(/[−–—]/g, '-').toUpperCase();
  if (['EV','EVEN'].includes(value)) return 100;
  if (!/^[+-]?\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}
function side(option) {
  const prefix = text(option?.totalsPrefix).toLowerCase();
  if (prefix === 'over') return 'OVER';
  if (prefix === 'under') return 'UNDER';
  const name = localized(option?.name).toLowerCase();
  if (/\bover\b/.test(name)) return 'OVER';
  if (/\bunder\b/.test(name)) return 'UNDER';
  return null;
}
function optionLine(option, market) {
  for (const value of [option?.attr, option?.line, option?.points, option?.handicap, market?.attr, market?.line, market?.points]) {
    const n = numeric(value && typeof value === 'object' ? (value.value ?? value.line ?? value.points ?? value.handicap) : value);
    if (n !== null && n >= 0) return n;
  }
  const joined = `${localized(market?.name)} ${localized(option?.name)}`;
  const match = joined.match(/\b(?:over|under)\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}
function futureFixture(fixture) {
  const start = Date.parse(fixture?.startDate || fixture?.startTime || '');
  if (!Number.isFinite(start) || start <= Date.now() - 60_000) return false;
  const status = text(fixture?.stage ?? fixture?.status ?? fixture?.state);
  return !/live|started|in.?progress|finished|closed|settled|resulted/i.test(status);
}
function teams(fixture) {
  let homeTeam = '', awayTeam = '';
  for (const participant of list(fixture?.participants)) {
    const type = text(participant?.properties?.type ?? participant?.type).toUpperCase();
    const name = localized(participant?.name);
    if (!name) continue;
    if (type === 'HOMETEAM' || type === 'HOME') homeTeam = name;
    if (type === 'AWAYTEAM' || type === 'AWAY') awayTeam = name;
  }
  if (!homeTeam || !awayTeam) {
    const name = localized(fixture?.name);
    for (const sep of [' at ', ' @ ', ' vs. ', ' vs ']) {
      if (!name.includes(sep)) continue;
      const [away, home] = name.split(sep, 2).map(text);
      awayTeam ||= away; homeTeam ||= home; break;
    }
  }
  return { homeTeam, awayTeam };
}
const MARKET_RULES = Object.freeze({
  NFL: [
    ['Passing Yards', /passing\s+(?:yards?|yds?)/i], ['Passing Touchdowns', /passing\s+(?:touchdowns?|tds?)/i],
    ['Passing Attempts', /passing\s+attempts?/i], ['Passing Completions', /(?:passing\s+)?completions?/i],
    ['Passing Interceptions', /(?:passing\s+)?interceptions?(?:\s+thrown)?/i], ['Rushing Yards', /rushing\s+(?:yards?|yds?)/i],
    ['Rushing Attempts', /rushing\s+attempts?/i], ['Receiving Yards', /receiving\s+(?:yards?|yds?)/i],
    ['Receptions', /\breceptions?\b/i], ['Tackles + Assists', /tackles?\s*\+\s*assists?/i],
    ['Sacks', /\bsacks?\b/i], ['Field Goals Made', /field\s+goals?\s+made/i], ['Kicking Points', /kicking\s+points?/i],
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
function canonicalMarket(sport, raw) {
  const value = text(raw).replace(/\s+/g, ' ');
  if (!value || /\b(?:alternate|alt\.?|quarter|half|period|inning|live|team total|game total)\b/i.test(value)) return null;
  for (const [market, re] of MARKET_RULES[sport] || []) if (re.test(value)) return { market, re };
  return null;
}
function stripPlayer(value, statRe) {
  let raw = text(value).replace(/\s+/g, ' ');
  raw = raw.replace(/\b(?:over|under)\b\s*[+-]?[0-9]+(?:\.[0-9]+)?/ig, ' ');
  raw = raw.replace(statRe, ' ').replace(/\b(?:player|total|o\/u)\b/ig, ' ').replace(/[|()\-–—:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = raw.split(' ').filter(Boolean);
  if (/\binnings?\b/i.test(raw) && /^(?:first|last|next|top|bottom|\d+(?:st|nd|rd|th)?)\b/i.test(raw)) return '';
  if (words.length < 2 || words.length > 6 || /\b(?:team|game|match|home|away)\b/i.test(raw)) return '';
  return raw;
}
function parseMarket(sport, market, fixture) {
  if (!market || !['Visible','Active','Open',''].includes(text(market?.status))) return [];
  const marketName = localized(market?.name);
  const stat = canonicalMarket(sport, marketName);
  if (!stat) return [];
  const options = list(market?.options);
  const fromMarket = stripPlayer(marketName, stat.re);
  const byPlayer = new Map();
  for (const option of options) {
    if (option?.status && !['Visible','Active','Open'].includes(text(option.status))) continue;
    const s = side(option); const line = optionLine(option, market); const odds = american(option);
    if (!s || line === null || odds === null) continue;
    const optionName = localized(option?.name);
    const playerName = fromMarket || stripPlayer(optionName, stat.re);
    if (!playerName) continue;
    const key = `${playerName.toLowerCase()}|${line}`;
    if (!byPlayer.has(key)) byPlayer.set(key, { playerName, line, overOdds: null, underOdds: null });
    if (s === 'OVER') byPlayer.get(key).overOdds = odds; else byPlayer.get(key).underOdds = odds;
  }
  const groupedByPlayer = new Map();
  for (const pair of byPlayer.values()) {
    if (pair.overOdds === null || pair.underOdds === null) continue;
    if (!groupedByPlayer.has(pair.playerName)) groupedByPlayer.set(pair.playerName, []);
    groupedByPlayer.get(pair.playerName).push(pair);
  }
  const { homeTeam, awayTeam } = teams(fixture);
  const output = [];
  for (const [playerName, pairs] of groupedByPlayer) {
    // Multiple thresholds for the same player/stat are an alternate ladder. The
    // response does not explicitly mark a main line, so fail closed.
    if (pairs.length !== 1) continue;
    const pair = pairs[0];
    const playerId = playerName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const normalized = record({
      sourceId: `${fixture?.id}:${market?.id ?? marketName}:${playerId}:${pair.line}`,
      book: 'betmgm', nativePlayerId: playerId, playerName, sport, market: stat.market, line: pair.line,
      period: 'game', team: '', opponent: '', nativeEventId: text(fixture?.id), homeTeam, awayTeam,
      gameStartTime: fixture?.startDate || fixture?.startTime, updatedAt: null,
      overOdds: pair.overOdds, underOdds: pair.underOdds, sides: ['OVER','UNDER'],
    });
    if (normalized) output.push(normalized);
  }
  return output;
}
function headers() {
  return { accept: 'application/json,text/plain,*/*', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA, origin: BASE_ORIGIN, referer: `${BASE_ORIGIN}/en/sports` };
}
async function readJson(response, code) {
  if (!response.ok) throw Object.assign(new Error(code), { code, status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw Object.assign(new Error('BETMGM_PUBLIC_TOO_LARGE'), { code: 'BETMGM_PUBLIC_TOO_LARGE' });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw Object.assign(new Error('BETMGM_PUBLIC_TOO_LARGE'), { code: 'BETMGM_PUBLIC_TOO_LARGE' });
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('BETMGM_PUBLIC_INVALID_JSON'), { code: 'BETMGM_PUBLIC_INVALID_JSON' }); }
}
async function getAccessId(fetcher) {
  if (accessCache.value && accessCache.expires > Date.now()) return accessCache.value;
  let value = '';
  try {
    const response = await fetcher(CONFIG_URL, {
      headers: { ...headers(), 'x-bwin-browser-url': `${BASE_ORIGIN}/en/sports`, 'x-from-product': 'host-app' },
      signal: ingestionSignal(AbortSignal.timeout(12_000)),
    });
    const data = await readJson(response, 'BETMGM_CONFIG_HTTP');
    const grouping = text(data?.msPreloader?.groupingUrl);
    const match = grouping.match(/[?&]x-bwin-accessid=([^&]+)/i);
    if (match) value = decodeURIComponent(match[1]);
  } catch {}
  value ||= FALLBACK_ACCESS_ID;
  accessCache = { value, expires: Date.now() + ACCESS_TTL_MS };
  return value;
}
async function transportJson(url, fetcher) {
  try {
    const response = await fetcher(url, { headers: headers(), signal: ingestionSignal(AbortSignal.timeout(18_000)), redirect: 'follow' });
    return { data: await readJson(response, 'BETMGM_PUBLIC_HTTP'), transport: 'betmgm-public' };
  } catch (directError) {
    if (fetcher !== globalThis.fetch) throw directError;
    try {
      const data = await http2JsonFetch(url, { timeoutMs: 18_000, headers: headers(), maxRedirects: 3 });
      return { data, transport: 'betmgm-http2-public' };
    } catch {
      const data = await browserJsonFetch(String(url), {
        origin: BASE_ORIGIN,
        referer: `${BASE_ORIGIN}/en/sports`,
        userAgent: UA,
        timeoutMs: 22_000,
        headers: { 'x-bwin-browser-url': `${BASE_ORIGIN}/en/sports`, 'x-from-product': 'host-app' },
      });
      return { data, transport: 'betmgm-browser-public' };
    }
  }
}
function groupScore(name) {
  const value = text(name).toLowerCase();
  if (/player\s*(?:props?|markets?|specials?)/.test(value)) return 0;
  if (/passing|rushing|receiving|pitcher|batter|skater|goalie/.test(value)) return 1;
  if (/player|props?|specials?|performance/.test(value)) return 2;
  return 99;
}
async function getGridGroupIds(sport, fetcher, accessId) {
  // Preserve deterministic mocked adapter tests and avoid extra requests for injected transports.
  if (fetcher !== globalThis.fetch) return [];
  if (gridCache.expires <= Date.now()) {
    const url = new URL(GRID_BASE);
    for (const [key, value] of Object.entries({ 'x-bwin-accessid': accessId, lang: 'en-us', country: 'US', userCountry: 'US' })) url.searchParams.set(key, value);
    const fetched = await transportJson(url, fetcher);
    const bySport = new Map();
    for (const item of list(fetched.data)) {
      const sid = text(item?.sportId);
      if (!sid) continue;
      bySport.set(sid, list(item?.groups).map((group) => ({ id: text(group?.id), name: localized(group?.name) })).filter((group) => group.id));
    }
    gridCache = { bySport, expires: Date.now() + GRID_TTL_MS };
  }
  const groups = gridCache.bySport.get(IDS[sport].sportId) || [];
  return groups
    .map((group) => ({ ...group, score: groupScore(group.name) }))
    .filter((group) => group.score < 99)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, int('AUTOSCOUT_BETMGM_MAX_GROUPS_PER_SPORT', 4, 1, 8))
    .map((group) => group.id);
}
function mergeFixtures(payloads) {
  const fixtures = new Map();
  for (const payload of payloads) {
    for (const fixture of list(payload?.fixtures)) {
      const key = text(fixture?.id) || localized(fixture?.name);
      if (!key) continue;
      const current = fixtures.get(key);
      if (!current) { fixtures.set(key, fixture); continue; }
      const markets = new Map();
      for (const market of [...list(current?.optionMarkets), ...list(fixture?.optionMarkets)]) {
        const marketKey = text(market?.id) || `${localized(market?.name)}:${list(market?.options).length}`;
        if (marketKey) markets.set(marketKey, market);
      }
      fixtures.set(key, { ...current, ...fixture, optionMarkets: [...markets.values()] });
    }
  }
  return [...fixtures.values()];
}
async function fetchPayload(sport, fetcher) {
  const ids = IDS[sport];
  const accessId = await getAccessId(fetcher);
  const groupIds = await getGridGroupIds(sport, fetcher, accessId).catch(() => []);
  const targets = groupIds.length ? groupIds : [null];
  const requests = targets.map(async (gridGroupId) => {
    const url = new URL(FIXTURE_BASE);
    for (const [key, value] of Object.entries({
      'x-bwin-accessid': accessId, lang: 'en-us', country: 'US', userCountry: 'US', offerMapping: 'Filtered',
      sportIds: ids.sportId, competitionIds: ids.competitionId, fixtureTypes: 'Standard', sortBy: 'StartDate', offerCategories: 'Gridable',
    })) url.searchParams.set(key, value);
    if (gridGroupId) url.searchParams.set('gridGroupId', gridGroupId);
    return transportJson(url, fetcher);
  });
  const settled = await Promise.allSettled(requests);
  const good = settled.filter((row) => row.status === 'fulfilled').map((row) => row.value);
  if (!good.length) {
    const rejected = settled.find((row) => row.status === 'rejected');
    throw rejected?.reason || Object.assign(new Error('BETMGM_PUBLIC_FAILED'), { code: 'BETMGM_PUBLIC_FAILED' });
  }
  const transports = [...new Set(good.map((row) => row.transport).filter(Boolean))];
  return {
    data: { fixtures: mergeFixtures(good.map((row) => row.data)) },
    transport: transports.length === 1 ? transports[0] : 'betmgm-mixed-public',
    groupsChecked: targets.length,
  };
}

export function betMgmSupportedSports() { return Object.keys(IDS); }
export async function fetchBetMgmPublic(sport, { fetcher = globalThis.fetch, force = false } = {}) {
  sport = text(sport).toUpperCase();
  if (!IDS[sport]) throw Object.assign(new Error('BETMGM_UNSUPPORTED_SPORT'), { code: 'BETMGM_UNSUPPORTED_SPORT' });
  const hit = cache.get(sport);
  if (!force && hit?.expires > Date.now()) return { ...hit.value, cached: true };
  if (pending.has(sport)) return pending.get(sport);
  const task = (async () => {
    const fetched = await fetchPayload(sport, fetcher);
    const fixtures = list(fetched.data?.fixtures).filter(futureFixture);
    const maxEvents = Math.min(fixtures.length, Math.max(1, Number(process.env.AUTOSCOUT_BETMGM_MAX_EVENTS_PER_SPORT || 6)));
    const records = [];
    for (const fixture of fixtures.slice(0, maxEvents)) {
      for (const market of list(fixture?.optionMarkets)) records.push(...parseMarket(sport, market, fixture));
    }
    const value = { records, fetchedAt: new Date().toISOString(), endpoint: `www.${STATE}.betmgm.com`, transport: fetched.transport, eventsChecked: Math.min(fixtures.length, maxEvents), groupsChecked: Number(fetched.groupsChecked || 0) };
    cache.set(sport, { expires: Date.now() + TTL_MS, value });
    return value;
  })();
  pending.set(sport, task);
  try { return await task; } finally { pending.delete(sport); }
}
