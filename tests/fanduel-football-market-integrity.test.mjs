import assert from 'node:assert/strict';
import test from 'node:test';
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
