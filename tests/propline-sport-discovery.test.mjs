// PropLine reports 56 sports; this product mapped eleven by hand. A hand-written
// key that is subtly wrong does not error - the event list comes back empty and
// the sport just looks out of season - so keys are recognised by shape instead
// of transcribed, and the live catalogue fills in what the static map misses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchProplineSport, sportMapFromCatalog, SPORT_KEYS } from '../lib/data-sources/propline/markets.mjs';

test('the disciplines this product models are placed exactly', () => {
  assert.equal(matchProplineSport('football_nfl'), 'NFL');
  assert.equal(matchProplineSport('basketball_wnba'), 'WNBA');
  assert.equal(matchProplineSport('baseball_mlb'), 'MLB');
  assert.equal(matchProplineSport('hockey_nhl'), 'NHL');
  assert.equal(matchProplineSport('football_ncaaf'), 'NCAAF');
});

test('separately modelled soccer competitions keep their own board', () => {
  assert.equal(matchProplineSport('soccer_epl'), 'EPL');
  assert.equal(matchProplineSport('soccer_uefa_champs_league'), 'UCL');
  assert.equal(matchProplineSport('soccer_mls'), 'MLS');
});

test('an MLS alias still resolves, so a key change upstream does not silently empty the board', () => {
  assert.equal(matchProplineSport('soccer_usa_mls'), 'MLS');
  assert.equal(matchProplineSport('soccer_england_premier_league'), 'EPL');
});

test('every other soccer competition lands on the generic soccer board', () => {
  for (const key of ['soccer_spain_la_liga', 'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_mexico_liga_mx', 'soccer_brazil_serie_a']) {
    assert.equal(matchProplineSport(key), 'SOCCER', `${key} should not be dropped`);
  }
});

test('sports this product does not model return null rather than a wrong home', () => {
  for (const key of ['darts', 'snooker', 'cycling', 'badminton', 'volleyball']) {
    assert.equal(matchProplineSport(key), null, `${key} must not be forced onto a board`);
  }
  assert.equal(matchProplineSport(''), null);
  assert.equal(matchProplineSport(undefined), null);
});

test('a live catalogue never loses the static map', () => {
  const map = sportMapFromCatalog([{ key: 'football_nfl', active: true }]);
  for (const sport of Object.keys(SPORT_KEYS)) {
    assert.ok(map[sport], `${sport} must survive discovery`);
  }
});

test('an inactive sport is skipped, since asking costs a request to learn nothing', () => {
  const map = sportMapFromCatalog([{ key: 'basketball_nba', active: false }]);
  // Falls back to the static key rather than adopting the inactive one.
  assert.equal(map.NBA, SPORT_KEYS.NBA);
});

test('discovery accepts both a bare array and a wrapped payload', () => {
  const bare = sportMapFromCatalog([{ key: 'soccer_epl', active: true }]);
  const wrapped = sportMapFromCatalog({ sports: [{ key: 'soccer_epl', active: true }] });
  assert.equal(bare.EPL, 'soccer_epl');
  assert.equal(wrapped.EPL, 'soccer_epl');
});

test('a malformed catalogue degrades to the static map instead of throwing', () => {
  for (const input of [null, undefined, 'nonsense', [null, 42, {}]]) {
    const map = sportMapFromCatalog(input);
    assert.equal(map.NFL, SPORT_KEYS.NFL);
  }
});
