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

test('rejects abbreviated event team names masquerading as players', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'ATL Falcons', homeTeam: 'Atlanta Falcons', awayTeam: 'Carolina Panthers', team: '',
  }), false);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'NY Jets', homeTeam: 'New York Jets', awayTeam: 'Buffalo Bills', team: '',
  }), false);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'GB Packers', homeTeam: 'Green Bay Packers', awayTeam: 'Detroit Lions', team: '',
  }), false);
});

test('rejects parser-damaged team labels with event qualifiers', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Chicago W e Sox',
    homeTeam: 'Cleveland Guardians (P Messick)',
    awayTeam: 'Chicago White Sox (A Kay)',
    team: '',
  }), false);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Jordan White',
    homeTeam: 'Cleveland Guardians (P Messick)',
    awayTeam: 'Chicago White Sox (A Kay)',
    team: 'Chicago White Sox',
  }), true);
});

test('rejects rows whose player equals participant team metadata', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'New York Giants', homeTeam: '', awayTeam: '', team: 'New York Giants',
  }), false);
});

test('rejects generic non-player market labels', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Moneyline Parlay', homeTeam: 'Florida Panthers', awayTeam: 'Tampa Bay Lightning', team: '',
  }), false);
});

test('rejects BetMGM soccer combined-scored match outcomes', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'FK Smederevo 1924 and combined scored', homeTeam: 'FK Smederevo 1924', awayTeam: 'FK Vozdovac', team: '',
  }), false);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Tie and combined scored', homeTeam: 'FC Zbrojovka Brno', awayTeam: 'SK Slavia Praha B', team: '',
  }), false);
});

test('keeps real player names even when team metadata is present', () => {
  assert.equal(isVerifiedPlayerPropRow({
    playerName: "A'ja Wilson", homeTeam: 'Las Vegas Aces', awayTeam: 'Phoenix Mercury', team: 'Las Vegas Aces',
  }), true);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Odell Beckham Jr.', homeTeam: 'New York Giants', awayTeam: 'Dallas Cowboys', team: '',
  }), true);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Kirk Cousins', homeTeam: 'Atlanta Falcons', awayTeam: 'Carolina Panthers', team: 'Atlanta Falcons',
  }), true);
  assert.equal(isVerifiedPlayerPropRow({
    playerName: 'Lionel Messi', homeTeam: 'Inter Miami CF', awayTeam: 'Orlando City SC', team: 'Inter Miami CF',
  }), true);
});

test('rejects empty and generic participant identities', () => {
  assert.equal(isVerifiedPlayerPropRow({ playerName: '' }), false);
  assert.equal(isVerifiedPlayerPropRow({ playerName: 'Team' }), false);
  assert.equal(isVerifiedPlayerPropRow(null), false);
});