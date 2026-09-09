import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPropFilters,
  evaluatePropAgainstFilters,
  filterCounts,
  activeFilterChips,
  clearFilter,
  explainEmptyResult,
  filtersToQuery,
  filtersFromQuery,
  isFilterApplicable,
  availableFilters,
  normalizeFilters,
} from '../lib/filters/index.mjs';
import { fromScanResult } from '../lib/props/model.mjs';
import { scoreProps } from '../lib/scoring/index.mjs';
import { buildPropView, findBestProps } from '../lib/props/pipeline.mjs';

// A scan result shaped exactly like the scanner's own output.
function pick(overrides = {}) {
  return {
    player: 'Test Player', prop: 'Points', line: 25.5, sport: 'NBA', pick: 'OVER',
    opponent: 'PHX', matchId: 'NBA-1', sourceUrl: 'https://www.pickfinder.app/players/x',
    l5: 80, l10: 78, l15: 76, h2h: 70, expectedOutcome: 'WIN', expectedOutcomeRate: 75,
    avg: 29.1, diff: 3.6, regularLine: true, prizePicksConfirmed: true, isToday: true,
    detailPageVerified: true, qualified: true, failures: [], confidence: 88,
    filterAudit: [{ label: 'Opponent', value: 'PHX', hitRate: 80, floor: 75, required: true, verified: true }],
    ...overrides,
  };
}

const scan = {
  scannedAt: new Date().toISOString(),
  picks: [
    pick({ player: 'Alpha', sport: 'NBA', prop: 'Points', pick: 'OVER', l5: 90, l10: 88, l15: 86, matchId: 'NBA-1' }),
    pick({ player: 'Bravo', sport: 'NBA', prop: 'Rebounds', pick: 'UNDER', l5: 60, l10: 58, l15: 55, qualified: false, failures: ['L5 60% < 80%'], confidence: 62, matchId: 'NBA-1' }),
    pick({ player: 'Charlie', sport: 'NFL', prop: 'Rushing Yards', pick: 'OVER', l5: 75, l10: 72, l15: 70, matchId: 'NFL-9', opponent: 'SEA' }),
    pick({ player: 'Delta', sport: 'NBA', prop: 'Points', pick: 'OVER', l5: 55, l10: 52, l15: 50, qualified: false, failures: ['L5 low', 'L10 low'], confidence: 51, isToday: false, matchId: 'NBA-2' }),
  ],
};

const universe = scoreProps(fromScanResult(scan));

test('normalization produces one prop per pick with a stable identity', () => {
  assert.equal(universe.length, 4);
  assert.ok(universe.every((prop) => prop.id));
  // Re-adapting the same scan yields the same ids.
  const again = fromScanResult(scan);
  assert.deepEqual(again.map((p) => p.id).sort(), universe.map((p) => p.id).sort());
});

test('duplicate props collapse on stable identity, not scrape order', () => {
  const dupes = { scannedAt: scan.scannedAt, picks: [pick({ player: 'Echo' }), pick({ player: 'Echo' })] };
  assert.equal(fromScanResult(dupes).length, 1);
});

test('a single filter works', () => {
  assert.equal(applyPropFilters(universe, { sports: ['NFL'] }).length, 1);
  assert.equal(applyPropFilters(universe, { side: 'UNDER' }).length, 1);
  assert.equal(applyPropFilters(universe, { markets: ['POINTS'] }).length, 2);
});

test('multiple filters combine simultaneously', () => {
  // The spec's own example: NBA + Points + Over + Tonight + min score + hit rate.
  const filtered = applyPropFilters(universe, {
    sports: ['NBA'], markets: ['POINTS'], side: 'OVER', timeWindow: 'TODAY',
    minHitRate: 70, hitRateWindow: 'l10',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].playerName, 'Alpha');
});

test('every prop is evaluated by the same function', () => {
  const filters = { sports: ['NBA'], side: 'OVER' };
  const viaEngine = applyPropFilters(universe, filters).map((p) => p.id).sort();
  const viaPerProp = universe
    .filter((prop) => evaluatePropAgainstFilters(prop, filters).matchesFilters)
    .map((p) => p.id).sort();
  assert.deepEqual(viaEngine, viaPerProp);
});

test('evaluating one prop reports what matched, failed and did not apply', () => {
  const result = evaluatePropAgainstFilters(universe[0], { sports: ['NFL'], minScore: 10 });
  assert.equal(result.matchesFilters, false);
  assert.deepEqual(result.failedFilters, ['sports']);
  assert.ok(result.appliedFilters.includes('minScore'));
});

test('All Props and Auto Prop Finder filter identically', () => {
  const filters = { sports: ['NBA'], markets: ['POINTS'], side: 'OVER' };
  const all = buildPropView(scan, { filters });
  const auto = findBestProps(scan, { filters });
  assert.deepEqual(
    all.props.map((p) => p.id).sort(),
    auto.ranked.map((p) => p.id).sort(),
    'the ranked list must be drawn from exactly the All Props population',
  );
});

test('Auto Prop Finder ranks within the filtered set and does not reset filters', () => {
  const auto = findBestProps(scan, { filters: { sports: ['NBA'], side: 'OVER' } });
  assert.ok(auto.ranked.length > 0);
  assert.ok(auto.ranked.every((prop) => prop.sport === 'NBA' && prop.side === 'OVER'));
  assert.equal(auto.ranked[0].rank, 1);
  // Ranked strongest first.
  const scores = auto.ranked.map((p) => p.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('Rules ON narrows the SAME filtered population; Rules OFF does not widen it', () => {
  const base = { sports: ['NBA'] };
  const off = applyPropFilters(universe, { ...base, applyScoutRules: false });
  const on = applyPropFilters(universe, { ...base, applyScoutRules: true });

  assert.equal(off.length, 3, 'rules off shows every NBA prop, including non-qualifiers');
  assert.equal(on.length, 1, 'rules on shows only NBA qualifiers');
  assert.ok(on.every((prop) => off.some((other) => other.id === prop.id)), 'rules on is a subset');
  // Toggling rules must not leak props from other sports back in.
  assert.ok(on.every((prop) => prop.sport === 'NBA'));
});

test('the rule toggle never erases the other filters', () => {
  const filters = normalizeFilters({ sports: ['NBA'], markets: ['POINTS'], side: 'OVER', minHitRate: 70 });
  const withRules = { ...filters, applyScoutRules: true };
  assert.deepEqual(withRules.sports, ['NBA']);
  assert.deepEqual(withRules.markets, ['POINTS']);
  assert.equal(withRules.side, 'OVER');
  assert.equal(withRules.minHitRate, 70);
});

test('a sport-specific filter never silently deletes unrelated props', () => {
  // Edge only exists where a recent average is published. A prop without one
  // must be reported inapplicable, not quietly excluded.
  const noEdge = scoreProps(fromScanResult({ picks: [pick({ player: 'Foxtrot', avg: null, diff: null })] }))[0];
  const result = evaluatePropAgainstFilters(noEdge, { minEdge: 2 });
  assert.equal(result.matchesFilters, true, 'an inapplicable filter must not exclude the prop');
  assert.ok(result.inapplicableFilters.includes('minEdge'));
  assert.ok(!result.appliedFilters.includes('minEdge'));
});

test('filter availability reflects the real dataset', () => {
  assert.ok(availableFilters(universe).includes('minEdge'));
  const bare = scoreProps(fromScanResult({ picks: [pick({ avg: null, diff: null, filterAudit: [] })] }));
  assert.ok(!availableFilters(bare).includes('matchup'), 'no opponent split means no matchup filter');
  assert.equal(isFilterApplicable('minEdge', bare[0]), false);
});

test('counts update for total, matching and Scout qualifiers', () => {
  assert.deepEqual(filterCounts(universe, {}), { total: 4, matching: 4, qualifiers: 2 });
  assert.deepEqual(filterCounts(universe, { sports: ['NBA'] }), { total: 4, matching: 3, qualifiers: 1 });
  assert.deepEqual(filterCounts(universe, { sports: ['ZZZ'] }), { total: 4, matching: 0, qualifiers: 0 });
});

test('sorting operates on the filtered results', () => {
  const view = buildPropView(scan, { filters: { sports: ['NBA'] }, sort: 'score-asc' });
  const scores = view.props.map((p) => p.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  assert.ok(view.props.every((prop) => prop.sport === 'NBA'));
});

test('search works together with active filters', () => {
  assert.equal(applyPropFilters(universe, { search: 'alpha' }).length, 1);
  assert.equal(applyPropFilters(universe, { search: 'alpha', sports: ['NFL'] }).length, 0);
  assert.equal(applyPropFilters(universe, { search: 'SEA' }).length, 1, 'search covers opponent');
});

test('clearing one filter preserves the others', () => {
  const filters = normalizeFilters({ sports: ['NBA', 'NFL'], markets: ['POINTS'], side: 'OVER', minScore: 80 });
  const removedOneSport = clearFilter(filters, 'sports', 'NFL');
  assert.deepEqual(removedOneSport.sports, ['NBA']);
  assert.deepEqual(removedOneSport.markets, ['POINTS']);
  assert.equal(removedOneSport.side, 'OVER');
  assert.equal(removedOneSport.minScore, 80);

  const removedSide = clearFilter(removedOneSport, 'side');
  assert.equal(removedSide.side, 'ALL');
  assert.deepEqual(removedSide.sports, ['NBA'], 'other filters survive');
});

test('active filter chips are individually removable', () => {
  const filters = { sports: ['NBA'], markets: ['POINTS'], side: 'OVER', minScore: 85, minHitRate: 70, applyScoutRules: true };
  const chips = activeFilterChips(filters);
  const ids = chips.map((chip) => chip.id);
  for (const expected of ['sports', 'markets', 'side', 'minScore', 'minHitRate', 'applyScoutRules']) {
    assert.ok(ids.includes(expected), `missing chip: ${expected}`);
  }
  assert.ok(chips.some((chip) => chip.label === 'Score 85+'));
});

test('the empty state explains which filter is responsible', () => {
  const filters = { sports: ['NBA'], minHitRate: 99, hitRateWindow: 'l10' };
  const view = buildPropView(scan, { filters });
  assert.equal(view.props.length, 0);
  assert.ok(view.emptyReason);
  assert.equal(view.emptyReason.total, 4);
  assert.equal(view.emptyReason.suggestions[0].id, 'minHitRate', 'the filter excluding the most props is suggested first');
  assert.ok(view.emptyReason.activeChips.length > 0);
});

test('URL state round-trips and restores filters exactly', () => {
  const filters = normalizeFilters({
    sports: ['NBA'], markets: ['POINTS'], side: 'OVER', minScore: 85,
    minHitRate: 70, hitRateWindow: 'l5', applyScoutRules: true, search: 'alpha',
    positiveEdgeOnly: true, timeWindow: 'TODAY',
  });
  const restored = filtersFromQuery(filtersToQuery(filters));
  for (const key of ['sports', 'markets', 'side', 'minScore', 'minHitRate', 'hitRateWindow', 'applyScoutRules', 'search', 'positiveEdgeOnly', 'timeWindow']) {
    assert.deepEqual(restored[key], filters[key], `round-trip lost ${key}`);
  }
  // And the restored filters select the same props.
  assert.deepEqual(
    applyPropFilters(universe, restored).map((p) => p.id),
    applyPropFilters(universe, filters).map((p) => p.id),
  );
});

test('no credential or session data can enter the URL', () => {
  const query = filtersToQuery(normalizeFilters({
    sports: ['NBA'], password: 'hunter2', aps_session: 'token', email: 'a@b.c',
  }));
  for (const leak of ['hunter2', 'aps_session', 'password', 'a@b.c', 'token']) {
    assert.ok(!query.includes(leak), `leaked into URL: ${leak}`);
  }
});

test('invalid and hostile filter values fail gracefully', () => {
  for (const bad of [null, undefined, 'nonsense', 42, [], { sports: 'NBA' }, { minScore: 'abc' }, { side: 'SIDEWAYS' }]) {
    assert.doesNotThrow(() => applyPropFilters(universe, bad), `threw on ${JSON.stringify(bad)}`);
  }
  // A non-numeric threshold is ignored rather than excluding everything.
  assert.equal(applyPropFilters(universe, { minScore: 'abc' }).length, 4);
  // A string where a list belongs is coerced, not crashed on.
  assert.equal(applyPropFilters(universe, { sports: 'NBA' }).length, 3);
  assert.equal(normalizeFilters({ side: 'SIDEWAYS' }).side, 'ALL');
});

test('paging returns a window without changing the filtered total', () => {
  const view = buildPropView(scan, { filters: {}, limit: 2, offset: 0 });
  assert.equal(view.props.length, 2);
  assert.equal(view.counts.filtered, 4);
  assert.equal(view.counts.returned, 2);
});
