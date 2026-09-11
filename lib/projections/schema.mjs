// The projection contract: what the model returns, and what the caller derives.
//
// The split matters. The model supplies judgement — a projection, a calibrated
// probability, a confidence, a reason. Everything arithmetic (edge margin,
// expected value, the pick label) is computed here from that probability and
// the real sportsbook price, so the same inputs always produce the same number
// and anyone can check the arithmetic by hand. Asking a language model to also
// do the multiplication would make those figures unreproducible for no gain.

export const PROJECTION_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    projection: {
      type: 'number',
      description: 'Expected stat output for this game, in the units of the market.',
    },
    probability_over: {
      type: 'number',
      description: 'Calibrated probability the result finishes strictly above the line, 0 to 1.',
    },
    confidence: {
      type: 'number',
      description: 'How much weight this estimate deserves, 0 to 100, based on evidence quality.',
    },
    primary_driver: {
      type: 'string',
      description: 'The single strongest reason for this conclusion, in two to four sentences, citing specific figures from the payload.',
    },
    // The deep-dive sections. Each is optional in substance but required in
    // shape: the model must return the key, and must return the string
    // "Not enough data in this payload to assess." rather than reasoning from
    // knowledge it was not given. That instruction lives in the system prompt;
    // this schema only guarantees the field is always present, so the drawer
    // never has to guess whether a section was skipped or hallucinated away.
    scheme_matchup: {
      type: 'string',
      description: 'How the opponent defends this position or action, grounded only in payload figures.',
    },
    usage_ripple: {
      type: 'string',
      description: 'How absences named in the payload reallocate touches, targets or possessions.',
    },
    schedule_fatigue: {
      type: 'string',
      description: 'Rest, back-to-backs and schedule load, from context.restDays and the game log dates.',
    },
    game_script: {
      type: 'string',
      description: 'Game script and pace implications, from the game total and team line when present.',
    },
    data_gaps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Fields that were needed and absent. Empty when the payload was complete.',
    },
  },
  required: ['projection', 'probability_over', 'confidence', 'primary_driver', 'scheme_matchup', 'usage_ripple', 'schedule_fatigue', 'game_script', 'data_gaps'],
  additionalProperties: false,
});

export const PICK_LABELS = Object.freeze(['STRONG OVER', 'LEAN OVER', 'PASS', 'LEAN UNDER', 'STRONG UNDER']);

// Thresholds for the pick label. Deliberately conservative: a label only
// appears when the modelled edge and the evidence behind it both clear a bar.
export const PICK_THRESHOLDS = Object.freeze({
  strongEvPercent: 5,
  leanEvPercent: 2,
  strongConfidence: 65,
  leanConfidence: 50,
});

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * American odds to the decimal profit on a one-unit stake, and to the
 * probability the price implies. `-110` pays 0.909 and implies 0.524.
 */
export function americanOddsToPayout(odds) {
  const price = num(odds);
  if (price === null || price === 0) return null;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

export function impliedProbability(odds) {
  const price = num(odds);
  if (price === null || price === 0) return null;
  const magnitude = Math.abs(price);
  return price > 0 ? 100 / (magnitude + 100) : magnitude / (magnitude + 100);
}

/**
 * Expected value per unit staked, as a percentage.
 *
 * A win returns the payout, a loss costs the stake. Returns null rather than 0
 * when the price is missing — no price means no expected value, which is not
 * the same as a break-even bet.
 */
export function expectedValuePercent(probability, odds) {
  const p = num(probability);
  const payout = americanOddsToPayout(odds);
  if (p === null || payout === null || p < 0 || p > 1) return null;
  return Number(((p * payout - (1 - p)) * 100).toFixed(2));
}

/**
 * The pick label. Both the expected value and the confidence behind it have to
 * clear the bar: a large edge drawn from a thin sample is not a strong play,
 * so it lands on PASS rather than being dressed up as one.
 */
export function pickLabel({ evOver, evUnder, confidence }) {
  const conf = num(confidence);
  if (conf === null) return 'PASS';
  const over = num(evOver);
  const under = num(evUnder);
  const best = over !== null && (under === null || over >= under)
    ? { side: 'OVER', ev: over }
    : under !== null ? { side: 'UNDER', ev: under } : null;
  if (!best || best.ev === null) return 'PASS';
  const { strongEvPercent, leanEvPercent, strongConfidence, leanConfidence } = PICK_THRESHOLDS;
  if (best.ev >= strongEvPercent && conf >= strongConfidence) return `STRONG ${best.side}`;
  if (best.ev >= leanEvPercent && conf >= leanConfidence) return `LEAN ${best.side}`;
  return 'PASS';
}

/**
 * Turn one model response plus the real prices into the card payload.
 *
 * Everything the customer sees as a number originates either in the model's
 * projection/probability or in a sportsbook price that was actually offered.
 */
// The five deep-dive sections, in the order the drawer renders them.
export const ANALYSIS_SECTIONS = Object.freeze([
  ['scheme_matchup', 'Tactical & scheme matchup'],
  ['usage_ripple', 'Usage & injury ripple effects'],
  ['schedule_fatigue', 'Travel & schedule fatigue'],
  ['game_script', 'Game script & pace'],
]);

// A section the model could not ground in the payload comes back saying so.
// That is a real answer and worth showing once, but four copies of it is
// noise, so a section is dropped when it has nothing but the disclaimer.
const NOT_ASSESSABLE = /^\s*not enough data/i;

export function analysisSections(model = {}) {
  return ANALYSIS_SECTIONS
    .map(([key, label]) => [label, typeof model[key] === 'string' ? model[key].trim().slice(0, 1600) : ''])
    .filter(([, body]) => body && !NOT_ASSESSABLE.test(body))
    .map(([label, body]) => ({ label, body }));
}

export function deriveProjection(model = {}, market = {}) {
  const projection = num(model.projection);
  const probabilityOver = num(model.probability_over);
  const confidence = num(model.confidence);
  const line = num(market.line);
  if (projection === null || probabilityOver === null || probabilityOver < 0 || probabilityOver > 1) {
    return null;
  }
  const probabilityUnder = Number((1 - probabilityOver).toFixed(4));
  const evOver = expectedValuePercent(probabilityOver, market.overPrice);
  const evUnder = expectedValuePercent(probabilityUnder, market.underPrice);
  const boundedConfidence = confidence === null ? null : Math.max(0, Math.min(100, Math.round(confidence)));
  const label = pickLabel({ evOver, evUnder, confidence: boundedConfidence });
  const side = label.endsWith('UNDER') ? 'UNDER' : label.endsWith('OVER') ? 'OVER' : null;
  return {
    projection: Number(projection.toFixed(2)),
    line,
    // Signed toward the over, matching how the card reads it against the line.
    edge: line === null ? null : Number((projection - line).toFixed(2)),
    edgePercent: line === null || line === 0 ? null : Number((((projection - line) / Math.abs(line)) * 100).toFixed(1)),
    probabilityOver: Number(probabilityOver.toFixed(4)),
    probabilityUnder,
    impliedOver: impliedProbability(market.overPrice),
    impliedUnder: impliedProbability(market.underPrice),
    evOver,
    evUnder,
    ev: side === 'UNDER' ? evUnder : side === 'OVER' ? evOver : null,
    pick: label,
    side,
    confidence: boundedConfidence,
    primaryDriver: typeof model.primary_driver === 'string' ? model.primary_driver.slice(0, 1200) : null,
    analysis: analysisSections(model),
    dataGaps: Array.isArray(model.data_gaps)
      ? model.data_gaps.filter((gap) => typeof gap === 'string' && gap).map((gap) => gap.slice(0, 120)).slice(0, 12)
      : [],
  };
}
