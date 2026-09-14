// How wrong "multiply the legs together" can be.
//
// Every slip tool multiplies leg probabilities and prints the product. That
// product is only the answer when the legs are independent, and DFS slips are
// built to be anything but: two props on the same player, or two players in the
// same game, move together. A quarterback throwing for 300 yards and his
// receiver going over 60 are close to the same event twice.
//
// Nobody can state the true joint probability without joint history we do not
// have, and inventing a correlation coefficient would be exactly the kind of
// false precision this codebase refuses elsewhere. But the range the answer
// must lie in needs no data at all. The Fréchet–Hoeffding bounds are tight and
// distribution-free: whatever the dependence, the joint probability of n events
// sits in
//
//     [ max(0, Σp − (n−1)) , min(p) ]
//
// The lower bound is the worst case where the legs conflict as much as they
// can; the upper is the best case where the easiest leg carries the rest. So
// instead of one confident number this reports the product, the interval it is
// only a point inside, and which legs are the reason the interval is wide.
//
// This narrows nothing and claims nothing. Its whole job is to show the user
// that the headline number is an assumption, and where that assumption is
// riskiest.

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = value => String(value ?? '').trim();

/** Probabilities must be real and strictly inside 0 and 1 to multiply. */
const usableProbability = (value) => {
  const p = num(value);
  return p !== null && p > 0 && p < 1 ? p : null;
};

/**
 * Legs that share an event, or a player, and so cannot be treated as separate
 * coin flips. Same-player pairs are listed apart because they are the strongest
 * dependence a slip can contain.
 */
export function dependentGroups(legs = []) {
  const byEvent = new Map(), byPlayer = new Map();
  legs.forEach((leg, index) => {
    const event = text(leg?.eventId);
    const player = text(leg?.playerId) || text(leg?.playerName).toLowerCase();
    if (event) { if (!byEvent.has(event)) byEvent.set(event, []); byEvent.get(event).push(index); }
    if (player) { if (!byPlayer.has(player)) byPlayer.set(player, []); byPlayer.get(player).push(index); }
  });
  const group = (map, kind) => [...map.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([id, members]) => ({ kind, id, members, size: members.length }));
  const players = group(byPlayer, 'player');
  // A same-player group is already inside some same-event group; report the
  // event group only when it binds legs the player group does not.
  const covered = new Set(players.flatMap(g => g.members));
  const events = group(byEvent, 'event').filter(g => g.members.some(i => !covered.has(i)));
  return [...players, ...events].sort((a, b) => b.size - a.size);
}

/**
 * The product, the interval it lives in, and why.
 *
 * @param legs [{probability, eventId?, playerId?, playerName?}]
 * @returns {{legs:number, independent:number, lower:number, upper:number,
 *   spread:number, groups:Array, dependentLegs:number}|{reason:string,
 *   priced?:number, legs?:number}}
 */
export function slipJointProbability(legs = []) {
  const rows = Array.isArray(legs) ? legs : [];
  if (rows.length < 2) return { reason: 'NEEDS_TWO_LEGS', legs: rows.length };

  const probabilities = rows.map(leg => usableProbability(leg?.probability));
  const priced = probabilities.filter(p => p !== null).length;
  // One unpriced leg makes the whole slip's joint probability unknowable; say
  // so rather than quietly reporting the product of the legs that do have one.
  if (priced !== rows.length) return { reason: 'INCOMPLETE_PROBABILITIES', priced, legs: rows.length };

  const n = rows.length;
  const independent = probabilities.reduce((acc, p) => acc * p, 1);
  const upper = Math.min(...probabilities);
  const lower = Math.max(0, probabilities.reduce((acc, p) => acc + p, 0) - (n - 1));
  const groups = dependentGroups(rows);
  const dependentLegs = new Set(groups.flatMap(g => g.members)).size;
  return { legs: n, independent, lower, upper, spread: upper - lower, groups, dependentLegs };
}

const pct = (value) => {
  if (value <= 0) return '0%';
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
};

/**
 * One or two sentences for the slip drawer, or null when there is nothing to
 * say. Never implies the true number is known.
 */
export function describeSlipCorrelation(value) {
  if (!value || value.reason) return null;
  const headline = `Multiplying the legs gives ${pct(value.independent)}. Dependence alone puts the real number anywhere from ${pct(value.lower)} to ${pct(value.upper)}.`;
  if (!value.groups.length) {
    return `${headline} No two legs share a player or a game, so the product is the closest thing to an estimate here.`;
  }
  const players = value.groups.filter(g => g.kind === 'player').length;
  const events = value.groups.filter(g => g.kind === 'event').length;
  const parts = [];
  if (players) parts.push(`${players} player${players === 1 ? '' : 's'} appear${players === 1 ? 's' : ''} on more than one leg`);
  if (events) parts.push(`${events} game${events === 1 ? '' : 's'} carr${events === 1 ? 'ies' : 'y'} more than one leg`);
  return `${headline} ${parts.join(' and ')} — those outcomes move together, so the product is not a probability.`;
}

/** Whether the slip contains dependence worth warning about at all. */
export const hasDependentLegs = value => !!value && !value.reason && value.groups.length > 0;
