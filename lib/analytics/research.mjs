import { rollingAnalytics } from './rolling.mjs';
import { toNumberOrNull as num } from '../props/model.mjs';
const RESEARCH_POLICY = Object.freeze({denominator:'games',pushBreaksStreak:true});
const researchAnalytics = (rows,line,side) => rollingAnalytics(rows,line,side,RESEARCH_POLICY);
// Aggregate an explicitly selected cohort without claiming complete season coverage.
export function summarizeResearchSample(rows, line, side) {
  return {...researchAnalytics(rows,line,side).windows.season,label:'Selected sample'};
}
export function researchTeamMatches(a, b) {
  const aliases = {
    GNB:'GB', GB:'GB', KAN:'KC', KC:'KC', NWE:'NE', NE:'NE', NOR:'NO', NO:'NO',
    SFO:'SF', SF:'SF', TAM:'TB', TB:'TB', LVR:'LV', LV:'LV', JAC:'JAX', JAX:'JAX',
    PHO:'PHX', PHX:'PHX', BRK:'BKN', BKN:'BKN', GSW:'GS', GS:'GS', SAS:'SA', SA:'SA',
    NYK:'NY', NY:'NY', UTAH:'UTA', UTA:'UTA', WSH:'WAS', WAS:'WAS',
  };
  const clean = value => {
    const key = String(value || '').replace(/^(nfl|nba|wnba|nhl|mlb|ncaaf|ncaab|cbb|cfb)[_:-]/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return aliases[key] || key;
  };
  return Boolean(clean(a) && clean(b) && clean(a) === clean(b));
}
export function researchOpponentMatches(row, matchup = {}) {
  if (matchup.opponentId != null) return row.opponentId != null && String(row.opponentId) === String(matchup.opponentId);
  return researchTeamMatches(row.opponent, matchup.opponent) || researchTeamMatches(row.opponentName, matchup.opponent);
}

// Shared by the API and the research sheet. A returned sample is not necessarily
// a complete season, but real current-season rows are still valid season-to-date
// evidence and should not be hidden behind an all-or-nothing coverage flag.
export function analyzeResearch(base = {}, line = base.line, side = base.side, venue = 'all') {
  const threshold = num(line);
  const direction = side === 'UNDER' ? 'UNDER' : 'OVER';
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
    : venue === 'h2h' ? researchOpponentMatches(row, base.matchup) : true);
  const analytics = researchAnalytics(rows, threshold, direction);
  const complete = base.coverage?.seasonComplete === true && base.season != null;
  const seasonRows = rows.filter(row => (row.season == null ? complete : String(row.season) === String(base.season)) && (row.seasonType == null || Number(row.seasonType) === 2));
  if (complete) analytics.windows.season = researchAnalytics(seasonRows, threshold, direction).windows.season;
  if (!complete && seasonRows.length && base.season != null) analytics.windows.season = {...researchAnalytics(seasonRows,threshold,direction).windows.season,available:true,partial:true,reason:'Available current regular-season games; coverage is incomplete.'};
  if (!complete && !(seasonRows.length && base.season != null)) analytics.windows.season = {
    label: 'Season', games: null, sampleSize: null, average: null, median: null,
    volatility: null, hits: null, misses: null, pushes: null, hitRate: null,
    available: false, reason: 'No verified current regular-season game logs are available.',
  };
  const h2hRows = rows.filter(row => researchOpponentMatches(row, base.matchup));
  const h2h = researchAnalytics(h2hRows, threshold, direction).windows.season;
  return {
    ...base, line: threshold, side: direction, windows: analytics.windows,
    context: { ...(base.context || {}), ...(seasonRows.length ? {
      seasonAverage: analytics.windows.season.average,
      averageMinutes: seasonRows.every(row => num(row.minutes) !== null)
        ? seasonRows.reduce((sum,row) => sum + num(row.minutes),0)/seasonRows.length : null,
    } : {}) },
    trend: analytics.trend, splits: analytics.splits, h2h,
    streak: rows.length ? analytics.streak : null, diff: lineDifference({...analytics.windows,h2h}, threshold, base.averageWindow),
    rateBasis:'all_games',
    gameLog: rows.map(row => ({ ...row,
      push: threshold === null ? null : row.value === threshold,
      hit: threshold === null || row.value === threshold ? null
        : direction === 'UNDER' ? row.value < threshold : row.value > threshold,
    })),
    coverage: { ...base.coverage, gamesReturned: all.length, gamesSampled: rows.length, h2hGames: h2hRows.length,
      seasonGames: seasonRows.length, seasonComplete: complete, seasonPartial: seasonRows.length > 0 && !complete },
  };
}

/**
 * How far the player's scoring average sits from the offered line.
 *
 * Prefer the explicitly selected sample, otherwise a labeled season or rolling
 * sample. Use the same unrounded arithmetic mean for AVG and its line delta.
 * Partial current-season coverage remains labeled by the calling engine.
 */
export function lineDifference(windows = {}, line, selectedWindow) {
  const threshold = num(line);
  if (threshold === null) return null;
  const basis = [selectedWindow, 'season', 'l20', 'l15', 'l10', 'l5'].filter(Boolean).find((id) => num(windows[id]?.average) !== null);
  if (!basis) return null;
  const average = num(windows[basis].mean) ?? num(windows[basis].average);
  const value = Number((average - threshold).toFixed(2));
  return {
    basis,
    average,
    value,
    percent: threshold === 0 ? null : Number(((value / Math.abs(threshold)) * 100).toFixed(1)),
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

/** Numbers are newest-first. For SZN, supply the active season's regular games
 * separately; an unannotated array cannot honestly identify a season/opponent. */
export function calculatePropSplits(gameLogs, targetLine, isOver, opponentTeam, h2hLogs = [], options = {}) {
  const rows = (Array.isArray(gameLogs)?gameLogs:[]).map(v => typeof v === 'number' ? {value:v} : v);
  const side = isOver ? 'OVER' : 'UNDER';
  const line = num(targetLine);
  const stats = researchAnalytics(rows,line,side);
  const h2hRows = (Array.isArray(h2hLogs)?h2hLogs:[]).map(v=>typeof v==='number'?{value:v}:v)
    .filter(r=>r&&(!r.opponent||researchTeamMatches(r.opponent,opponentTeam)));
  const h2h = researchAnalytics(h2hRows,line,side).windows.season;
  const season = Array.isArray(options.seasonLogs) ? researchAnalytics(options.seasonLogs.map(v=>typeof v==='number'?{value:v}:v),line,side).windows.season : null;
  const w = stats.windows[options.window||'l15'] || stats.windows.l15;
  const average=num(w.mean)??num(w.average), difference=average===null||line===null?null:average-line;
  const fmt=w=>num(w?.hitRate)===null?'N/A':w.hitRate+'%';
  const streak=rows.some(r=>num(r?.value)!==null)?stats.streak:null;
  return { L5:fmt(stats.windows.l5),L10:fmt(stats.windows.l10),L15:fmt(stats.windows.l15),
    H2H:fmt(h2h),AVG:average===null?'N/A':average.toFixed(1),
    DIFF:difference===null?'N/A':(difference<0?'-':'+')+Math.abs(difference).toFixed(1),
    STRK:streak?streak.count+' '+(isOver?'Over':'Under'):'N/A',SZN:fmt(season),
    windows:stats.windows,h2h,season,rateBasis:'all_games',pushesBreakStreak:true };
}
