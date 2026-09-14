import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slipJointProbability, describeSlipCorrelation, dependentGroups, hasDependentLegs,
} from '../lib/betting/slip-correlation.mjs';

const leg = (probability, extra = {}) => ({ probability, ...extra });

test('two independent legs report the product and the bounds around it', () => {
  const v = slipJointProbability([leg(0.6, { eventId: 'g1' }), leg(0.5, { eventId: 'g2' })]);
  assert.equal(v.reason, undefined);
  assert.ok(Math.abs(v.independent - 0.3) < 1e-12);
  assert.ok(Math.abs(v.upper - 0.5) < 1e-12, 'upper bound is the easiest leg');
  assert.ok(Math.abs(v.lower - 0.1) < 1e-12, 'lower bound is max(0, 1.1 - 1)');
  assert.deepEqual(v.groups, []);
});

// The bounds are the point of the module: the product is always inside them,
// and they are reachable, so they are not a hedge.
test('the product always lies inside the bounds', () => {
  const cases = [
    [0.9, 0.9], [0.5, 0.5, 0.5], [0.2, 0.3], [0.99, 0.01],
    [0.55, 0.6, 0.65, 0.7], [0.34, 0.34, 0.34, 0.34, 0.34, 0.34],
  ];
  for (const probs of cases) {
    const v = slipJointProbability(probs.map((p, i) => leg(p, { eventId: 'g' + i })));
    assert.ok(v.independent >= v.lower - 1e-12, `product ${v.independent} below lower ${v.lower}`);
    assert.ok(v.independent <= v.upper + 1e-12, `product ${v.independent} above upper ${v.upper}`);
    assert.ok(v.lower >= 0 && v.upper <= 1);
  }
});

test('legs that cannot conflict have a lower bound of zero', () => {
  const v = slipJointProbability([leg(0.4, { eventId: 'g1' }), leg(0.4, { eventId: 'g2' })]);
  assert.equal(v.lower, 0, '0.4 + 0.4 - 1 is negative, so the floor is zero');
});

test('certain-ish legs pin the interval shut', () => {
  const v = slipJointProbability([leg(0.99, { eventId: 'g1' }), leg(0.99, { eventId: 'g2' })]);
  assert.ok(v.upper - v.lower < 0.03, 'near-certain legs leave almost no room for dependence');
});

test('a single leg is not a joint probability', () => {
  assert.equal(slipJointProbability([leg(0.6)]).reason, 'NEEDS_TWO_LEGS');
  assert.equal(slipJointProbability([]).reason, 'NEEDS_TWO_LEGS');
  assert.equal(slipJointProbability(null).reason, 'NEEDS_TWO_LEGS');
});

// Reporting the product of the priced legs would answer a different question
// than the one the slip is asking.
test('one unpriced leg makes the whole slip unknowable', () => {
  const v = slipJointProbability([leg(0.6), leg(null), leg(0.5)]);
  assert.equal(v.reason, 'INCOMPLETE_PROBABILITIES');
  assert.equal(v.priced, 2);
  assert.equal(v.legs, 3);
});

test('probabilities outside zero and one are refused, not clamped', () => {
  for (const bad of [0, 1, -0.2, 1.4, 'nope', undefined, NaN]) {
    assert.equal(slipJointProbability([leg(0.5), leg(bad)]).reason, 'INCOMPLETE_PROBABILITIES');
  }
});

test('legs on the same player are found', () => {
  const groups = dependentGroups([
    leg(0.6, { playerId: 'p1', eventId: 'g1' }),
    leg(0.5, { playerId: 'p1', eventId: 'g1' }),
    leg(0.7, { playerId: 'p9', eventId: 'g2' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'player');
  assert.deepEqual(groups[0].members, [0, 1]);
});

test('players are matched by name when no id is carried', () => {
  const groups = dependentGroups([
    leg(0.6, { playerName: 'Dak Prescott' }), leg(0.5, { playerName: 'dak prescott' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'player');
});

test('different players in one game are reported as a game group', () => {
  const groups = dependentGroups([
    leg(0.6, { playerId: 'p1', eventId: 'g1' }),
    leg(0.5, { playerId: 'p2', eventId: 'g1' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'event');
  assert.equal(groups[0].size, 2);
});

// A same-player pair is already a same-game pair; saying it twice overstates
// how much of the slip is entangled.
test('a same-player pair alone is not also counted as a game group', () => {
  const groups = dependentGroups([
    leg(0.6, { playerId: 'p1', eventId: 'g1' }),
    leg(0.5, { playerId: 'p1', eventId: 'g1' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'player');
});

test('a game group still reports when it binds a leg the player group does not', () => {
  const groups = dependentGroups([
    leg(0.6, { playerId: 'p1', eventId: 'g1' }),
    leg(0.5, { playerId: 'p1', eventId: 'g1' }),
    leg(0.4, { playerId: 'p2', eventId: 'g1' }),
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.some(g => g.kind === 'player'));
  assert.ok(groups.some(g => g.kind === 'event'));
});

test('legs with no event or player identity are treated as independent', () => {
  assert.deepEqual(dependentGroups([leg(0.6), leg(0.5)]), []);
  assert.equal(hasDependentLegs(slipJointProbability([leg(0.6), leg(0.5)])), false);
});

test('the copy names the dependence and never claims the true number', () => {
  const v = slipJointProbability([
    leg(0.6, { playerId: 'p1', eventId: 'g1', playerName: 'A' }),
    leg(0.5, { playerId: 'p1', eventId: 'g1', playerName: 'A' }),
  ]);
  const copy = describeSlipCorrelation(v);
  assert.match(copy, /Multiplying the legs gives 30\.0%/);
  assert.match(copy, /anywhere from 10\.0% to 50\.0%/);
  assert.match(copy, /1 player appears on more than one leg/);
  assert.match(copy, /move together/);
  assert.equal(hasDependentLegs(v), true);
});

test('an independent slip is told the product is as good as it gets', () => {
  const copy = describeSlipCorrelation(slipJointProbability([
    leg(0.6, { eventId: 'g1', playerId: 'p1' }), leg(0.5, { eventId: 'g2', playerId: 'p2' }),
  ]));
  assert.match(copy, /No two legs share a player or a game/);
});

test('no copy is produced when there is nothing to say', () => {
  assert.equal(describeSlipCorrelation(null), null);
  assert.equal(describeSlipCorrelation({ reason: 'NEEDS_TWO_LEGS' }), null);
  assert.equal(hasDependentLegs({ reason: 'NEEDS_TWO_LEGS' }), false);
});

test('a floor of exactly zero reads as 0%, not 0.00%', () => {
  const copy = describeSlipCorrelation(slipJointProbability([
    leg(0.4, { eventId: 'g1', playerId: 'p1' }), leg(0.4, { eventId: 'g1', playerId: 'p2' }),
  ]));
  assert.match(copy, /from 0% to 40\.0%/);
  assert.doesNotMatch(copy, /0\.00%/);
});
