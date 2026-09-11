// A statistical baseline computed from the player's own game log.
//
// This exists for two reasons, and both of them are about accuracy.
//
// First, an anchor. A language model asked to project a stat cold will produce
// a plausible number, but "plausible" is not the same as "close". Handing it a
// recency-weighted mean and the spread around it turns the question from
// "what will he do?" into "what should move him off this number?", which is
// the question the model is actually good at.
//
// Second, a check. Forecasting research is consistent on one point: blending an
// expert forecast with a base rate beats either alone, because the two fail in
// different directions. So the baseline is also computed on the way back out,
// and the model's answer is shrunk toward it in proportion to how little
// confidence the model claimed. Nothing here overrides the model silently —
// every adjustment is reported in the payload.
//
// No fabrication: with too few games this returns `available: false` and the
// caller keeps the model's own numbers untouched rather than blending against
// a baseline built from nothing.

// Recency weighting. A half-life of six games means a game six back counts half
// as much as the most recent one — roughly a third of a season for the sports
// here, which matches how quickly usage actually changes.
export const HALF_LIFE_GAMES = 6;
// Below this the sample says too little to anchor anything.
export const MIN_SAMPLE = 4;
// Standard deviations either side of the baseline that a projection may sit in
// before it is treated as unsupported by the log.
export const PLAUSIBLE_SIGMA = 3;

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Values from a game log, most recent first, with nulls dropped. */
export function logValues(gameLog = []) {
  if (!Array.isArray(gameLog)) return [];
  return gameLog.map((row) => num(row?.value)).filter((value) => value !== null);
}

/**
 * The normal CDF, via the Abramowitz and Stegun 7.1.26 approximation of erf.
 *
 * Accurate to about 1.5e-7, which is far beyond what matters for a probability
 * displayed to one decimal place, and it avoids a dependency for one function.
 */
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Recency-weighted mean and the spread around it.
 *
 * The spread is measured around the *weighted* mean rather than the plain one,
 * so a player whose usage recently changed is not credited with a wide spread
 * that is really just the old level showing up as error.
 */
export function weightedStats(values = []) {
  if (!values.length) return null;
  const decay = Math.log(2) / HALF_LIFE_GAMES;
  let weightSum = 0;
  let valueSum = 0;
  values.forEach((value, index) => {
    const weight = Math.exp(-decay * index); // index 0 is the most recent game
    weightSum += weight;
    valueSum += weight * value;
  });
  const mean = valueSum / weightSum;

  let varianceSum = 0;
  values.forEach((value, index) => {
    const weight = Math.exp(-decay * index);
    varianceSum += weight * (value - mean) ** 2;
  });
  // Bessel-style correction on the effective sample, so a short log does not
  // report a falsely tight spread.
  const effective = weightSum ** 2 / values.reduce((sum, _v, index) => sum + Math.exp(-decay * index) ** 2, 0);
  const variance = effective > 1 ? (varianceSum / weightSum) * (effective / (effective - 1)) : varianceSum / weightSum;
  return {
    mean: Number(mean.toFixed(3)),
    stdDev: Number(Math.sqrt(Math.max(variance, 0)).toFixed(3)),
    effectiveSample: Number(effective.toFixed(2)),
  };
}

/**
 * How often the player actually cleared this line, smoothed toward even.
 *
 * A raw 5-for-5 is not 100%; Laplace smoothing (+1 hit, +1 miss) says 6/7, and
 * that is the number worth betting against. Pushes are excluded rather than
 * counted as half, matching how the rest of the app treats them.
 */
export function empiricalOverRate(values = [], line) {
  const threshold = num(line);
  if (threshold === null || !values.length) return null;
  let over = 0;
  let decided = 0;
  for (const value of values) {
    if (value === threshold) continue;
    decided += 1;
    if (value > threshold) over += 1;
  }
  if (!decided) return null;
  return { rate: (over + 1) / (decided + 2), decided, over };
}

/**
 * The baseline for one prop.
 *
 * `probabilityOver` blends two independent readings of the same log: how often
 * the player cleared the line, and where the line sits in a normal fit of his
 * recent output. They disagree most when the distribution is skewed, which is
 * exactly when neither alone should be trusted, so the average of the two is
 * steadier than either.
 */
export function projectionBaseline({ gameLog = [], line } = {}) {
  const values = logValues(gameLog);
  const threshold = num(line);
  if (values.length < MIN_SAMPLE || threshold === null) {
    return { available: false, sampleSize: values.length, reason: values.length < MIN_SAMPLE ? 'INSUFFICIENT_GAMES' : 'NO_LINE' };
  }
  const stats = weightedStats(values);
  const empirical = empiricalOverRate(values, threshold);
  // A zero spread means every logged game was identical. Treat it as unknown
  // rather than as certainty, which is what a normal fit would imply.
  const normal = stats.stdDev > 0 ? 1 - normalCdf((threshold - stats.mean) / stats.stdDev) : null;

  const readings = [empirical?.rate, normal].filter((value) => typeof value === 'number');
  const probabilityOver = readings.length
    ? Number((readings.reduce((sum, value) => sum + value, 0) / readings.length).toFixed(4))
    : null;

  return {
    available: true,
    projection: stats.mean,
    stdDev: stats.stdDev,
    sampleSize: values.length,
    effectiveSample: stats.effectiveSample,
    probabilityOver,
    empiricalOverRate: empirical ? Number(empirical.rate.toFixed(4)) : null,
    decidedGames: empirical?.decided ?? 0,
    // The band a projection has to fall inside to be supported by this log.
    plausibleLow: Number((stats.mean - PLAUSIBLE_SIGMA * stats.stdDev).toFixed(2)),
    plausibleHigh: Number((stats.mean + PLAUSIBLE_SIGMA * stats.stdDev).toFixed(2)),
  };
}
