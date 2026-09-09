import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBettingOutcomes, isPrizePicksName, normalizeSportsbookName, summarizeSportsbookCoverage } from '../lib/data-sources/sportsdataio/odds.mjs';

test('sportsbook names normalize without guessing', () => {
  assert.equal(normalizeSportsbookName('PrizePicks'), 'prizepicks');
  assert.equal(normalizeSportsbookName({ Name: 'Prize Picks' }), 'prizepicks');
  assert.equal(isPrizePicksName({ Key: 'PrizePicks' }), true);
  assert.equal(isPrizePicksName('DraftKings'), false);
});

test('coverage walks nested betting payloads and counts only core available offers', () => {
  const payload = [{
    BettingEventID: 10,
    BettingMarkets: [{
      BettingMarketType: 'Player Prop',
      BettingBetType: 'Total Points',
      BettingOutcomes: [
        { BettingOutcomeID: 1, SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Over', Value: 25.5, IsAvailable: true, IsAlternate: false },
        { BettingOutcomeID: 2, SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Under', Value: 25.5, IsAvailable: true, IsAlternate: false },
        { BettingOutcomeID: 3, SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Over', Value: 26.5, IsAvailable: true, IsAlternate: true },
        { BettingOutcomeID: 4, SportsBook: { Name: 'DraftKings' }, BettingOutcomeType: 'Over', Value: 25.5, IsAvailable: false, IsAlternate: false },
      ],
    }],
  }];

  const all = collectBettingOutcomes(payload);
  assert.equal(all.length, 4);
  const summary = summarizeSportsbookCoverage(payload, 'PrizePicks');
  assert.equal(summary.targetSeen, true);
  assert.equal(summary.targetOffers, 2);
  assert.equal(summary.totalCoreOffers, 2);
  assert.deepEqual(summary.operators.map((row) => row.name), ['PrizePicks']);
});

test('no PrizePicks row never becomes a false positive', () => {
  const payload = [{
    BettingOutcomes: [
      { BettingOutcomeID: 8, SportsBook: { Name: 'DraftKings' }, BettingOutcomeType: 'Over', Value: 7.5, IsAvailable: true, IsAlternate: false },
      { BettingOutcomeID: 9, SportsBook: { Name: 'FanDuel' }, BettingOutcomeType: 'Under', Value: 7.5, IsAvailable: true, IsAlternate: false },
    ],
  }];
  const summary = summarizeSportsbookCoverage(payload, 'PrizePicks');
  assert.equal(summary.targetSeen, false);
  assert.equal(summary.targetOffers, 0);
  assert.equal(summary.totalCoreOffers, 2);
});
