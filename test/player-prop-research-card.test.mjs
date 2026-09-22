import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cardPath = new URL('../apps/oblige-web/components/player-prop-research-card.tsx', import.meta.url);
const viewPath = new URL('../apps/oblige-web/components/player-view.tsx', import.meta.url);
const adaptivePath = new URL('../lib/ml/adaptive.mjs', import.meta.url);

test('production research page uses the live PlayerPropResearchCard', async () => {
  const view = await readFile(viewPath, 'utf8');
  assert.match(view, /PlayerPropResearchCard/);
  assert.doesNotMatch(view, /<PlayerPropDeepDive/);
});

test('research card does not ship screenshot sample data', async () => {
  const card = await readFile(cardPath, 'utf8');
  for (const forbidden of [
    'Adam Mohammed',
    "const targetLine = 14.5",
    "value: '75%'",
    'value="65.9%"',
    'value="34.1%"',
    'value="+7.1%"',
    '11 BOOKS',
  ]) {
    assert.equal(card.includes(forbidden), false, 'forbidden sample leaked: ' + forbidden);
  }
  assert.match(card, /research\?\.gameLog/);
  assert.match(card, /catalogBookRows\(group\.quotes\)/);
  assert.match(card, /expectedValueFor\(modelGroup, prediction/);
  assert.match(card, /\/api\/props\/ml/);
  assert.match(card, /Unavailable/);
});

test('verified history model covers supported soccer and tennis research', async () => {
  const adaptive = await readFile(adaptivePath, 'utf8');
  assert.match(adaptive, /'SOCCER'/);
  assert.match(adaptive, /'TENNIS'/);
  assert.match(adaptive, /values\.length<9/);
  assert.match(adaptive, /Verified game history is unavailable/);
});
