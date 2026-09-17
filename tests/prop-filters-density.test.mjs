import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPropResearch, propFiltersHtml } from '../lib/ui/prop-filters.mjs';

test('prop filter controls keep existing filter semantics while using the compact row', () => {
  const base = {
    gameLog: [
      { opponent: 'BAL', season: 2026, team: 'PIT', isHome: true, started: true, minutes: 31, value: 4 },
      { opponent: 'CLE', season: 2026, team: 'PIT', isHome: false, started: false, minutes: 18, value: 2 },
    ],
    context: {},
    coverage: {},
  };
  const html = propFiltersHtml(base, { opponent: 'BAL' }, 'home');
  assert.match(html, /asPropFilterGrid/);
  assert.match(html, /asFilterMenu/);
  assert.match(html, /asFilterSliders/);
  assert.match(html, /id="asClearPropFilters"/);
  assert.doesNotMatch(html, /Live filters/);
  assert.doesNotMatch(html, /Reset prop filters/);

  const filtered = filterPropResearch(base, { opponent: 'BAL' });
  assert.equal(filtered.gameLog.length, 1);
  assert.equal(filtered.gameLog[0].opponent, 'BAL');
});
