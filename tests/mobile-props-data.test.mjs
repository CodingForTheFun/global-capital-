import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizePlayerPropOffers, prizePicksOffers, summarizePlayerPropShape } from '../lib/data-sources/sportsdataio/odds.mjs';
import { indexPlayerDirectory, resolveOfferPlayers } from '../lib/data-sources/sportsdataio/player-directory.mjs';
import { renderPropCardsMarkup } from '../public/props-presenter.mjs';

test('sportsbook Participant free-text is never exposed as a player name', () => {
  const opaque = '6vle0wrattmgipx';
  const offers = normalizePlayerPropOffers([{
    BettingMarketID: 9,
    BettingBetType: 'Player Receptions',
    PlayerID: 42,
    BettingOutcomes: [{
      SportsBook: { Name: 'Sleeper' },
      BettingOutcomeType: 'Over',
      Value: 2.5,
      Participant: opaque,
      PlayerID: 42,
      IsAvailable: true,
      IsAlternate: false,
    }],
  }], { sport: 'NFL' });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].playerName, null);
  assert.notEqual(offers[0].playerName, opaque);
});

test('SportsDataIO consensus outcomes become clearly labelled provider lines only when no sportsbook rows are usable', () => {
  const payload = [{
    BettingMarketID: 90,
    BettingBetType: 'Player Hits',
    PlayerID: 99,
    PlayerName: 'Example Hitter',
    BettingOutcomes: [],
    ConsensusOutcomes: [
      { BettingOutcomeType: 'Over', Value: 1.5, PlayerID: 99, IsAvailable: true, IsAlternate: false },
      { BettingOutcomeType: 'Under', Value: 1.5, PlayerID: 99, IsAvailable: true, IsAlternate: false },
    ],
  }];
  const offers = normalizePlayerPropOffers(payload, { sport: 'MLB' });
  assert.equal(offers.length, 2);
  assert.equal(offers[0].sportsbook, 'Consensus');
  assert.equal(offers[0].consensus, true);
  assert.equal(prizePicksOffers(payload, { sport: 'MLB' }).length, 0);
  const shape = summarizePlayerPropShape(payload);
  assert.equal(shape.consensusOutcomes, 2);
  assert.equal(shape.playerMarkets, 1);
});

test('missing betting player names resolve by exact SportsDataIO PlayerID', () => {
  const directory = indexPlayerDirectory([
    { PlayerID: 42, Name: 'George Kittle', Team: 'SF' },
    { PlayerID: 43, Name: 'Christian McCaffrey', Team: 'SF' },
  ]);
  const result = resolveOfferPlayers([{ playerId: 42, playerName: null, team: null, line: 4.5 }], directory);
  assert.equal(result.unresolved, 0);
  assert.equal(result.offers[0].playerName, 'George Kittle');
  assert.equal(result.offers[0].team, 'SF');
});

test('prop cards render real names plus green recent-form state classes', () => {
  const html = renderPropCardsMarkup([{
    id: 'internal-prop-key', provider: 'sportsdataio', sportsbook: 'Sleeper', sport: 'NFL',
    playerName: 'George Kittle', team: 'SF', opponent: 'LAR', market: 'Player Receptions',
    marketDisplayName: 'Player Receptions', line: 4.5, side: 'OVER', score: 82,
    hitRates: { l5: 80, l10: 70, l15: 73, h2h: 75 },
    lastFiveResults: [
      { value: 6, hit: true }, { value: 5, hit: true }, { value: 3, hit: false },
      { value: 7, hit: true }, { value: 4, hit: false },
    ],
  }]);
  assert.match(html, />George Kittle</);
  assert.match(html, /recent-box hit/);
  assert.match(html, /recent-box miss/);
  assert.doesNotMatch(html, />internal-prop-key</);
});

test('mobile props page uses numbered pagination instead of load-more scrolling', async () => {
  const [html, js] = await Promise.all([
    fs.readFile(new URL('../public/props.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/props-v2.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="prevPageBtn"/);
  assert.match(html, /id="nextPageBtn"/);
  assert.match(html, /option value="25"/);
  assert.doesNotMatch(html, /Load more props/i);
  assert.match(js, /state\.offset=\(next-1\)\*state\.limit/);
});
