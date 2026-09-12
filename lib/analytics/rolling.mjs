// Rolling player analytics computed from real game logs.
//
// A hit rate is measured against THIS PROP'S actual line and direction. Missing
// games/lines remain null. Pushes are excluded from the decided denominator.

import { toNumberOrNull, isSetNumber } from '../props/model.mjs';

export const WINDOWS = Object.freeze([
  { id: 'l5', label: 'Last 5', games: 5 },
  { id: 'l10', label: 'Last 10', games: 10 },
  { id: 'l15', label: 'Last 15', games: 15 },
  { id: 'l20', label: 'Last 20', games: 20 },
  { id: 'season', label: 'Season', games: null },
]);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
}

function stdDev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Number(Math.sqrt(variance).toFixed(2));
}

function beatsLine(value, line, direction) {
  return direction === 'UNDER' ? value < line : value > line;
}

export function rollingAnalytics(games = [], line, side = 'OVER', policy = {}) {
  const lineValue = toNumberOrNull(line);
  const direction = String(side || '').toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
  const usable = (Array.isArray(games) ? games : [])
    .map((game) => ({ ...game, value: toNumberOrNull(game?.value) }))
    .filter((game) => game.value !== null);

  const windows = {};
  for (const window of WINDOWS) {
    const slice = window.games ? usable.slice(0, window.games) : usable;
    const values = slice.map((game) => game.value);
    if (!values.length) {
      windows[window.id] = {
        label: window.label, games: 0, sampleSize: 0,
        average: null, median: null, volatility: null,
        hits: null, misses: null, pushes: null, hitRate: null,
      };
      continue;
    }

    let hits = 0;
    let misses = 0;
    let pushes = 0;
    if (lineValue !== null) {
      for (const value of values) {
        if (value === lineValue) { pushes++; continue; }
        if (beatsLine(value, lineValue, direction)) hits++; else misses++;
      }
    }
    const decided = hits + misses;
    const denominator = policy.denominator === 'games' ? values.length : decided;
    windows[window.id] = {
      label: window.label,
      games: values.length,
      sampleSize: values.length,
      average: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
      mean: values.reduce((a,b)=>a+b,0)/values.length,
      median: median(values),
      volatility: stdDev(values),
      hits: lineValue === null ? null : hits,
      misses: lineValue === null ? null : misses,
      pushes: lineValue === null ? null : pushes,
      hitRate: lineValue === null || denominator === 0 ? null : Math.round((hits / denominator) * 100),
      rateBasis: policy.denominator === 'games' ? 'all_games' : 'decided_games',
      decidedHitRate: lineValue === null || !decided ? null : Math.round(hits/decided*100),
    };
  }

  const short = windows.l5?.average;
  const long = windows.l20?.average ?? windows.season?.average;
  let trend = null;
  if (isSetNumber(short) && isSetNumber(long) && long !== 0) {
    const delta = ((short - long) / Math.abs(long)) * 100;
    trend = { direction: delta > 5 ? 'UP' : delta < -5 ? 'DOWN' : 'FLAT', deltaPercent: Number(delta.toFixed(1)) };
  }

  return {
    line: lineValue,
    side: direction,
    windows,
    trend,
    streak: currentStreak(usable, lineValue, direction, policy),
    splits: venueSplits(usable, lineValue, direction, policy),
    gameLog: usable.slice(0, 20).map((game) => ({
      value: game.value,
      date: game.date ?? null,
      opponent: game.opponent ?? null,
      isHome: typeof game.isHome === 'boolean' ? game.isHome : null,
      hit: lineValue === null || game.value === lineValue ? null : beatsLine(game.value, lineValue, direction),
    })),
  };
}

/**
 * Consecutive most-recent games that landed on the active side.
 *
 * `games` is already newest-first. A push neither continues nor breaks the run,
 * so it is skipped rather than counted; the first decided miss ends it. Without
 * a line nothing is decided and the streak stays null rather than becoming 0,
 * because "no line" and "zero in a row" are different answers.
 */
export function currentStreak(games = [], line, side = 'OVER', policy = {}) {
  const lineValue = toNumberOrNull(line);
  if (lineValue === null) return null;
  const direction = String(side || '').toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
  const usable = (Array.isArray(games) ? games : [])
    .map((game) => toNumberOrNull(game?.value))
    .filter((value) => value !== null);
  let count = 0;
  for (const value of usable) {
    if (value === lineValue) { if (policy.pushBreaksStreak) break; continue; }
    if (!beatsLine(value, lineValue, direction)) break;
    count++;
  }
  return { count, side: direction, decided: usable.some((value) => value !== lineValue) };
}

function venueSplits(games, line, direction, policy = {}) {
  const marked = games.filter((game) => typeof game.isHome === 'boolean');
  if (!marked.length) return null;
  const build = (subset) => {
    if (!subset.length) return null;
    let hits = 0;
    let decided = 0;
    for (const game of subset) {
      if (line === null || game.value === line) continue;
      decided++;
      if (beatsLine(game.value, line, direction)) hits++;
    }
    return {
      games: subset.length,
      average: Number((subset.reduce((sum, game) => sum + game.value, 0) / subset.length).toFixed(2)),
      hitRate: line === null ? null : policy.denominator === 'games' ? Math.round(hits/subset.length*100) : decided ? Math.round((hits / decided) * 100) : null,
    };
  };
  return { home: build(marked.filter((g) => g.isHome)), away: build(marked.filter((g) => !g.isHome)) };
}

/** Fill hit-rate gaps from computed windows without overwriting trusted source data. */
export function mergeHitRates(existing = {}, analytics) {
  const windows = analytics?.windows || {};
  const out = { ...existing };
  for (const id of ['l5', 'l10', 'l15', 'l20', 'season']) {
    const computed = windows[id]?.hitRate;
    if (!isSetNumber(out[id]) && isSetNumber(computed)) out[id] = computed;
  }
  return out;
}
