const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const CACHE = new Map();
const SCORE_TTL = 12_000;
const SUMMARY_TTL = 10_000;

export const LIVE_SPORTS = Object.freeze({
  NBA: { sport: 'basketball', league: 'nba', label: 'NBA' },
  WNBA: { sport: 'basketball', league: 'wnba', label: 'WNBA' },
  NFL: { sport: 'football', league: 'nfl', label: 'NFL' },
  CFB: { sport: 'football', league: 'college-football', label: 'College Football' },
  CBB: { sport: 'basketball', league: 'mens-college-basketball', label: 'College Basketball' },
  MLB: { sport: 'baseball', league: 'mlb', label: 'MLB' },
  NHL: { sport: 'hockey', league: 'nhl', label: 'NHL' },
});

function cacheGet(key, ttl) {
  const row = CACHE.get(key);
  return row && Date.now() - row.at < ttl ? row.value : null;
}
function cacheSet(key, value) { CACHE.set(key, { at: Date.now(), value }); return value; }

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'AutoPropScout/1.0 (+research dashboard)', accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Live data provider returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function dateKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function normalizeCompetitor(row = {}) {
  const team = row.team || {};
  return {
    id: team.id || null,
    name: team.displayName || team.shortDisplayName || team.name || 'Unknown',
    shortName: team.shortDisplayName || team.abbreviation || team.name || '—',
    abbreviation: team.abbreviation || null,
    logo: team.logo || null,
    score: row.score === undefined || row.score === null || row.score === '' ? null : Number(row.score),
    homeAway: row.homeAway || null,
    winner: Boolean(row.winner),
    record: row.records?.[0]?.summary || null,
  };
}

function normalizeEvent(event, key) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = normalizeCompetitor(competitors.find((row) => row.homeAway === 'home') || competitors[0]);
  const away = normalizeCompetitor(competitors.find((row) => row.homeAway === 'away') || competitors[1]);
  const status = event.status || competition.status || {};
  const type = status.type || {};
  return {
    provider: 'ESPN',
    sport: key,
    league: LIVE_SPORTS[key]?.label || key,
    eventId: String(event.id || competition.id || ''),
    name: event.name || `${away.name} at ${home.name}`,
    shortName: event.shortName || `${away.shortName} @ ${home.shortName}`,
    startTime: event.date || competition.date || null,
    state: type.state || 'pre',
    status: type.shortDetail || type.detail || type.description || 'Scheduled',
    statusName: type.name || null,
    displayClock: status.displayClock || null,
    period: status.period ?? null,
    completed: Boolean(type.completed),
    home,
    away,
    broadcasts: (competition.broadcasts || []).flatMap((row) => row.names || []).filter(Boolean),
    venue: competition.venue?.fullName || null,
    neutralSite: Boolean(competition.neutralSite),
  };
}

async function scoreboardFor(key, date = dateKey()) {
  const config = LIVE_SPORTS[key];
  if (!config) return [];
  const cacheKey = `score:${key}:${date}`;
  const cached = cacheGet(cacheKey, SCORE_TTL);
  if (cached) return cached;
  const url = `${ESPN}/${config.sport}/${config.league}/scoreboard?dates=${encodeURIComponent(date)}&limit=300`;
  const data = await fetchJson(url);
  return cacheSet(cacheKey, (data.events || []).map((event) => normalizeEvent(event, key)));
}

export async function getLiveScores({ sports, date } = {}) {
  const keys = (sports?.length ? sports : Object.keys(LIVE_SPORTS)).filter((key) => LIVE_SPORTS[key]);
  const settled = await Promise.allSettled(keys.map(async (key) => ({ key, events: await scoreboardFor(key, date || dateKey()) })));
  const games = [];
  const errors = [];
  for (const row of settled) {
    if (row.status === 'fulfilled') games.push(...row.value.events);
    else errors.push(row.reason?.message || 'Live score provider error');
  }
  games.sort((a, b) => {
    const stateOrder = { in: 0, pre: 1, post: 2 };
    return (stateOrder[a.state] ?? 3) - (stateOrder[b.state] ?? 3) || new Date(a.startTime || 0) - new Date(b.startTime || 0);
  });
  return { provider: 'ESPN', generatedAt: new Date().toISOString(), games, errors: [...new Set(errors)] };
}

export async function getGameSummary(sportKey, eventId) {
  const config = LIVE_SPORTS[String(sportKey || '').toUpperCase()];
  if (!config || !eventId) throw new Error('Unsupported live game.');
  const cacheKey = `summary:${sportKey}:${eventId}`;
  const cached = cacheGet(cacheKey, SUMMARY_TTL);
  if (cached) return cached;
  const url = `${ESPN}/${config.sport}/${config.league}/summary?event=${encodeURIComponent(eventId)}`;
  const data = await fetchJson(url);
  return cacheSet(cacheKey, data);
}

function normalizeName(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function athleteRows(summary = {}) {
  const rows = [];
  for (const teamBlock of summary.boxscore?.players || []) {
    const team = teamBlock.team || {};
    for (const category of teamBlock.statistics || []) {
      const labels = category.labels || category.names || [];
      for (const item of category.athletes || []) {
        const athlete = item.athlete || {};
        const stats = {};
        const values = item.stats || [];
        labels.forEach((label, index) => { if (label) stats[label] = values[index] ?? null; });
        rows.push({
          athleteId: athlete.id || null,
          name: athlete.displayName || athlete.fullName || athlete.shortName || 'Unknown player',
          shortName: athlete.shortName || athlete.displayName || null,
          headshot: athlete.headshot?.href || athlete.headshot || null,
          teamId: team.id || null,
          team: team.displayName || team.shortDisplayName || team.name || null,
          category: category.displayName || category.name || null,
          stats,
          statsArray: values,
        });
      }
    }
  }
  return rows;
}

export async function findLivePlayer({ sport, player }) {
  const key = String(sport || '').toUpperCase();
  const config = LIVE_SPORTS[key];
  if (!config) return { supported: false, live: false, player: null, gamesChecked: 0 };
  const target = normalizeName(player);
  if (!target) return { supported: true, live: false, player: null, gamesChecked: 0 };
  const games = await scoreboardFor(key);
  const relevant = games.filter((game) => game.state === 'in' || game.state === 'post').slice(0, 20);
  let gamesChecked = 0;
  for (const game of relevant) {
    try {
      const summary = await getGameSummary(key, game.eventId);
      gamesChecked++;
      const rows = athleteRows(summary);
      const exact = rows.find((row) => normalizeName(row.name) === target);
      const fuzzy = exact || rows.find((row) => {
        const n = normalizeName(row.name);
        return n.includes(target) || target.includes(n) || (target.split(' ').at(-1) && n.endsWith(target.split(' ').at(-1)));
      });
      if (!fuzzy) continue;
      return {
        supported: true,
        live: game.state === 'in',
        game,
        player: fuzzy,
        gamesChecked,
        updatedAt: new Date().toISOString(),
      };
    } catch {}
  }
  return { supported: true, live: false, player: null, gamesChecked, updatedAt: new Date().toISOString() };
}
