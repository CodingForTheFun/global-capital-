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

const NON_OU_MARKETS = new Set([
  'player_1st_td',
  'player_anytime_td',
  'player_last_td',
  'player_first_basket',
  'player_first_team_basket',
  'player_double_double',
  'player_triple_double',
  'player_method_of_first_basket',
  'batter_first_home_run',
  'pitcher_record_a_win',
  'player_goal_scorer_first',
  'player_goal_scorer_last',
  'player_goal_scorer_anytime',
]);

const boardCache = new Map();
const marketCache = new Map();
const quota = { used: null, remaining: null, lastCost: null, updatedAt: null };

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
function cacheSeconds() {
  const base = intEnv('THE_ODDS_API_CACHE_SECONDS', 2700, 60, 21600);
  const ratio = quotaRatio();
  if (ratio <= 0.10) return base * 4;
  if (ratio <= 0.25) return base * 2;
  if (ratio <= 0.50) return Math.round(base * 1.35);
  return base;
}
function marketCacheSeconds() {
  return intEnv('THE_ODDS_API_MARKET_CACHE_SECONDS', 21600, 900, 86400);
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
  const list = (raw ? raw.split(',') : DEFAULT_BOOKMAKERS)
    .map(value => text(value).toLowerCase())
    .filter(Boolean);
  return [...new Set(list)].slice(0, 20);
}
function isRegularOuPropMarket(key) {
  const value = text(key).toLowerCase();
  if (!value) return false;
  if (value.includes('_alternate')) return false;
  if (NON_OU_MARKETS.has(value)) return false;
  return value.startsWith('player_') || value.startsWith('batter_') || value.startsWith('pitcher_');
}
function marketLabel(key) {
  let value = text(key);
  if (value.startsWith('player_')) value = value.slice('player_'.length);
  return value
    .replace(/_/g, ' ')
    .replace(/\btds\b/gi, 'TDs')
    .replace(/\byds\b/gi, 'Yards')
    .replace(/\brbis\b/gi, 'RBIs')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
function sideOf(name) {
  const value = text(name).toUpperCase();
  return value === 'OVER' || value === 'UNDER' ? value : null;
}
function median(values) {
  const nums = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function americanImplied(value) {
  const price = numberOrNull(value);
  if (price === null || price === 0) return null;
  return price > 0 ? 100 / (price + 100) : (-price) / ((-price) + 100);
}
function scoreMap(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(text(row?.id), row);
  return map;
}
function scoreFor(row, team) {
  const score = (row?.scores || []).find((item) => text(item?.name) === text(team));
  return numberOrNull(score?.score);
}
function eventStatus(event, scoreRow) {
  if (scoreRow?.completed === true) return { live: false, started: true, completed: true };
  const start = Date.parse(event?.commence_time || '');
  const started = Number.isFinite(start) && start <= Date.now();
  return { live: started, started, completed: false };
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
  const apiKey = text(process.env.THE_ODDS_API_KEY);
  if (!apiKey) throw Object.assign(new Error('THE_ODDS_API_KEY is not configured'), { code: 'NOT_CONFIGURED' });

  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apiKey', apiKey);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  updateQuota(response.headers);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || `The Odds API request failed (${response.status})`);
    error.status = response.status;
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
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return output;
}

async function discoverMarkets(sportKey, eventId, bookmakers, signal) {
  const cacheKey = `${sportKey}:${eventId}:${bookmakers.join(',')}`;
  const cached = marketCache.get(cacheKey);
  if (cached && Date.now() - cached.at < marketCacheSeconds() * 1000) return cached.markets;

  const body = await apiGet(`/sports/${sportKey}/events/${eventId}/markets`, {
    bookmakers: bookmakers.join(','),
    dateFormat: 'iso',
  }, signal);

  const coverage = new Map();
  for (const bookmaker of body?.bookmakers || []) {
    for (const market of bookmaker?.markets || []) {
      const key = text(market?.key).toLowerCase();
      if (!isRegularOuPropMarket(key)) continue;
      coverage.set(key, (coverage.get(key) || 0) + 1);
    }
  }

  const markets = [...coverage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
    .slice(0, maxMarketsPerEvent());

  marketCache.set(cacheKey, { at: Date.now(), markets });
  return markets;
}

function normalizeEvent(event, league, scoreRow) {
  const rows = [];
  const status = eventStatus(event, scoreRow);
  const homeScore = scoreFor(scoreRow, event?.home_team);
  const awayScore = scoreFor(scoreRow, event?.away_team);

  for (const bookmaker of event?.bookmakers || []) {
    const sportsbookKey = text(bookmaker?.key).toLowerCase();
    const sportsbook = text(bookmaker?.title || bookmaker?.key);
    for (const market of bookmaker?.markets || []) {
      const marketKey = text(market?.key).toLowerCase();
      if (!isRegularOuPropMarket(marketKey)) continue;
      for (const outcome of market?.outcomes || []) {
        const side = sideOf(outcome?.name);
        const line = numberOrNull(outcome?.point);
        const playerName = text(outcome?.description);
        if (!side || line === null || !playerName) continue;
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
          sportsbook,
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

  // Consensus line is calculated locally from all returned books, so it costs
  // zero additional API credits.
  const linesByProp = new Map();
  for (const row of rows) {
    const key = [row.eventId, row.marketId, row.playerName.toLowerCase()].join('|');
    if (!linesByProp.has(key)) linesByProp.set(key, []);
    linesByProp.get(key).push(row.line);
  }
  for (const row of rows) {
    const key = [row.eventId, row.marketId, row.playerName.toLowerCase()].join('|');
    row.fairLine = median(linesByProp.get(key) || []);
  }

  return rows;
}

function upcomingFirst(events) {
  return [...events].sort((a, b) => {
    const aTime = Date.parse(a?.commence_time || '') || Infinity;
    const bTime = Date.parse(b?.commence_time || '') || Infinity;
    const aLive = aTime <= Date.now();
    const bLive = bTime <= Date.now();
    if (aLive !== bLive) return aLive ? -1 : 1;
    return aTime - bTime;
  });
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.eventId, row.marketId, row.playerName.toLowerCase(), row.side, row.line, row.sportsbookKey].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchTheOddsApiBoard(league, { signal } = {}) {
  const selected = text(league).toUpperCase();
  const sportKey = SPORT_KEYS[selected];
  if (!sportKey) throw Object.assign(new Error(`The Odds API sport is not mapped: ${selected}`), { code: 'UNSUPPORTED_SPORT' });
  if (!text(process.env.THE_ODDS_API_KEY)) throw Object.assign(new Error('THE_ODDS_API_KEY is not configured'), { code: 'NOT_CONFIGURED' });

  const bookmakers = configuredBookmakers();
  const cacheKey = `${selected}:${bookmakers.join(',')}`;
  const cached = boardCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cacheSeconds() * 1000) return cached.value;

  const startedAt = Date.now();
  const eventRows = await apiGet(`/sports/${sportKey}/events`, {}, signal);
  const events = upcomingFirst(Array.isArray(eventRows) ? eventRows : []).slice(0, maxEvents());

  let scores = [];
  if (events.length) {
    scores = await apiGet(`/sports/${sportKey}/scores`, { dateFormat: 'iso' }, signal).catch(() => []);
  }
  const scoresById = scoreMap(scores);

  const results = await mapLimit(events, 2, async (event) => {
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
      rows: normalizeEvent(odds, selected, scoresById.get(eventId)),
      markets,
    };
  });

  const props = dedupe(results.flatMap((result) => result.rows || []));
  const sportsbooks = [...new Set(props.map((row) => row.sportsbookKey).filter(Boolean))].sort();
  const marketKeys = [...new Set(results.flatMap((result) => result.markets || []))].sort();
  const q = quotaSnapshot();

  const value = {
    props,
    meta: {
      provider: 'The Odds API',
      preferredProvider: 'The Odds API',
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      events: events.length,
      sportsbooks,
      sportsbookCount: sportsbooks.length,
      propCount: props.length,
      liveEvents: new Set(props.filter((row) => row.live).map((row) => row.eventId)).size,
      regularLinesOnly: true,
      fullBookCoverage: true,
      marketKeys,
      requestedBookmakers: bookmakers,
      bookmakerRegionEquivalents: Math.ceil(bookmakers.length / 10),
      cacheSeconds: cacheSeconds(),
      maxEvents: maxEvents(),
      maxMarketsPerEvent: maxMarketsPerEvent(),
      quota: q,
      conservationMode: q.conservationMode,
      warning: q.conservationMode
        ? `API quota conservation mode is active with ${q.remaining ?? 'unknown'} credits remaining.`
        : null,
    },
  };

  boardCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export function theOddsApiHealth() {
  return {
    configured: Boolean(text(process.env.THE_ODDS_API_KEY)),
    sportKeys: { ...SPORT_KEYS },
    bookmakers: configuredBookmakers(),
    regularLinesOnly: true,
    cacheSeconds: cacheSeconds(),
    maxEvents: maxEvents(),
    maxMarketsPerEvent: maxMarketsPerEvent(),
    quota: quotaSnapshot(),
  };
}

export function normalizeTheOddsApiFixture(event, league = 'NBA', scoreRow = null) {
  return normalizeEvent(event, league, scoreRow);
}
