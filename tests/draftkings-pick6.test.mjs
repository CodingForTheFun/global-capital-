import test from 'node:test';
import assert from 'node:assert/strict';
import { pick6Leagues } from '../lib/ingestion/draftkings-pick6.mjs';

// The shape the live endpoint returns today: the abbreviation is nested under
// `league`, and the flat name/displayName fields are gone. sportLeagueKey is
// only a numeric pair, so nothing else in the row identifies the sport.
const liveRoot = {
  sportLeagues: [
    { sportLeagueKey: '1-1', hasPicksAvailable: true, league: { leagueId: 1, leagueName: 'National Football League', leagueAbbreviation: 'NFL' } },
    { sportLeagueKey: '2-2', hasPicksAvailable: true, league: { leagueId: 2, leagueName: 'Major League Baseball', leagueAbbreviation: 'MLB' } },
    { sportLeagueKey: '12', hasPicksAvailable: true, league: { leagueId: 12, leagueName: 'Soccer', leagueAbbreviation: 'SOCCER' } },
    { sportLeagueKey: '3-3', hasPicksAvailable: false, league: { leagueAbbreviation: 'NHL' } },
  ],
};

test('Pick6 leagues match on the nested league abbreviation', () => {
  assert.equal(pick6Leagues(liveRoot, 'NFL').length, 1);
  assert.equal(pick6Leagues(liveRoot, 'NFL')[0].sportLeagueKey, '1-1');
  assert.equal(pick6Leagues(liveRoot, 'MLB').length, 1);
});

test('Pick6 leagues without picks available are skipped', () => {
  assert.equal(pick6Leagues(liveRoot, 'NHL').length, 0);
});

test('an unsupported or absent sport yields nothing rather than everything', () => {
  assert.deepEqual(pick6Leagues(liveRoot, 'SOCCER'), []);
  assert.deepEqual(pick6Leagues(liveRoot, ''), []);
  assert.deepEqual(pick6Leagues(null, 'NFL'), []);
});

// A rollback to the flat shape must not silently return zero rows again.
test('the older flat league shape still matches', () => {
  const legacy = { sportLeagues: [{ sportLeagueKey: '1-1', hasPicksAvailable: true, displayName: 'NFL' }] };
  assert.equal(pick6Leagues(legacy, 'NFL').length, 1);
});

test('tennis tours both resolve so neither tour is silently dropped', () => {
  const tennis = { sportLeagues: [
    { sportLeagueKey: '9-1', hasPicksAvailable: true, league: { leagueAbbreviation: 'ATP' } },
    { sportLeagueKey: '9-2', hasPicksAvailable: true, league: { leagueAbbreviation: 'WTA' } },
  ] };
  assert.equal(pick6Leagues(tennis, 'TENNIS').length, 2);
});
