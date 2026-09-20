import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSettledFantasyResearch, normalizeSettledFantasyHistory, settledFantasySelection } from '../lib/data-sources/propline/fantasy-research.mjs';

const now = Date.parse('2026-09-20T12:00:00Z');
const params = { sport: 'WNBA', playerName: 'Fixture Player', market: 'Fantasy Score', providerMarketKey: 'prizepicks:player_fantasy_score', games: 20, gameStartTime: '2026-09-21T00:00:00Z' };
function fixture(sport = 'basketball_wnba', book = 'prizepicks') {
  const games = [1, 2, 3].map(i => ({ event_id: String(i), commence_time: `2026-09-${19-i}T00:00:00Z`, status: 'final', opponent: 'Opponent', is_home: i === 1, stats: { minutes: 25 } }));
  return {
    archive: { sport_key: sport, player_name: 'Fixture Player', games },
    history: { sport_key: sport, player_name: 'Fixture Player', market: 'player_fantasy_score', entries: games.map((row, i) => ({ ...row, bookmaker: book, line: 15, actual_value: [29.8, 0, -2.5][i], over_result: i === 0 ? 'won' : 'lost', under_result: i === 0 ? 'lost' : 'won', resolved_at: row.commence_time.replace('00:00', '03:00') })) },
  };
}
const normalize = (data, extra = {}) => normalizeSettledFantasyHistory(data.history, data.archive, { ...params, ...extra }, data.history.sport_key, now);

test('platform settlement scores support zero and negative fantasy totals without a reconstructed formula', () => {
  const result = normalize(fixture());
  assert.equal(result.available, true);
  assert.deepEqual(result.gameLog.map(row => row.value), [29.8, 0, -2.5]);
  assert.equal(result.fantasyScoring.method, 'settled_platform_values');
  assert.equal(result.coverage.seasonComplete, false);
});

test('missing, ambiguous, redacted or unsettled values cannot silently shorten recent-game windows', () => {
  for (const mutate of [
    d => d.history.entries.pop(),
    d => { d.history.entries[1].actual_value = null; },
    d => { d.history.entries[1].actual_value = false; },
    d => { d.history.entries[1].redacted = true; },
    d => { d.history.entries[1].bookmaker = 'underdog'; },
    d => { d.history.entries[1].over_result = 'void'; },
    d => { d.history.entries[1].resolved_at = null; },
    d => { d.history.entries[1].resolved_at = '2027-01-01T00:00:00Z'; },
    d => { d.history.entries[1].commence_time = '2026-09-01T00:00:00Z'; },
    d => d.history.entries.push({ ...d.history.entries[1], actual_value: 50 }),
    d => d.archive.games.push({ ...d.archive.games[1], opponent: 'Different opponent' }),
  ]) {
    const data = fixture(); mutate(data);
    const result = normalize(data);
    assert.equal(result.available, false);
    assert.deepEqual(result.gameLog, []);
  }
});

test('duplicate posted lines with one settled value count as one played game', () => {
  const data = fixture(); data.history.entries.push({ ...data.history.entries[0], line: 20 });
  assert.equal(normalize(data).gameLog.length, 3);
});

test('DNP, current and future games do not enter the fantasy sample', () => {
  const data = fixture();
  data.archive.games[0].did_not_play = true;
  data.archive.games.push({ ...data.archive.games[1], event_id: 'future', commence_time: '2026-09-22T00:00:00Z' });
  const result = normalize(data, { eventId: 'propline:2' });
  assert.deepEqual(result.gameLog.map(row => row.gameId), ['3']);
});

test('identity and exact-market mismatches are rejected', () => {
  for (const mutate of [
    d => { d.history.player_name = 'Another player'; },
    d => { d.archive.player_name = 'Another player'; },
    d => { d.archive.sport_key = 'basketball_nba'; },
    d => { d.history.market = 'player_points'; },
    d => { d.history.player_id = '1'; d.archive.player_id = '2'; },
  ]) {
    const data = fixture(); mutate(data);
    assert.equal(normalize(data).available, false);
  }
});

test('unqualified, period and combo selections never borrow full-game platform results', () => {
  for (const extra of [{ providerMarketKey: 'player_fantasy_score' }, { period: 'h1' }, { playerName: 'A + B' }, { market: 'Fantasy Score (Combo)' }, { providerMarketKey: 'prizepicks:player_fantasy_score_1h' }]) {
    assert.equal(settledFantasySelection({ ...params, ...extra }), null);
  }
});

test('one shared adapter handles every exact catalog sport and keeps platforms separate', async () => {
  const pairs = [['WNBA', 'basketball_wnba'], ['NBA', 'basketball_nba'], ['NFL', 'football_nfl'], ['NCAAF', 'football_ncaaf'], ['NCAAB', 'basketball_ncaab'], ['MLB', 'baseball_mlb'], ['NHL', 'hockey_nhl'], ['TENNIS', 'tennis'], ['PGA', 'golf'], ['MMA', 'mma_ufc'], ['CRICKET', 'cricket'], ['AFL', 'aussie_rules_afl'], ['DARTS', 'darts'], ['CFL', 'football_cfl'], ['CYCLING', 'cycling'], ['SOCCER_LA_LIGA', 'soccer_la_liga'], ['ESPORTS', 'esports']];
  for (const [sport, sportKey] of pairs) for (const book of ['prizepicks', 'underdog']) {
    const data = fixture(sportKey, book), calls = [];
    const result = await fetchSettledFantasyResearch({ ...params, sport, providerMarketKey: `${book}:player_fantasy_score` }, {
      now: () => now,
      read: async (path, query) => {
        calls.push(path);
        if (path === '/v1/sports') return [{ key: sportKey }];
        assert.ok(path.startsWith(`/v1/sports/${sportKey}/players/Fixture%20Player/`));
        if (path.endsWith('/history')) { assert.equal(query.bookmaker, book); assert.equal(query.market, 'player_fantasy_score'); return data.history; }
        return data.archive;
      },
    });
    assert.equal(result.available, true, `${sport}/${book}`);
    assert.equal(result.fantasyScoring.platform, book);
    assert.ok(calls.length <= 3);
  }
});

test('ambiguous competitions, no settled data and transport failures have distinct outcomes', async () => {
  const ambiguous = await fetchSettledFantasyResearch({ ...params, sport: 'SOCCER' }, { read: async () => [{ key: 'soccer_epl' }, { key: 'soccer_mls' }] });
  assert.equal(ambiguous.code, 'FANTASY_SPORT_UNVERIFIED');
  const missing = await fetchSettledFantasyResearch(params, { read: async () => ({ entries: [] }) });
  assert.equal(missing.code, 'FANTASY_SETTLEMENT_UNAVAILABLE');
  const error = await fetchSettledFantasyResearch(params, { read: async () => { throw new Error('503'); } });
  assert.equal(error.retryable, true);
  assert.notEqual(error.lineOnly, true);
});

test('public research uses platform scores and recomputes hits at the current line', async () => {
  const { researchPlayerProp } = await import('../lib/autoscout/research-service-v2.mjs');
  const { __resetProplineClient } = await import('../lib/data-sources/propline/client.mjs');
  const data = fixture(), previousFetch = globalThis.fetch, previousKey = process.env.PROPLINE_API_KEY;
  process.env.PROPLINE_API_KEY = 'fixture-key'; __resetProplineClient();
  globalThis.fetch = async url => {
    const target = new URL(url);
    if (target.hostname === 'api.prop-line.com') {
      assert.ok(target.pathname.includes('/basketball_wnba/players/Fixture%20Player/'));
      const payload = target.pathname.endsWith('/history') ? data.history : data.archive;
      return new Response(JSON.stringify(payload), { status: 200 });
    }
    return new Response('{}', { status: 404 }); // Optional league directory.
  };
  try {
    // The old 15-point line was 1/3 over. A 30-point line must be 0/3,
    // proving old win/loss grades are not reused as current-line hit rates.
    const result = await researchPlayerProp({ ...params, line: 30, side: 'OVER' });
    assert.equal(result.available, true);
    assert.deepEqual(result.gameLog.map(row => row.value), [29.8, 0, -2.5]);
    assert.equal(result.windows.l5.hits, 0);
    assert.equal(result.windows.l5.games, 3);
    assert.equal(result.fantasyScoring.platform, 'prizepicks');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.PROPLINE_API_KEY; else process.env.PROPLINE_API_KEY = previousKey;
    __resetProplineClient();
  }
});

test('raw upstream and prefixed player IDs are validated against every returned identifier', () => {
  for (const requested of ['42','propline:42']) {
    const data = fixture(); data.archive.player_id = '42'; data.history.player_id = '42';
    assert.equal(normalize(data,{providerPlayerId:requested}).available,true);
    for (const target of [data.archive,data.history,data.archive.games[0],data.history.entries[0]]) {
      const previous=target.player_id; target.player_id='wrong';
      assert.equal(normalize(data,{providerPlayerId:requested}).available,false);
      if(previous===undefined)delete target.player_id; else target.player_id=previous;
    }
  }
});

test('reopened saved selections exclude their own event and later completed games', () => {
  const result=normalize(fixture(),{gameStartTime:'2026-09-17T00:00:00Z',eventId:'2'});
  assert.deepEqual(result.gameLog.map(row=>row.gameId),['3']);
});


test('a score settled after the selected event cutoff cannot enter its pre-game history', () => {
  const data=fixture();
  data.history.entries[0].resolved_at='2026-09-18T05:00:00Z';
  assert.equal(normalize(data,{gameStartTime:'2026-09-18T04:00:00Z'}).available,false);
});
