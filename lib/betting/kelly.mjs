// Kelly stake sizing.
//
// Kelly needs a probability, not an expected value. EV% alone cannot size a
// bet: +10% EV at -300 and +10% EV at +400 are wildly different fractions of a
// bankroll. So every function here takes the modelled win probability and the
// real price, and returns null when either is missing rather than guessing.
//
// Full Kelly is optimal only if the probability is exactly right. It never is —
// ours comes from a model reading a game log — and full Kelly on an
// overestimated edge is how bankrolls die. Everything defaults to a quarter
// stake and is capped, and the UI says which fraction it used.

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const DEFAULT_KELLY_FRACTION = 0.25;
// No single suggestion exceeds this share of the bankroll, whatever the maths
// says. A model that is confidently wrong should cost one bet, not the roll.
export const MAX_BANKROLL_FRACTION = 0.05;

/** American odds to decimal profit per unit staked. -110 pays 0.909. */
export function payoutPerUnit(americanOdds) {
  const price = num(americanOdds);
  if (price === null || price === 0) return null;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

/**
 * The full-Kelly fraction of bankroll: (bp - q) / b.
 *
 * Returns 0 rather than a negative number when the bet has no edge — a
 * negative Kelly means "bet the other side", not "stake a negative amount",
 * and surfacing it as a stake would be nonsense.
 */
export function kellyFraction(probability, americanOdds) {
  const p = num(probability);
  const b = payoutPerUnit(americanOdds);
  if (p === null || b === null || p < 0 || p > 1) return null;
  const edge = b * p - (1 - p);
  return edge <= 0 ? 0 : Number((edge / b).toFixed(6));
}

/**
 * A suggested stake in currency, with every number that produced it.
 *
 * Returns null when there is no probability to size from — the caller shows
 * "run a prediction first" rather than a made-up figure.
 */
export function kellyStake({
  probability, americanOdds, bankroll,
  fraction = DEFAULT_KELLY_FRACTION, maxFraction = MAX_BANKROLL_FRACTION,
} = {}) {
  const full = kellyFraction(probability, americanOdds);
  const roll = num(bankroll);
  const part = num(fraction);
  if (full === null || part === null || part <= 0) return null;

  const scaled = full * Math.min(1, part);
  const capped = Math.min(scaled, num(maxFraction) ?? MAX_BANKROLL_FRACTION);
  const result = {
    fullKelly: full,
    fraction: Math.min(1, part),
    stakeFraction: Number(capped.toFixed(6)),
    capped: scaled > capped,
    edge: full > 0,
    stake: null,
  };
  if (roll !== null && roll > 0) result.stake = Number((roll * capped).toFixed(2));
  return result;
}

/**
 * Size a whole slip.
 *
 * Stakes are computed independently and then reported against the bankroll, so
 * a slip whose suggestions add up to more than the roll says so plainly rather
 * than silently rescaling. Correlation between picks is not modelled, and the
 * total is the honest warning that it isn't.
 */
export function sizeSlip(picks = [], { bankroll, fraction = DEFAULT_KELLY_FRACTION } = {}) {
  const roll = num(bankroll);
  const rows = (Array.isArray(picks) ? picks : []).map((pick) => ({
    ...pick,
    kelly: kellyStake({ probability: pick?.probability, americanOdds: pick?.americanOdds, bankroll: roll, fraction }),
  }));
  const staked = rows.reduce((sum, row) => sum + (num(row.kelly?.stake) ?? 0), 0);
  const sizedCount = rows.filter((row) => num(row.kelly?.stake) !== null && row.kelly.stake > 0).length;
  return {
    picks: rows,
    sizedCount,
    unsizedCount: rows.length - sizedCount,
    totalStake: roll === null ? null : Number(staked.toFixed(2)),
    bankroll: roll,
    // Independent Kelly stakes can exceed the bankroll once several picks
    // qualify; that is a signal to scale down, not something to hide.
    exceedsBankroll: roll !== null && staked > roll,
    sharePercent: roll === null || roll <= 0 ? null : Number(((staked / roll) * 100).toFixed(1)),
  };
}
