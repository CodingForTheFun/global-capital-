import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cardDataSources,
  freshnessLabel,
  renderPropCard,
} from '../public/props-presenter.mjs';

test('prop presenter labels SportsGameOdds and multi-source provenance without exposing keys', () => {
  const base = {
    id: 'p1',
    sport: 'NFL',
    playerName: 'Test Player',
    market: 'Receiving Yards',
    line: 72.5,
    side: 'OVER',
    sportsbook: 'DraftKings',
    provider: 'sportsgameodds',
    updatedAt: '2026-09-21T19:00:00.000Z',
    hitRates: {},
  };
  assert.deepEqual(cardDataSources(base), ['SportsGameOdds']);
  assert.match(renderPropCard(base), /SportsGameOdds/);

  const mixed = {
    ...base,
    provider: 'propline',
    research: { source: 'ESPN public game logs' },
  };
  assert.deepEqual(cardDataSources(mixed), ['PropLine', 'ESPN']);
  const html = renderPropCard(mixed);
  assert.match(html, /Multi-source/);
  assert.match(html, /2 sources/);
  assert.doesNotMatch(html, /API_KEY|x-api-key/i);
});

test('freshness labels are relative and compact', () => {
  const now = Date.parse('2026-09-21T19:10:00.000Z');
  assert.equal(freshnessLabel('2026-09-21T19:09:25.000Z', now), 'Updated 35s ago');
  assert.equal(freshnessLabel('2026-09-21T19:07:00.000Z', now), 'Updated 3m ago');
  assert.equal(freshnessLabel('', now), 'Update time unavailable');
});

test('current research board includes compact provenance, book count, and freshness UI', () => {
  const source = fs.readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../apex-v2/research-ui.css', import.meta.url), 'utf8');
  assert.match(source, /function sourceMeta\(/);
  assert.match(source, /asSourceChip/);
  assert.match(source, /asBookCount/);
  assert.match(source, /asSourceFresh/);
  assert.match(source, /Multi-source/);
  assert.match(css, /\.asSourceChip\.sportsgameodds/);
  assert.match(css, /\.asSourceChip\.propline/);
  assert.match(css, /\.asSourceChip\.espn/);
  assert.match(css, /\.asSourceChip\.multi/);
});
