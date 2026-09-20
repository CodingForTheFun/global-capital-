import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFanDuelPublic } from '../lib/ingestion/fanduel-public.mjs';
import { isVerifiedPlayerPropRow } from '../lib/ingestion/player-prop-integrity.mjs';

const base = {
  sportsbookKey: 'fanduel',
  provider: 'fanduel',
  sport: 'NFL',
  marketId: 'player_receptions',
  playerName: 'Chris Olave',
  homeTeam: 'New Orleans Saints',
  awayTeam: 'Jacksonville Jaguars',
  team: '',
};

const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: async () => JSON.stringify(payload),
});

test('FanDuel football rejects baseball market artifacts produced by player text', () => {
  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    marketId: 'player_strikeouts',
    playerName: 'Chris Broo',
    homeTeam: 'Carolina Panthers',
    awayTeam: 'Buffalo Bills',
  }), false);

  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    sport: 'NCAAF',
    marketId: 'player_strikeouts',
    playerName: 'Antonio Mee',
    homeTeam: 'Boston College',
    awayTeam: 'Stanford',
  }), false);
});

test('FanDuel football rejects generic team points masquerading as a player prop', () => {
  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    sport: 'NCAAF',
    marketId: 'player_points',
    playerName: 'Miami FL',
    homeTeam: 'Wake Forest',
    awayTeam: 'Miami Florida',
  }), false);
});

test('generic home/away team sentinels are never accepted as player identities', () => {
  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    sport: 'WNBA',
    marketId: 'player_points',
    playerName: 'Home Team',
    homeTeam: 'Minnesota Lynx',
    awayTeam: 'New York Liberty',
  }), false);

  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    sport: 'WNBA',
    marketId: 'player_points',
    playerName: 'Away Team',
    homeTeam: 'Minnesota Lynx',
    awayTeam: 'New York Liberty',
  }), false);
});

test('truncated event-team identities are rejected without suppressing real MLB players', () => {
  const event = {
    ...base,
    sport: 'MLB',
    marketId: 'pitcher_strikeouts',
    homeTeam: 'Arizona Diamondbacks (B Pfaadt)',
    awayTeam: 'New York Yankees (L Gil)',
  };

  assert.equal(isVerifiedPlayerPropRow({ ...event, playerName: 'Arizona Diamondbac' }), false);
  assert.equal(isVerifiedPlayerPropRow({ ...event, playerName: 'Brandon Pfaadt' }), true);
  assert.equal(isVerifiedPlayerPropRow({ ...event, playerName: 'Luis Gil' }), true);
});

test('valid football and baseball player markets remain allowed', () => {
  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    sport: 'NCAAF',
    marketId: 'player_pass_tds',
    playerName: 'Drew Allar',
    homeTeam: 'Penn State Nittany Lions',
    awayTeam: 'Michigan Wolverines',
  }), true);

  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    sport: 'MLB',
    marketId: 'pitcher_strikeouts',
    playerName: 'Paul Skenes',
    homeTeam: 'Pittsburgh Pirates',
    awayTeam: 'Chicago Cubs',
  }), true);
});

test('FanDuel public MLB parsing drops a truncated team label and keeps the real pitcher', async () => {
  const event = {
    eventId: 'fd-mlb-396',
    name: 'New York Yankees (L Gil) @ Arizona Diamondbacks (B Pfaadt)',
    openDate: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  const pagePayload = { attachments: { events: [event] } };
  const eventPayload = {
    attachments: {
      events: [event],
      markets: [
        {
          marketId: 'bad-team-label',
          marketName: 'Arizona Diamondbac Strikeouts',
          runners: [
            { runnerName: 'Over 2.5', handicap: 2.5, americanOdds: -110 },
            { runnerName: 'Under 2.5', handicap: 2.5, americanOdds: -110 },
          ],
        },
        {
          marketId: 'real-pitcher',
          marketName: 'Brandon Pfaadt Strikeouts',
          runners: [
            { runnerName: 'Over 5.5', handicap: 5.5, americanOdds: -105 },
            { runnerName: 'Under 5.5', handicap: 5.5, americanOdds: -115 },
          ],
        },
      ],
    },
  };
  let calls = 0;
  const fetcher = async () => jsonResponse(calls++ === 0 ? pagePayload : eventPayload);

  const result = await fetchFanDuelPublic('MLB', { fetcher, force: true });
  assert.deepEqual(result.records.map((row) => row.playerName), ['Brandon Pfaadt']);
});

test('the football restriction is isolated to FanDuel', () => {
  assert.equal(isVerifiedPlayerPropRow({
    ...base,
    sportsbookKey: 'propline',
    provider: 'propline',
    sport: 'NCAAF',
    marketId: 'player_points',
    playerName: 'Example Player',
    homeTeam: 'Team A',
    awayTeam: 'Team B',
  }), true);
});
