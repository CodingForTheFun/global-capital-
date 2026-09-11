// Re-price a projection at a different line, without asking the model again.
//
// A projection is an estimate of what the player will DO. It does not depend on
// the line the book happens to be offering — move the line and the expected
// output is unchanged; what changes is the probability of clearing it, and
// therefore the edge and the expected value.
//
// Before this, nudging the research line threw the whole estimate away and
// demanded another paid request to get the numbers back. That was both worse
// for the user and wrong in principle: the answer to "what if the line were
// 31.5 instead of 30.5" was already implied by the answer we had.
//
// The probability at the new line is read off the same distribution the
// calibration step used: the projection as the centre, the observed spread of
// the player's own game log as the width. That makes it consistent with the
// figure the model produced rather than a second, disagreeing estimate — at
// the original line, this returns very close to what the model said.
//
// It is NOT a substitute for a fresh run when something real changes. A new
// opponent, a new injury, a team-mate ruled out — those change the projection
// itself, and only the model can do that.

import { normalCdf } from './baseline.mjs';
import { americanOddsToPayout, impliedProbability, expectedValuePercent, pickLabel } from './schema.mjs';

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The spread to price against.
 *
 * Prefer the measured spread of the player's own log. Without it there is
 * nothing honest to infer a distribution from, so re-pricing declines rather
 * than inventing a width — a made-up spread would produce a confident-looking
 * probability with nothing behind it.
 */
export function repriceDispersion(entry = {}) {
  const measured = num(entry?.calibration?.stdDev);
  return measured !== null && measured > 0 ? measured : null;
}

/**
 * @param {object} entry a projection result from /api/props/predict
 * @param {object} market { line, overPrice, underPrice }
 * @returns {object|null} the same shape, re-priced, or null when it cannot be
 */
export function repriceProjection(entry, market = {}) {
  if (!entry || entry.available === false) return null;
  const projection = num(entry.projection);
  const line = num(market.line);
  if (projection === null || line === null) return null;

  const originalLine = num(entry.line);
  // Nothing to do — hand back the model's own figures untouched.
  if (originalLine !== null && Math.abs(originalLine - line) < 1e-9) return entry;

  const stdDev = repriceDispersion(entry);
  if (stdDev === null) return null;

  const probabilityOver = Math.max(0.01, Math.min(0.99, 1 - normalCdf((line - projection) / stdDev)));
  const probabilityUnder = Number((1 - probabilityOver).toFixed(4));
  const evOver = expectedValuePercent(probabilityOver, market.overPrice);
  const evUnder = expectedValuePercent(probabilityUnder, market.underPrice);
  const label = pickLabel({ evOver, evUnder, confidence: entry.confidence });
  const side = label.endsWith('UNDER') ? 'UNDER' : label.endsWith('OVER') ? 'OVER' : null;

  return {
    ...entry,
    line,
    repriced: true,
    // The line this came from, so the card can say the projection itself is
    // still the model's and only the pricing moved.
    modelLine: originalLine,
    edge: Number((projection - line).toFixed(2)),
    edgePercent: line === 0 ? null : Number((((projection - line) / Math.abs(line)) * 100).toFixed(1)),
    probabilityOver: Number(probabilityOver.toFixed(4)),
    probabilityUnder,
    impliedOver: impliedProbability(market.overPrice),
    impliedUnder: impliedProbability(market.underPrice),
    evOver,
    evUnder,
    ev: side === 'UNDER' ? evUnder : side === 'OVER' ? evOver : null,
    pick: label,
    side,
  };
}

export { americanOddsToPayout };
