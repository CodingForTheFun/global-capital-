import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreProp, scoreProps, sortProps, SORTS, similarFiltersFor, DEFAULT_WEIGHTS } from '../lib/scoring/index.mjs';
import { fromPickFinder, qualityTierFor, QUALITY_TIERS } from '../lib/props/model.mjs';

const strong = fromPickFinder({
  player: 'Alpha', prop: 'Points', line: 25.5, sport: 'NBA', pick: 'OVER', opponent: 'PHX', matchId: 'NBA-1',
  l5: 90, l10: 88, l15: 86, h2h: 85, expectedOutcome: 'WIN', expectedOutcomeRate: 84,
  avg: 30.5, diff: 5.0, regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true,
  filterAudit: [{ label: 'Opponent', value: 'PHX', hitRate: 85, floor: 75, required: true, verified: true }],
});

const weak = fromPickFinder({
  player: 'Bravo', prop: 'Rebounds', line: 8.5, sport: 'NBA', pick: 'OVER', opponent: 'PHX', matchId: 'NBA-1',
  l5: 40, l10: 42, l15: 38, h2h: 35, expectedOutcome: 'LOSS', expectedOutcomeRate: 40,
  avg: 7.0, diff: -1.5, regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true,
  filterAudit: [{ label: 'Opponent', value: 'PHX', hitRate: 40, floor: 75, required: true, verified: true }],
});

test('a strong prop outscores a weak one', () => {
  const a = scoreProp(strong);
  const b = scoreProp(weak);
  assert.ok(a.score > b.score, `${a.score} should beat ${b.score}`);
  assert.ok(a.score >= 0 && a.score <= 100);
  assert.ok(b.score >= 0 && b.score <= 100);
});

test('every score comes with a factor-by-factor explanation', () => {
  const breakdown = scoreProp(strong);
  assert.ok(Array.isArray(breakdown.factors));
  for (const factor of breakdown.factors) {
    assert.ok(factor.id && factor.label, 'each factor is named');
    assert.ok(typeof factor.detail === 'string' && factor.detail.length > 0, `${factor.id} must explain itself`);
    assert.equal(typeof factor.available, 'boolean');
  }
  // No unexplained confidence: the weights account for the whole model.
  const ids = breakdown.factors.map((f) => f.id).sort();
  assert.deepEqual(ids, Object.keys(DEFAULT_WEIGHTS).sort());
});

test('missing data lowers coverage instead of inventing a value', () => {
  const sparse = fromPickFinder({
    player: 'Charlie', prop: 'Points', line: 20.5, sport: 'NBA', pick: 'OVER', matchId: 'NBA-3',
    l5: 80, l10: null, l15: null, h2h: null, expectedOutcomeRate: null,
    avg: null, diff: null, regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true,
    filterAudit: [],
  });
  const breakdown = scoreProp(sparse);

  assert.equal(sparse.hitRates.l10, null, 'a missing hit rate stays null, never 0');
  assert.equal(sparse.edge, null, 'no average means no edge, never 0');
  assert.ok(breakdown.dataCoverage < 100, 'coverage reports how much data was actually present');
  assert.ok(breakdown.unavailableFactors.includes('edge'));
  assert.ok(breakdown.unavailableFactors.includes('headToHead'));
  // A prop is not punished into a low score purely for missing provider data.
  assert.ok(breakdown.score > 0);
});

test('a prop with no data at all is unscorable rather than scored zero', () => {
  const empty = fromPickFinder({
    player: 'Delta', prop: 'Points', line: 10, sport: 'NBA', pick: 'OVER', matchId: 'NBA-4',
    l5: null, l10: null, l15: null, h2h: null, expectedOutcomeRate: null, avg: null, diff: null,
    regularLine: false, prizePicksConfirmed: false, isToday: false, detailPageVerified: false, filterAudit: [],
  });
  const breakdown = scoreProp(empty);
  // Only source verification is computable, and it is all false.
  assert.equal(breakdown.score, 0);
  assert.equal(breakdown.qualityTier, 'LOW');
  assert.ok(breakdown.dataCoverage < 20);
});

test('edge is read in the direction of the pick', () => {
  const over = scoreProp(strong).factors.find((f) => f.id === 'edge');
  assert.ok(over.ratio > 0, 'average above the line helps an OVER');

  const under = scoreProp(fromPickFinder({
    player: 'Echo', prop: 'Points', line: 25.5, sport: 'NBA', pick: 'UNDER', matchId: 'NBA-5',
    l5: 80, l10: 80, l15: 80, avg: 20.0, diff: -5.5,
    regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true, filterAudit: [],
  })).factors.find((f) => f.id === 'edge');
  assert.ok(under.ratio > 0, 'average below the line helps an UNDER');
});

test('quality tiers follow the published thresholds', () => {
  assert.equal(qualityTierFor(95), 'ELITE');
  assert.equal(qualityTierFor(90), 'ELITE');
  assert.equal(qualityTierFor(85), 'STRONG');
  assert.equal(qualityTierFor(75), 'GOOD');
  assert.equal(qualityTierFor(65), 'NEUTRAL');
  assert.equal(qualityTierFor(10), 'LOW');
  assert.equal(qualityTierFor(null), null, 'an unscored prop has no tier');
  assert.equal(QUALITY_TIERS.length, 5);
});

test('matchup rating comes from the verified opponent split only', () => {
  assert.equal(scoreProp(strong).matchup, 'STRONG');
  assert.equal(scoreProp(weak).matchup, 'WEAK');
  const noSplit = fromPickFinder({ player: 'F', prop: 'Points', line: 1, sport: 'NBA', pick: 'OVER', l5: 80, filterAudit: [] });
  assert.equal(scoreProp(noSplit).matchup, null, 'no split means no rating, not "neutral"');
});

test('an unverified split does not count toward the score', () => {
  const unverified = fromPickFinder({
    player: 'Golf', prop: 'Points', line: 20, sport: 'NBA', pick: 'OVER', l5: 80, l10: 80, l15: 80,
    filterAudit: [{ label: 'Opponent', value: 'PHX', hitRate: 99, required: true, verified: false }],
  });
  const factor = scoreProp(unverified).factors.find((f) => f.id === 'contextSplits');
  assert.equal(factor.available, false, 'an unverified 99% must not inflate the score');
});

test('sorting puts real data first and nulls last, in both directions', () => {
  const scored = scoreProps([strong, weak]);
  const unscored = { ...scoreProps([strong])[0], id: 'x', score: null, confidence: null };
  const list = [unscored, ...scored];

  const desc = sortProps(list, SORTS.SCORE_DESC);
  assert.equal(desc[desc.length - 1].score, null, 'nulls last on descending');

  const asc = sortProps(list, SORTS.SCORE_ASC);
  assert.equal(asc[asc.length - 1].score, null, 'nulls still last on ascending');
  assert.ok(asc[0].score <= asc[1].score);
});

test('every sort mode returns the same population, only reordered', () => {
  const scored = scoreProps([strong, weak]);
  for (const sort of Object.values(SORTS)) {
    const sorted = sortProps(scored, sort);
    assert.equal(sorted.length, scored.length, `${sort} changed the population size`);
    assert.deepEqual(sorted.map((p) => p.id).sort(), scored.map((p) => p.id).sort(), `${sort} lost or added props`);
  }
});

test('sorting does not mutate the input array', () => {
  const scored = scoreProps([weak, strong]);
  const before = scored.map((p) => p.id);
  sortProps(scored, SORTS.SCORE_DESC);
  assert.deepEqual(scored.map((p) => p.id), before);
});

test('Find Similar builds filters from the prop itself', () => {
  assert.deepEqual(similarFiltersFor(strong), { sports: ['NBA'], markets: ['Points'], side: 'OVER' });
  assert.deepEqual(similarFiltersFor(null), {});
});
