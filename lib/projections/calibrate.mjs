// Calibration: reconciling the model's estimate with the player's own log.
//
// A raw model number is taken at face value by nobody who forecasts for a
// living. Two corrections are applied here, both standard and both reported
// openly in the payload rather than done behind the customer's back:
//
//   1. CLAMPING. A projection outside the band the game log supports is not a
//      bold read, it is an unsupported one. It is pulled back to the edge of
//      the band and flagged.
//   2. SHRINKAGE. The final number is a weighted average of the model's
//      estimate and the log's own baseline, with the weight set by the
//      confidence the model itself reported. A confident model keeps most of
//      its answer; a hesitant one is pulled toward the base rate. This is the
//      one reliable finding in the forecast-combination literature: an expert
//      blended with a base rate beats the expert, because the two are wrong in
//      different directions.
//
// When the baseline is unavailable — too few games — nothing is blended and
// the model's own numbers pass through untouched. A baseline built from two
// games would be noise wearing a lab coat.

import { projectionBaseline } from './baseline.mjs';

// The model never gets the whole vote, and never gets less than a third of it.
export const MIN_MODEL_WEIGHT = 0.35;
export const MAX_MODEL_WEIGHT = 0.80;
// A projection and a probability that point opposite ways is a self-contradicting
// answer; confidence is cut by this much when that happens.
export const INCOHERENCE_PENALTY = 20;

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** How much of the final answer the model keeps, from the confidence it claimed. */
export function modelWeight(confidence) {
  const value = num(confidence);
  if (value === null) return MIN_MODEL_WEIGHT;
  const bounded = Math.max(0, Math.min(100, value)) / 100;
  return Number((MIN_MODEL_WEIGHT + (MAX_MODEL_WEIGHT - MIN_MODEL_WEIGHT) * bounded).toFixed(4));
}

/**
 * Does the projection agree with the probability?
 *
 * A projection above the line should carry a probability above even, and vice
 * versa. Disagreement means one of the two is an artefact, and neither deserves
 * full confidence until we know which.
 */
export function coherent({ projection, probabilityOver, line }) {
  const p = num(probabilityOver);
  const value = num(projection);
  const threshold = num(line);
  if (p === null || value === null || threshold === null) return true;
  if (value === threshold) return true;
  return (value > threshold) === (p > 0.5);
}

/**
 * Reconcile one model response with the log.
 *
 * Returns the corrected figures plus a `calibration` block describing exactly
 * what was changed and why, so the adjustment is auditable from the response
 * alone.
 */
export function calibrateProjection(model = {}, { gameLog = [], line } = {}) {
  const projection = num(model.projection);
  const probabilityOver = num(model.probability_over);
  const confidence = num(model.confidence);
  const threshold = num(line);
  if (projection === null || probabilityOver === null) return null;

  const baseline = projectionBaseline({ gameLog, line: threshold });
  const isCoherent = coherent({ projection, probabilityOver, line: threshold });
  let adjustedConfidence = confidence === null ? null : Math.max(0, Math.min(100, confidence));
  if (!isCoherent && adjustedConfidence !== null) {
    adjustedConfidence = Math.max(0, adjustedConfidence - INCOHERENCE_PENALTY);
  }

  if (!baseline.available) {
    return {
      projection,
      probabilityOver,
      confidence: adjustedConfidence,
      calibration: {
        applied: false,
        reason: baseline.reason,
        sampleSize: baseline.sampleSize,
        coherent: isCoherent,
      },
    };
  }

  const clampedProjection = Math.max(baseline.plausibleLow, Math.min(baseline.plausibleHigh, projection));
  const wasClamped = clampedProjection !== projection;
  const weight = modelWeight(adjustedConfidence);

  const blendedProjection = weight * clampedProjection + (1 - weight) * baseline.projection;
  const blendedProbability = baseline.probabilityOver === null
    ? probabilityOver
    : weight * probabilityOver + (1 - weight) * baseline.probabilityOver;

  return {
    projection: Number(blendedProjection.toFixed(2)),
    probabilityOver: Number(Math.max(0.01, Math.min(0.99, blendedProbability)).toFixed(4)),
    // A clamped projection was outside what the log supports, so the answer as
    // a whole deserves less weight than the model claimed for it.
    confidence: adjustedConfidence === null ? null : Math.round(wasClamped ? adjustedConfidence * 0.8 : adjustedConfidence),
    calibration: {
      applied: true,
      modelWeight: weight,
      modelProjection: Number(projection.toFixed(2)),
      modelProbabilityOver: Number(probabilityOver.toFixed(4)),
      baselineProjection: baseline.projection,
      baselineProbabilityOver: baseline.probabilityOver,
      // Travels with the response so the client can re-price the projection at
      // a different line without another paid request.
      stdDev: baseline.stdDev,
      sampleSize: baseline.sampleSize,
      clamped: wasClamped,
      coherent: isCoherent,
    },
  };
}
