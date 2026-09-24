import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('../components/player-prop-research-card.tsx', import.meta.url), 'utf8');

test('history model exposes validation evidence without fabricating confidence', () => {
  const start = card.indexOf('function HistoryModel(');
  const end = card.indexOf('export function PlayerPropResearchCard', start);
  const model = card.slice(start, end);
  assert.match(model, /data-qa="history-model-evidence"/);
  assert.match(model, /projectionValue - line/);
  assert.match(model, /prediction\?\.sampleSize/);
  assert.match(model, /prediction\?\.validation\?\.rmse/);
  assert.match(model, /prediction\?\.validation\?\.baselineRmse/);
  assert.match(model, /prediction\?\.validation\?\.observations/);
  assert.match(model, /prediction\?\.modelVersion/);
  assert.doesNotMatch(model, /confidence score|prop score/i);
});

test('missing validation fields render unavailable markers instead of estimates', () => {
  assert.match(card, /validationRmse === null \? '—'/);
  assert.match(card, /modelSample === null \? '—'/);
  assert.match(card, /Rolling checks unavailable/);
  assert.match(card, /Baseline error unavailable/);
  assert.match(card, /Version unavailable/);
});
