import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLineHistory } from '../lib/analytics/research.mjs';
const scope = { propId: 'prop', bookmaker: 'book', side: 'OVER' };
const row = (time, line, price = null, extra = {}) => ({ prop_id: 'prop', bookmaker_key: 'book', side: 'OVER', created_at: `2026-01-01T${time}:00Z`, line, price, ...extra });

test('history preserves observed zero/null and isolates prop, book and side', () => {
  const r = analyzeLineHistory([row('11:00', 1, -115), row('10:00', 0), row('10:00', 0),
    row('12:00', null), row('12:00', 99, null, { side: 'UNDER' }),
    row('12:00', 99, null, { prop_id: 'other' }), row('12:00', 99, null, { bookmaker_key: 'other' })], scope);
  assert.equal(r.rows.length, 2);
  assert.equal(r.first.line, 0);
  assert.equal(r.first.price, null);
  assert.equal(r.last.line, 1);
  assert.equal(r.lineChange, 1);
  assert.equal(r.building, false);
});

test('one timestamp is building history; price-only changes remain visible', () => {
  assert.equal(analyzeLineHistory([row('10:00', 5)], scope).building, true);
  const r = analyzeLineHistory([row('10:00', 5, -110), row('11:00', 5, -105)], scope);
  assert.equal(r.changes.length, 2);
  assert.equal(r.lineChange, 0);
  assert.equal(analyzeLineHistory([], scope).lineChange, null);
});
