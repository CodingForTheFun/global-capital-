import { rollingAnalytics } from './rolling.mjs';
import { toNumberOrNull as num } from '../props/model.mjs';
export function researchTeamMatches(a, b) {
  const clean = value => String(value || '').replace(/^(nfl|nba|wnba|nhl|mlb|ncaaf|ncaab)[_:-]/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return Boolean(clean(a) && clean(b) && clean(a) === clean(b));
}

// Shared by the API and the research sheet. A returned sample is not a season.
export function analyzeResearch(base = {}, line = base.line, side = base.side, venue = 'all') {
  const threshold = num(line);
  const direction = side === 'UNDER' ? 'UNDER' : 'OVER';
  const opponent = base.matchup?.opponent;
  const seen = new Set();
  const all = (base.gameLog || []).map(row => ({ ...row, value: num(row.value) }))
    .filter(row => {
      if (row.value === null) return false;
      const id = row.gameId || (row.date ? `${row.date}|${row.opponent || ''}` : null);
      if (id && seen.has(id)) return false;
      if (id) seen.add(id);
      return true;
    }).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const rows = all.filter(row => venue === 'home' ? row.isHome === true
    : venue === 'away' ? row.isHome === false
    : venue === 'h2h' ? researchTeamMatches(row.opponent, opponent) : true);
  const analytics = rollingAnalytics(rows, threshold, direction);
  const complete = base.coverage?.seasonComplete === true && base.season != null;
  if (!complete) analytics.windows.season = {
    label: 'Season', games: null, sampleSize: null, average: null, median: null,
    volatility: null, hits: null, misses: null, pushes: null, hitRate: null,
    available: false, reason: 'Complete season data is unavailable.',
  };
  const h2hRows = rows.filter(row => researchTeamMatches(row.opponent, opponent));
  const h2h = rollingAnalytics(h2hRows, threshold, direction).windows.season;
  return {
    ...base, line: threshold, side: direction, windows: analytics.windows,
    trend: analytics.trend, splits: analytics.splits, h2h,
    gameLog: rows.map(row => ({ ...row,
      push: threshold === null ? null : row.value === threshold,
      hit: threshold === null || row.value === threshold ? null
        : direction === 'UNDER' ? row.value < threshold : row.value > threshold,
    })),
    coverage: { ...base.coverage, gamesReturned: all.length, gamesSampled: rows.length, h2hGames: h2hRows.length, seasonComplete: complete },
  };
}

export function researchSections(result = {}) {
  const c = result.context || {};
  return { gameLog: Boolean(result.available && result.gameLog?.length),
    seasonTotal: num(c.seasonStat) !== null, seasonAverage: num(c.seasonAverage) !== null,
    projection: num(c.projection) !== null, context: Object.values(c).some(v => v != null && v !== '') };
}

// Only persisted observations from one prop/book/side belong in a history series.
export function analyzeLineHistory(input = [], { propId, bookmaker, side } = {}) {
  const seen = new Set();
  const rows = input.filter(row => (!propId || row.prop_id === propId)
    && row.bookmaker_key === bookmaker && row.side === side)
    .map(row => ({ ...row, line: num(row.line), price: num(row.price), observedAt: Date.parse(row.created_at) }))
    .filter(row => {
      if (row.line === null || !Number.isFinite(row.observedAt)) return false;
      const key = `${row.observedAt}|${row.line}|${row.price}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => a.observedAt - b.observedAt);
  const changes = rows.filter((row, i) => !i || row.line !== rows[i - 1].line || row.price !== rows[i - 1].price);
  const first = rows[0] || null, last = rows.at(-1) || null;
  return { rows, changes, first, last, lineChange: first && last ? last.line - first.line : null,
    building: new Set(rows.map(row => row.observedAt)).size < 2 };
}
