import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, resolvePlayer, isTrustworthy, sameTeam, MATCH, MIN_CONFIDENCE } from '../lib/data-sources/identity.mjs';

const rows = [
  { PlayerID: 101, Name: 'Alpha Beta', Team: 'LAL', Opponent: 'PHX', Points: 29 },
  { PlayerID: 202, Name: 'Same Name', Team: 'BOS', Opponent: 'NYK', Points: 12 },
  { PlayerID: 303, Name: 'Same Name', Team: 'MIA', Opponent: 'ORL', Points: 22 },
  { PlayerID: 404, Name: 'No Context', Points: 8 },
];
const index = buildIndex(rows);

test('a provider player id is the strongest match', () => {
  const r = resolvePlayer({ playerName: 'Wrong Name Entirely', providerPlayerId: 101 }, index);
  assert.equal(r.method, MATCH.PROVIDER_ID);
  assert.equal(r.confidence, 1);
  assert.equal(r.row.PlayerID, 101);
  assert.ok(isTrustworthy(r), 'an id match is always trustworthy');
});

test('name plus team and opponent is a full-context match', () => {
  const r = resolvePlayer({ playerName: 'Alpha Beta', team: 'LAL', opponent: 'PHX' }, index);
  assert.equal(r.method, MATCH.NAME_AND_GAME);
  assert.ok(r.confidence >= MIN_CONFIDENCE);
  assert.equal(r.row.PlayerID, 101);
});

test('a contradicting team or opponent is refused, not resolved', () => {
  const wrongTeam = resolvePlayer({ playerName: 'Alpha Beta', team: 'BOS' }, index);
  assert.equal(wrongTeam.row, null);
  assert.equal(wrongTeam.method, MATCH.NOT_FOUND);
  assert.match(wrongTeam.reason, /contradicts/);

  const wrongOpponent = resolvePlayer({ playerName: 'Alpha Beta', opponent: 'DEN' }, index);
  assert.equal(wrongOpponent.row, null);
  assert.ok(!isTrustworthy(wrongOpponent));
});

test('two players sharing a name are AMBIGUOUS and enrich nothing', () => {
  const r = resolvePlayer({ playerName: 'Same Name' }, index);
  assert.equal(r.method, MATCH.AMBIGUOUS);
  assert.equal(r.row, null);
  assert.equal(r.candidates, 2);
  assert.ok(!isTrustworthy(r), 'no enrichment beats wrong enrichment');
});

test('context isolates one of several same-name players', () => {
  const r = resolvePlayer({ playerName: 'Same Name', team: 'MIA' }, index);
  assert.equal(r.row.PlayerID, 303);
  assert.ok(isTrustworthy(r));
  assert.match(r.reason, /isolated 1 of 2/);
});

test('context that matches neither same-name player stays ambiguous', () => {
  const r = resolvePlayer({ playerName: 'Same Name', team: 'GSW' }, index);
  assert.equal(r.row, null);
  assert.equal(r.method, MATCH.AMBIGUOUS);
});

test('a name-only match with context available but unchecked is below the bar', () => {
  // The row HAS team data; the prop simply did not supply any to check.
  const r = resolvePlayer({ playerName: 'Alpha Beta' }, index);
  assert.equal(r.method, MATCH.NAME_AND_LEAGUE);
  assert.ok(r.confidence < MIN_CONFIDENCE, 'name alone is not enough when context exists to check');
  assert.ok(!isTrustworthy(r));
});

test('a unique name in a feed that carries no context at all is trusted', () => {
  // League-scoped feeds like the injury list have no team column.
  const contextless = buildIndex([{ Name: 'Only One', Status: 'Out' }], { teamOf: () => null, opponentOf: () => null });
  const r = resolvePlayer({ playerName: 'Only One', team: 'LAL' }, contextless);
  assert.equal(r.method, MATCH.NAME_UNIQUE_IN_FEED);
  assert.ok(isTrustworthy(r));

  // But duplicates in that same feed are still refused.
  const dupes = buildIndex([{ Name: 'Only One' }, { Name: 'Only One' }], { teamOf: () => null, opponentOf: () => null });
  assert.equal(resolvePlayer({ playerName: 'Only One' }, dupes).method, MATCH.AMBIGUOUS);
});

test('an unknown player resolves to nothing', () => {
  const r = resolvePlayer({ playerName: 'Nobody Here' }, index);
  assert.equal(r.method, MATCH.NOT_FOUND);
  assert.equal(r.candidates, 0);
  assert.ok(!isTrustworthy(r));
});

test('name normalisation joins real-world spelling differences', () => {
  const tricky = buildIndex([{ PlayerID: 1, Name: 'Shai Gilgeous-Alexander', Team: 'OKC' }]);
  for (const written of ['Shai Gilgeous Alexander', 'shai gilgeous-alexander', 'Shai Gilgeous‑Alexander'.replace('‑', '-')]) {
    assert.ok(resolvePlayer({ playerName: written, team: 'OKC' }, tricky).row, `failed to join: ${written}`);
  }
});

test('team comparison is loose but never invents agreement', () => {
  assert.equal(sameTeam('LAL', 'LAL'), true);
  assert.equal(sameTeam('LAL', 'lal'), true);
  assert.equal(sameTeam('LAL', 'BOS'), false);
  assert.equal(sameTeam('', 'BOS'), null, 'unknown is not a contradiction');
  assert.equal(sameTeam(null, null), null);
});

test('every resolution carries a reason for auditing', () => {
  for (const prop of [{ playerName: 'Alpha Beta', team: 'LAL' }, { playerName: 'Same Name' }, { playerName: 'Nobody' }]) {
    const r = resolvePlayer(prop, index);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'a match must explain itself');
    assert.ok(typeof r.confidence === 'number');
  }
});
