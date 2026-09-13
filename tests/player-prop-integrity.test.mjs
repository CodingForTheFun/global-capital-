import assert from 'node:assert/strict';
import test from 'node:test';
import { isVerifiedPlayerPropRow } from '../lib/ingestion/player-prop-integrity.mjs';

test('rejects event team names masquerading as players', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Dallas Wings', homeTeam: 'Dallas Wings', awayTeam: 'Los Angeles Sparks', team: '',
  }), false);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'los angeles sparks', homeTeam: 'Dallas Wings', awayTeam: 'Los Angeles Sparks', team: '',
  }), false);
});

test('rejects rows whose player equals participant team metadata', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'New York Giants', homeTeam: '', awayTeam: '', team: 'New York Giants',
  }), false);
});

test('keeps real player names even when team metadata is present', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: "A'ja Wilson", homeTeam: 'Las Vegas Aces', awayTeam: 'Phoenix Mercury', team: 'Las Vegas Aces',
  }), true);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Odell Beckham Jr.', homeTeam: 'New York Giants', awayTeam: 'Dallas Cowboys', team: '',
  }), true);
});

test('rejects empty and generic participant identities', () => {
  assert.equal(isVerifiedPlayerPropRow({ playerName: '' }), false);
  assert.equal(isVerifiedPlayerPropRow({ playerName: 'Team' }), false);
  assert.equal(isVerifiedPlayerPropRow(null), false);
});
