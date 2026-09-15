import test from 'node:test';
import assert from 'node:assert/strict';
import { prizePicksSpecialFaceHtml, verifiedPrizePicksSpecial } from '../lib/ui/offer-promotion.mjs';

const now = Date.parse('2026-09-15T16:20:00.000Z');
const base = {
  sportsbookKey: 'prizepicks',
  isAlternate: true,
  specialVerified: true,
  specialSourceId: 'source-projection-1',
  line: 24.5,
  gameStartTime: '2026-09-16T00:00:00.000Z',
  ingestedAt: '2026-09-15T16:15:00.000Z',
};

test('does not show a Goblin/Demon badge from projection-level metadata without an exact side', () => {
  const row = {
    ...base,
    side: null,
    specialType: 'goblin',
    specialSideVerified: false,
    specialTypeSource: 'projection_odds_type',
  };
  assert.equal(verifiedPrizePicksSpecial(row, now), null);
  assert.equal(prizePicksSpecialFaceHtml(row, now), '');
});

test('does not show a directional badge unless PrizePicks explicitly verified that side', () => {
  const row = {
    ...base,
    side: 'OVER',
    specialType: 'demon',
    specialSideVerified: false,
    specialTypeSource: 'projection_odds_type',
  };
  assert.equal(verifiedPrizePicksSpecial(row, now), null);
  assert.equal(prizePicksSpecialFaceHtml(row, now), '');
});

test('shows a Goblin/Demon badge only for the exact source-verified outcome', () => {
  const row = {
    ...base,
    side: 'UNDER',
    specialType: 'goblin',
    specialSideVerified: true,
    specialTypeSource: 'outcome_metadata',
  };
  const special = verifiedPrizePicksSpecial(row, now);
  assert.deepEqual(special && { type: special.type, side: special.side, line: special.line }, {
    type: 'goblin',
    side: 'UNDER',
    line: 24.5,
  });
  assert.match(prizePicksSpecialFaceHtml(row, now), /PrizePicks Goblin/);
  assert.match(prizePicksSpecialFaceHtml(row, now), /Less variant/);
});
