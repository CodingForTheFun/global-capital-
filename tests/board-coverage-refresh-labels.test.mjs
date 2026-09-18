import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SPORTS, SUPPORTED_SPORTS, AUTOMATIC_SPORTS } from '../lib/autoscout/models.mjs';
import { ADDITIONAL_PUBLIC_SPORTS, BOARD_COVERAGE_LABELS, auditBoardCoverage } from '../lib/autoscout/board-coverage-catalog.mjs';

// Synthetic aggregate regression reproducing the two sport-tag counts observed
// after the 2026-09-18 01:47 UTC public-feed refresh. No provider or DB requests.
test('newly observed BEACHVB and LA LIGA cached rows are reachable without paid research or polling', () => {
  const tags = ['BEACHVB', 'LA LIGA'];
  for (const sport of tags) {
    assert.ok(ADDITIONAL_PUBLIC_SPORTS.includes(sport));
    assert.ok(BOARD_SPORTS.includes(sport));
    assert.ok(!SUPPORTED_SPORTS.includes(sport));
    assert.ok(!AUTOMATIC_SPORTS.includes(sport));
  }
  assert.equal(BOARD_COVERAGE_LABELS['LA LIGA'], 'La Liga');
  const expires_at = '2026-09-18T02:00:00Z';
  const rows = [
    ...Array.from({ length: 10 }, () => ({ sport: 'BEACHVB', expires_at })),
    ...Array.from({ length: 4 }, () => ({ sport: 'LA LIGA', expires_at })),
  ];
  const before = JSON.stringify(rows);
  const now = Date.parse('2026-09-18T01:47:51Z');
  const oldCatalog = BOARD_SPORTS.filter((sport) => !tags.includes(sport));
  assert.equal(auditBoardCoverage(rows, oldCatalog, now).unreachable, 14);
  const audit = auditBoardCoverage(rows, BOARD_SPORTS, now);
  assert.equal(audit.active, 14);
  assert.equal(audit.reachable, 14);
  assert.equal(audit.unreachable, 0);
  assert.deepEqual(audit.missingBySport, []);
  assert.equal(JSON.stringify(rows), before);
});
