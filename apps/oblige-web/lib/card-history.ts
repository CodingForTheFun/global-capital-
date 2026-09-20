import type { PropGroup, ResearchResponse, ResearchWindow } from './types';
import { computeWindow, sortRecentFirst, streakOf } from './analytics';
import { finiteNumber } from './prop-signals';
export type CardMetric = { label: string; value: number | null; percent?: boolean; sample?: number; tone?: 'positive' | 'negative'; note?: string };
export function cardHistory(response: ResearchResponse | null | undefined, group: PropGroup): CardMetric[] {
  const valid = response && response.available !== false;
  // Null/DNP/boolean values must never enter the denominator as zero.
  const games = valid ? sortRecentFirst((response.gameLog || []).filter(row => typeof row.value === 'number' && Number.isFinite(row.value))) : [];
  const windows = valid ? response.windows || {} : {};
  const metric = (label: string, window: ResearchWindow | undefined, take?: number): CardMetric => {
    const count = finiteNumber(window?.sampleSize ?? window?.games);
    const raw = finiteNumber(window?.hitRate);
    if (window?.available !== false && count !== null && count > 0 && raw !== null && raw >= 0 && raw <= 100) {
      return { label, value: raw, percent: true, sample: count, note: window?.partial ? 'Partial sample' : undefined };
    }
    if (take && games.length) {
      const w = computeWindow(games, group.line, 'OVER', label, label, take);
      return { label, value: w.hitRate, percent: true, sample: w.games };
    }
    return { label, value: null, percent: true };
  };
  const last10 = computeWindow(games, group.line, 'OVER', 'l10', 'L10', 10);
  const summary = windows.last10 || windows.l10;
  const avg = (summary?.available !== false && (finiteNumber(summary?.sampleSize ?? summary?.games) || 0) > 0 ? finiteNumber(summary?.average) : null) ?? last10.average;
  const streak = streakOf(games, group.line, 'OVER');
  const h2h = metric('H2H', valid ? response.h2h || windows.h2h : undefined);
  // Use the provider's exact-opponent summary; do not guess team identities.
  const season = metric('SZN', windows.season || windows.szn);
  return [metric('L5', windows.last5 || windows.l5, 5), metric('L10', windows.last10 || windows.l10, 10), metric('L15', windows.last15 || windows.l15, 15), h2h,
    { label: 'STRK', value: streak?.count ?? null, tone: streak ? streak.over ? 'positive' : 'negative' : undefined, note: streak ? streak.over ? 'Consecutive overs' : 'Consecutive unders' : undefined },
    { label: 'AVG', value: avg, note: 'Last 10 completed games' },
    { label: 'DIFF', value: avg === null ? null : avg - group.line, note: 'L10 average minus posted line' }, season];
}
