const BASE = 'https://api.the-odds-api.com/v4';

const SPORT_KEYS = Object.freeze({
  NFL: 'americanfootball_nfl',
  NCAAF: 'americanfootball_ncaaf',
  NBA: 'basketball_nba',
  NCAAB: 'basketball_ncaab',
  WNBA: 'basketball_wnba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
});

// Keep the default universe at 10 books. The Odds API bills each group of
// up to 10 explicitly requested bookmakers as one region-equivalent.
// This mixes DFS apps and sportsbooks without paying for multiple regions.
const DEFAULT_BOOKMAKERS = Object.freeze([
  'prizepicks',
  'underdog',
  'pick6',
  'dabble_us_dfs',
  'draftkings',
  'fanduel',
  'betmgm',
  'williamhill_us',
  'fanatics',
  'betrivers',
]);

const boardCache = new Map();
const marketCache = new Map();
const quota = {
  used: null,
  remaining: null,
  lastCost: null,
  updatedAt: null,
};

const text = (value) => String(value ?? '').trim();
const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const intEnv = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

function monthlyCredits() {
  return intEnv('THE_ODDS_API_MONTHLY_CREDITS', 20_000, 500, 100_000_000);
}
function quotaRatio() {
  if (!Number.isFinite(quota.remaining)) return 1;
  return Math.max(0, Math.min(1, quota.remaining / monthlyCredits()));
}
function cacheMs() {
  const baseSeconds = intEnv('THE_ODDS_API_CACHE_SECONDS', 2700, 60, 21600);
  const ratio = quotaRatio();
  // Automatically stretch freshness before the paid monthly quota is burned.
  const multiplier = ratio <= 0.10 ? 4 : ratio <= 0.25 ? 2 : ratio <= 0.50 ? 1.35 : 1;
  return Math.round(baseSeconds * multiplier) * 1000;
}
function marketCacheMs() {
  return intEnv('THE_ODDS_API_MARKET_CACHE_SECONDS', 21600, 900, 86400) * 1000;
}
function maxEvents() {
  const configured = intEnv('THE_ODDS_API_MAX_EVENTS', 2, 1, 50);
  return quotaRatio() <= 0.10 ? 1 : configured;
}
function maxMarketsPerEvent() {
  const configured = intEnv('THE_ODDS_API_MAX_MARKETS_PER_EVENT', 6, 1, 50);
  if (quotaRatio() <= 0.10) return Math.min(3, configured);
  if (quotaRatio() <= 0.25) return Math.min(4, configured);
  return configured;
}
function configuredBookmakers() {
  const raw = text(process.env.THE_ODDS_API_BOOKMAKERS);
  const values = (raw ? raw.split(',') : DEFAULT_BOOKMAKERS)
    .map(v => text(v).toLowerCase())
    .filter(Boolean);
  // The default stays at ten for quota efficiency. A user can deliberately
  // override this up to 20, but that doubles the region-equivalent cost.
  return [...new Set(values)].slice(0, 20);
}
function regularPlayerMarket(key) {
  const value = text(key).toLowerCase();
  // PrizePicks goblins/demons and other milestone/alternate selections are
  // exposed by The Odds API under *_alternate market keys. Never ingest them.
  return value.startsWith('player_') && !value.endsWith('_alternate') && !value.includes('_alternate_');
}
function marketLabel(key) {
  return text(key)
    .replace(/^player_/, '')
    .replace(/_/g, ' ')
    .replace(/\bpts\b/gi, 'Points')
    .replace(/\brebs\b/gi, 'Rebounds')
    .replace(/\basts\b/gi, 'Assists')
    .replace(/\btds\b/gi, 'TDs')
    .replace(/\byds\b/gi, 'Yards')
    .replace(/\bfgs\b/gi, 'Field Goals')
    .replace(/\b\w/g, m => m.toUpperCase());
}
function sideOf(name) {
  const side = text(name).toUpperCase();
  return side === 'OVER' || side === 'UNDER' ? side : null;
}
function eventStatus(event, scoreRow) {
  if (scoreRow?.completed === true) return { live: false, started: true, completed: true };
  const start = Date.parse(event?.commence_time || '');
  const started = Number.isFinite(start) && start <= Date.now();
  return { live: started, started, completed: false };
}
function scoreMap(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(text(row?.id), row);
  return map;
}
function scoreFor(row, team) {
  const score = (row?.scores || []).find(item => text(item?.name) === text(team));
  return numberOrNull(score?.score);
}
function median(values) {
  const nums = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function americanImplied(price) {
  const p = numberOrNull(price);
  if (p === null || p === 0) return null;
  return p > 0 ? 100 / (p + 100) : (-p) / ((-p) + 100);
}
function updateQuota(headers) {
  if (!headers) return;
  const used = numberOrNull(headers.get('x-requests-used'));
  const remaining = numberOrNull(headers.get('x-requests-remaining'));
  const lastCost = numberOrNull(headers.get('x-requests-last'));
  if (used !== null) quota.used = used;
  if (remaining !== null) quota.remaining = remaining;
  if (lastCost !== null) quota.lastCost = lastCost;
  quota.updatedAt = new Date().toISOString();
}
function quotaSnapshot() {
  return {
    ...quota,
    monthlyCredits: monthlyCredits(),
    remainingRatio: quotaRatio(),
    conservationMode: quotaRatio() <= 0.25,
  };
}
async function apiGet(path, params, signal) {
  const key = text(process.env.THE_ODDS_API_KEY);
  if (!key) throw Object.assign(new Error('THE_ODDS_API_KEY is not configured'), { code: 'NOT_CONFIGURED' });
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apiKey', key);
  for (const [name, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(name, String(value));
  }
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  updateQuota(res.headers);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || body?.error || `The Odds API request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.code = body?.error_code || body?.code || 'ODDS_API_ERROR';
    throw error;
  }
  return body;
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      output[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return output;
}

async function discoverMarkets(sportKey, eventId, bookmakers, signal) {
  const cacheKey = `${sportKey}:${eventId}:${bookmakers.join(',')}`;
  const cached = marketCache.get(cacheKey);
  if (cached && Date.now() - cached.at < marketCacheMs()) return cached.markets;

  const body = await apiGet(`/sports/${sportKey}/events/${eventId}/markets`, {
    bookmakers: bookmakers.join(','),
    dateFormat: 'iso',
  }, signal);

  const counts = new Map();
  for (const book of body?.bookmakers || []) {
    for (const market of book?.markets || []) {
      const key = text(market?.key).toLowerCase();
      if (!regularPlayerMarket(key)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  // Prefer prop markets present at the most books. That creates a denser
  // comparison board while keeping the $30 plan's credit burn under control.
  const markets = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
    .slice(0, maxMarketsPerEvent());

  marketCache.set(cacheKey, { at: Date.now(), markets });
  return markets;
}

function normalizeEventOdds(event, league, scoreRow) {
  const rows = [];
  const status = eventStatus(event, scoreRow);
  const homeScore = scoreFor(scoreRow, event?.home_team);
  const awayScore = scoreFor(scoreRow, event?.away_team);

  for (const bookmaker of event?.bookmakers || []) {
    for (const market of bookmaker?.markets || []) {
      const marketKey = text(market?.key).toLowerCase();
      if (!regularPlayerMarket(marketKey)) continue;
      for (const outcome of market?.outcomes || []) {
        const side = sideOf(outcome?.name);
        const line = numberOrNull(outcome?.point);
        const playerName = text(outcome?.description);
        if (!side || line === null || !playerName) continue;
        const sportsbookKey = text(bookmaker?.key).toLowerCase();
        const price = numberOrNull(outcome?.price);
        rows.push({
          id: [event?.id, marketKey, playerName, side, line, sportsbookKey].join('|'),
          source: 'The Odds API',
          sport: league,
          eventId: text(event?.id),
          playerId: playerName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          playerName,
          team: '',
          statId: marketKey,
          marketId: marketKey,
          market: marketLabel(marketKey),
          period: 'game',
          side,
          line,
          price: price ?? '',
          impliedProbability: americanImplied(price),
          sportsbook: text(bookmaker?.title || bookmaker?.key),
          sportsbookKey,
          fairOdds: '',
          fairLine: null,
          gameStartTime: event?.commence_time || null,
          homeTeam: text(event?.home_team),
          awayTeam: text(event?.away_team),
          homeScore,
          awayScore,
          ...status,
          updatedAt: market?.last_update || bookmaker?.last_update || null,
          deeplink: '',
        });
      }
    }
  }

  // Add a median cross-book line to each row without spending another credit.
  const groups = new Map();
  for (const row of rows) {
    const key = [row.eventId, row.marketId, row.playerName.toLowerCase(), row.side].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.line);
  }
  for (const row of rows) {
    const key = [row.eventId, row.marketId, row.playerName.toLowerCase(), row.side].join('|');
    row.fairLine = median(groups.get(key) || []);
  }

  return rows;
}

function upcomingFirst(events) {
  return [...events].sort((a, b) => {
    const at = Date.parse(a?.commence_time || '') || Infinity;
    const bt = Date.parse(b?.commence_time || '') || Infinity;
    const aLive = at <= Date.now();
    const bLive = bt <= Date.now();
    if (aLive !== bLive) return aLive ? -1 : 1;
    return at - bt;
  });
}

export async function fetchTheOddsApiBoard(league, { signal, force = false } = {}) {
  const selected = text(league).toUpperCase();
  const sportKey = SPORT_KEYS[selected];
  if (!sportKey) throw Object.assign(new Error(`The Odds API sport is not mapped: ${selected}`), { code: 'UNSUPPORTED_SPORT' });
  if (!text(process.env.THE_ODDS_API_KEY)) throw Object.assign(new Error('THE_ODDS_API_KEY is not configured'), { code: 'NOT_CONFIGURED' });

  const bookmakers = configuredBookmakers();
  const key = `theodds:${selected}:${bookmakers.join(',')}`;
  const cached = boardCache.get(key);
  // Browser refresh must never bypass this cache on a quota-metered plan.
  if (cached && Date.now() - cached.at < cacheMs()) return cached.value;

  const startedAt = Date.now();
  const [eventRows, scores] = await Promise.all([
    // Event discovery is free from quota.
    apiGet(`/sports/${sportKey}/events`, {}, signal),
    // Scores cost one credit and also give us live/completed state.
    apiGet(`/sports/${sportKey}/scores`, { dateFormat: 'iso' }, signal).catch(() => []),
  ]);

  const events = upcomingFirst(Array.isArray(eventRows) ? eventRows : []).slice(0, maxEvents());
  const scoresById = scoreMap(scores);

  const eventResults = await mapLimit(events, 2, async (event) => {
    const eventId = text(event?.id);
    if (!eventId) return { rows: [], markets: [] };
    const markets = await discoverMarkets(sportKey, eventId, bookmakers, signal);
    if (!markets.length) return { rows: [], markets: [] };

    const odds = await apiGet(`/sports/${sportKey}/events/${eventId}/odds`, {
      bookmakers: bookmakers.join(','),
      markets: markets.join(','),
      oddsFormat: 'american',
      dateFormat: 'iso',
      includeMultipliers: 'true',
    }, signal);

    return {
      rows: normalizeEventOdds(odds, selected, scoresById.get(eventId)),
      markets,
    };
  });

  const rows = eventResults.flatMap(r => r.rows || []);
  const sportsbooks = [...new Set(rows.map(row => row.sportsbookKey).filter(Boolean))].sort();
  const marketKeys = [...new Set(eventResults.flatMap(r => r.markets || []))].sort();
  const value = {
    props: rows,
    meta: {
      provider: 'The Odds API',
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      events: events.length,
      sportsbooks,
      sportsbookCount: sportsbooks.length,
      propCount: rows.length,
      liveEvents: new Set(rows.filter(row => row.live).map(row => row.eventId)).size,
      fullBookCoverage: true,
      regularLinesOnly: true,
      marketKeys,
      cacheSeconds: Math.round(cacheMs() / 1000),
      maxEvents: maxEvents(),
      maxMarketsPerEvent: maxMarketsPerEvent(),
      requestedBookmakers: bookmakers,
      quota: quotaSnapshot(),
      conservationMode: quotaRatio() <= 0.25,
    },
  };

  boardCache.set(key, { at: Date.now(), value });
  return value;
}

export function theOddsApiHealth() {
  return {
    configured: Boolean(text(process.env.THE_ODDS_API_KEY)),
    sportKeys: { ...SPORT_KEYS },
    bookmakers: configuredBookmakers(),
    regularLinesOnly: true,
    cacheSeconds: Math.round(cacheMs() / 1000),
    maxEvents: maxEvents(),
    maxMarketsPerEvent: maxMarketsPerEvent(),
    quota: quotaSnapshot(),
  };
}

export function normalizeTheOddsApiFixture(event, league = 'NBA', scoreRow = null) {
  return normalizeEventOdds(event, league, scoreRow);
}
