import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrizePicksName,
  normalizePlayerPropOffers,
  normalizeSportsbookName,
  prizePicksOffers,
  summarizeSportsbookCoverage,
} from '../lib/data-sources/sportsdataio/odds.mjs';

function payload() {
  return [{
    BettingEventID: 10,
    GameID: 1001,
    GameStartTime: '2026-09-09T19:00:00Z',
    HomeTeam: 'LAL',
    AwayTeam: 'PHX',
    BettingMarkets: [{
      BettingMarketID: 20,
      BettingMarketType: 'Player Prop',
      BettingBetType: 'Points',
      BettingPeriodType: 'Full Game',
      PlayerID: 7,
      PlayerName: 'Alpha Beta',
      TeamKey: 'LAL',
      BettingOutcomes: [
        { BettingOutcomeID: 1, SportsbookOutcomeID: 'pp-1', SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Over', Value: 25.5, IsAvailable: true, IsAlternate: false, Updated: '2026-09-09T12:00:00Z' },
        { BettingOutcomeID: 2, SportsbookOutcomeID: 'pp-2', SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Under', Value: 25.5, IsAvailable: true, IsAlternate: false },
        { BettingOutcomeID: 3, SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Over', Value: 26.5, IsAvailable: true, IsAlternate: true },
        { BettingOutcomeID: 4, SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Under', Value: 24.5, IsAvailable: false, IsAlternate: false },
        { BettingOutcomeID: 5, SportsBook: { Name: 'DraftKings' }, BettingOutcomeType: 'Over', Value: 25.5, IsAvailable: true, IsAlternate: false },
      ],
    }],
  }];
}

test('sportsbook names normalize without guessing', () => {
  assert.equal(normalizeSportsbookName('PrizePicks'), 'prizepicks');
  assert.equal(normalizeSportsbookName({ Name: 'Prize Picks' }), 'prizepicks');
  assert.equal(isPrizePicksName({ Key: 'PrizePicks' }), true);
  assert.equal(isPrizePicksName('DraftKings'), false);
});

test('player-prop normalization carries market context and rejects alternates/unavailable rows', () => {
  const all = normalizePlayerPropOffers(payload(), { sport: 'NBA' });
  assert.equal(all.length, 3);
  const over = all.find((row) => row.sportsbookKey === 'prizepicks' && row.side === 'OVER');
  assert.deepEqual({
    playerId: over.playerId,
    playerName: over.playerName,
    market: over.market,
    line: over.line,
    side: over.side,
    sport: over.sport,
    gameId: over.gameId,
    gameStartTime: over.gameStartTime,
    isAlternate: over.isAlternate,
  }, {
    playerId: 7,
    playerName: 'Alpha Beta',
    market: 'Points',
    line: 25.5,
    side: 'OVER',
    sport: 'NBA',
    gameId: 1001,
    gameStartTime: '2026-09-09T19:00:00Z',
    isAlternate: false,
  });
});

test('PrizePicks extraction returns only exact available core PrizePicks outcomes', () => {
  const offers = prizePicksOffers(payload(), { sport: 'NBA' });
  assert.equal(offers.length, 2);
  assert.deepEqual(offers.map((row) => row.side).sort(), ['OVER', 'UNDER']);
  assert.ok(offers.every((row) => row.line === 25.5 && row.sportsbookKey === 'prizepicks' && row.isAlternate === false));
});

test('missing line/player/side is skipped instead of becoming zero or a guessed prop', () => {
  const broken = [{ BettingMarkets: [{
    BettingMarketType: 'Player Prop', BettingBetType: 'Points', PlayerID: 7, PlayerName: 'Alpha Beta',
    BettingOutcomes: [
      { SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Over', Value: null, IsAvailable: true, IsAlternate: false },
      { SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Yes', Value: 1.5, IsAvailable: true, IsAlternate: false },
    ],
  }] }];
  assert.deepEqual(prizePicksOffers(broken, { sport: 'NBA' }), []);
});

test('coverage counts only normalized core offers and detects PrizePicks safely', () => {
  const summary = summarizeSportsbookCoverage(payload(), 'PrizePicks', { sport: 'NBA' });
  assert.equal(summary.targetSeen, true);
  assert.equal(summary.targetOffers, 2);
  assert.equal(summary.totalCoreOffers, 3);
  assert.deepEqual(summary.operators.map((row) => [row.name, row.offers]), [['PrizePicks', 2], ['DraftKings', 1]]);
});

test('no PrizePicks row never becomes a false positive', () => {
  const onlyOtherBooks = [{ BettingMarkets: [{
    BettingMarketType: 'Player Prop', BettingBetType: 'Assists', PlayerID: 9, PlayerName: 'Other Player',
    BettingOutcomes: [
      { SportsBook: { Name: 'DraftKings' }, BettingOutcomeType: 'Over', Value: 7.5, IsAvailable: true, IsAlternate: false },
      { SportsBook: { Name: 'FanDuel' }, BettingOutcomeType: 'Under', Value: 7.5, IsAvailable: true, IsAlternate: false },
    ],
  }] }];
  const summary = summarizeSportsbookCoverage(onlyOtherBooks, 'PrizePicks', { sport: 'NBA' });
  assert.equal(summary.targetSeen, false);
  assert.equal(summary.targetOffers, 0);
  assert.equal(summary.totalCoreOffers, 2);
});
