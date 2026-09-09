import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizePlayerPropOffers } from '../lib/data-sources/sportsdataio/odds.mjs';
import { createSportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';

const KEY = 'test-key-not-a-real-credential';

test('player prop normalization accepts canonical PlayerName when PlayerID is unavailable', () => {
  const rows = normalizePlayerPropOffers([{
    BettingMarketID: 101,
    BettingMarketType: 'Player Prop',
    BettingBetType: 'Total Hits',
    PlayerName: 'Shohei Ohtani',
    TeamKey: 'LAD',
    BettingOutcomes: [
      { SportsBook: { Name: 'Book A' }, BettingOutcomeType: 'Over', Value: 1.5, IsAvailable: true, IsAlternate: false },
      { SportsBook: { Name: 'Book A' }, BettingOutcomeType: 'Under', Value: 1.5, IsAvailable: true, IsAlternate: false },
    ],
  }], { sport: 'MLB' });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].playerName, 'Shohei Ohtani');
  assert.equal(rows[0].playerId, null);
});

test('prop board checks upcoming date slates instead of today only', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const calls = [];
  const market = (name) => [{
    BettingMarketID: 200,
    BettingMarketType: 'Player Prop',
    BettingBetType: 'Total Hits',
    PlayerName: name,
    TeamKey: 'LAD',
    BettingOutcomes: [
      { SportsBook: { Name: 'Book A' }, BettingOutcomeType: 'Over', Value: 1.5, IsAvailable: true, IsAlternate: false },
      { SportsBook: { Name: 'Book A' }, BettingOutcomeType: 'Under', Value: 1.5, IsAvailable: true, IsAlternate: false },
    ],
  }];
  const client = {
    async get(_url, path) {
      calls.push(path);
      if (path.includes('GamesByDate/2026-SEP-09')) return { ok: true, status: 200, data: [{ GameID: 1, DateTime: '2026-09-09T19:00:00Z', HomeTeam: 'LAD', AwayTeam: 'COL' }] };
      if (path.includes('GamesByDate/2026-SEP-10')) return { ok: true, status: 200, data: [{ GameID: 2, DateTime: '2026-09-10T19:00:00Z', HomeTeam: 'LAD', AwayTeam: 'COL' }] };
      if (path.includes('GamesByDate/')) return { ok: true, status: 200, data: [] };
      if (path.includes('BettingPlayerPropsByGameID/1')) return { ok: true, status: 200, data: market('Shohei Ohtani') };
      if (path.includes('BettingPlayerPropsByGameID/2')) return { ok: true, status: 200, data: market('Mookie Betts') };
      return { ok: false, status: 404, reason: 'not found', data: null };
    },
    stats() { return {}; },
  };

  const board = createSportsDataIoPropBoard({ client, now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await board.fetchBoard({ sports: ['MLB'], force: true });

  assert.equal(result.coverage[0].gamesChecked, 2);
  assert.equal(result.offers.length, 4);
  assert.ok(calls.some((path) => path.includes('GamesByDate/2026-SEP-10')));
  delete process.env.SPORTSDATAIO_API_KEY;
});

test('mobile props starts with no sticky filters and Today only is opt-in', async () => {
  const [js, html] = await Promise.all([
    fs.readFile(new URL('../public/props-v2.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/props.html', import.meta.url), 'utf8'),
  ]);

  assert.match(js, /timeWindow: 'ALL'/);
  assert.match(js, /p\.get\('share'\) !== '1'/);
  assert.doesNotMatch(js, /RULES_PREF/);
  assert.doesNotMatch(html, /id="todayOnlyFilter"[^>]*checked/);
});
