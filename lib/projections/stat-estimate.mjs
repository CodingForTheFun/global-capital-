// Display-only recent-form estimate. Never a sportsbook line or measured stat.
import { weightedStats, logValues, HALF_LIFE_GAMES, MIN_SAMPLE } from './baseline.mjs';
export function projectedStat(research) {
  if (!research?.available || !Array.isArray(research.gameLog)) return null;
  const values = logValues(research.gameLog.slice(0,25));
  if (values.length < MIN_SAMPLE) return null;
  const stats = weightedStats(values);
  return { value: stats.mean, modelled: true, source: 'Recent-form estimate',
    method: `Recency-weighted mean, ${HALF_LIFE_GAMES}-game half-life`,
    sampleSize: values.length, effectiveSample: stats.effectiveSample,
    note: 'History-based baseline, not an AI prediction. No injury or opponent adjustment.' };
}
