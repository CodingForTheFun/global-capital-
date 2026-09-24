import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('../components/player-prop-research-card.tsx', import.meta.url), 'utf8');

test('research snapshot is visible before the deeper market controls', () => {
  const snapshot = card.indexOf('data-qa="research-snapshot"');
  const categories = card.indexOf('{categoryLabels.map((entry) => {');
  assert.ok(snapshot >= 0, 'research snapshot exists');
  assert.ok(categories >= 0, 'market categories exist');
  assert.ok(snapshot < categories, 'snapshot appears above market-category controls');
});

test('snapshot uses verified evidence instead of a fabricated prop score', () => {
  assert.match(card, /Built only from verified rows available for this exact prop\./);
  assert.match(card, /recentWindow\.hitRate/);
  assert.match(card, /h2h\?\.hitRate/);
  assert.match(card, /researchLineMove/);
  assert.match(card, /currentDefense\.allowedRank/);
  assert.doesNotMatch(card, /data-qa="research-snapshot"[\s\S]{0,5000}Prop Score/i);
});

test('history model is surfaced once, above the fold', () => {
  const modelRenders = card.match(/<HistoryModel group=\{group\}/g) || [];
  assert.equal(modelRenders.length, 1);
  assert.ok(card.indexOf('<HistoryModel group={group}') < card.indexOf('{categoryLabels.map((entry) => {'));
});
