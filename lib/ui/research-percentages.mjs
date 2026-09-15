import { toNumberOrNull as num } from '../props/model.mjs';

// Research counts use all eligible games, including pushes. Do not reuse this
// denominator for model probabilities or the legacy decided-games scanner.
export function researchRate(window) {
  const games = num(window?.games), hits = num(window?.hits);
  if (!Number.isInteger(games) || games <= 0 || !Number.isInteger(hits) || hits < 0 || hits > games) return null;
  return 100 * hits / games;
}
export function formatResearchRate(value, missing = 'N/A') {
  const rate = num(value);
  if (rate === null || rate < 0 || rate > 100) return missing;
  return `${Number(rate.toFixed(1))}%`;
}
export function researchSideRates(window, side) {
  const active = researchRate(window), games = num(window?.games);
  const misses = num(window?.misses), pushes = num(window?.pushes);
  if (active === null || !['OVER', 'UNDER'].includes(side) ||
      !Number.isInteger(misses) || misses < 0 || !Number.isInteger(pushes) || pushes < 0 ||
      num(window.hits) + misses + pushes !== games) return null;
  const opposite = 100 * misses / games;
  return {over: side === 'UNDER' ? opposite : active,
    under: side === 'UNDER' ? active : opposite, push: 100 * pushes / games, games};
}
