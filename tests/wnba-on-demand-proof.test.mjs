import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProofEvent, selectProofPlayer, evaluateProof, createProofTransport, runWnbaProof, PROOF_LIMITS } from '../lib/diagnostics/wnba-on-demand-proof.mjs';
// Deliberately artificial UNIT fixtures. These are NOT a captured September 17 game,
// a real player, production evidence, or a history seed/backfill.
const date = '2026-09-17', now = () => Date.parse('2026-09-18T12:00:00Z');
const expected = { eventId: '900000001', athleteId: '900000002', playerName: 'Unit Fixture',
  teamId: '901', team: 'TST', opponentId: '902', opponent: 'OPP', date: '2026-09-18T02:00:00Z',
  season: '2026', seasonType: 2, minutes: 30, points: 0 };
const competitors = [{ team: { id: '901', abbreviation: 'TST' } }, { team: { id: '902', abbreviation: 'OPP' } }];
const competition = { id: expected.eventId, date: expected.date, status: { type: { state: 'post', completed: true } }, competitors };
const event = { id: expected.eventId, date: expected.date, season: { type: 2, year: 2026 }, competitions: [competition] };
const board = () => structuredClone({ leagues: [{ slug: 'wnba' }], events: [event] });
const summary = () => structuredClone({ header: { id: expected.eventId, league: { slug: 'wnba' }, competitions: [competition] },
  boxscore: { players: [{ team: { id: '901' }, statistics: [{ labels: ['MIN', 'PTS'],
    athletes: [{ athlete: { id: expected.athleteId, displayName: expected.playerName }, stats: ['30:00', '0'] }] }] }] } });
const history = () => structuredClone({ available: true, entityType: 'player', statKind: 'Points', season: '2026', coverage: { seasonComplete: true },
  player: { providerPlayerId: `history:WNBA:${expected.athleteId}`, sport: 'WNBA' },
  gameLog: [{ gameId: `wnba:${expected.eventId}`, teamId: 'WNBA:901', opponentId: 'WNBA:902', date: expected.date,
    season: '2026', seasonType: 2, minutes: 30, statKind: 'Points', value: 0, points: 0 }] });
const providerFactory = output => ({ fetchImpl }) => async params => {
  assert.deepEqual(params, { sport: 'WNBA', playerName: 'Unit Fixture', team: 'TST', market: 'Points', providerMarketKey: 'player_points', games: 15 });
  await fetchImpl(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${expected.athleteId}/gamelog`);
  return output;
};
const network = async url => new Response(JSON.stringify(url.includes('/summary') ? summary() : url.includes('/gamelog') ? {} : board()));

test('UTC September 18 game belongs to the completed September 17 Eastern slate', () => {
  assert.equal(selectProofEvent(board(), { date, now: now() }).id, expected.eventId);
  assert.deepEqual(selectProofPlayer(summary(), event), expected);
});
test('reject wrong league, incomplete/future/wrong-date/wrong-season and absent explicit event', () => {
  for (const mutate of [b => b.leagues[0].slug = 'nba', b => b.events[0].competitions[0].status.type.completed = false,
    b => b.events[0].date = '2026-09-19T02:00:00Z', b => b.events[0].season.type = 1, b => b.events[0].season.year = 2025]) {
    const b = board(); mutate(b); assert.throws(() => selectProofEvent(b, { date, now: now() }));
  }
  assert.throws(() => selectProofEvent(board(), { date, now: 0 }));
  assert.throws(() => selectProofEvent(board(), { date, now: now(), eventId: '111' }));
});
test('reject unverified summary league, event, teams, completion and date', () => {
  for (const mutate of [s => s.header.league.slug = 'nba', s => s.header.id = '111',
    s => s.header.competitions[0].competitors[0].team.id = '999',
    s => s.header.competitions[0].status.type.state = 'in', s => s.header.competitions[0].date = '2026-09-17T01:00:00Z']) {
    const s = summary(); mutate(s); assert.throws(() => selectProofPlayer(s, event));
  }
});
test('DNP, inactive, zero/unknown minutes, missing points and unverified athlete fail closed', () => {
  for (const mutate of [r => r.didNotPlay = true, r => r.active = false, r => r.stats[0] = '0:00',
    r => r.stats[0] = 'DNP', r => r.stats[1] = '', r => r.stats[1] = null, r => r.athlete.id = 'unknown']) {
    const s = summary(); mutate(s.boxscore.players[0].statistics[0].athletes[0]);
    assert.throws(() => selectProofPlayer(s, event));
  }
  assert.throws(() => selectProofPlayer(summary(), event, { athleteId: '111' }));
});
test('exact identity and event with genuine zero points pass, never require a fabricated prop line', () => {
  assert.deepEqual(evaluateProof(history(), expected), { status: 'HEALTHY', code: 'VERIFIED_GAME_RETURNED', providerCode: null });
});
test('stale persisted-row age is not an input or pass criterion', async () => {
  const r = await runWnbaProof({ now, createResearch: providerFactory(history()), fetchImpl: network });
  assert.equal(r.status, 'HEALTHY'); assert.equal(r.networkRequests, 3); assert.equal(r.readOnly, true);
  assert.ok(!JSON.stringify(r).includes('player_game_logs'));
});
test('successful current-season history missing the exact event is FAILING, not HEALTHY from max date', () => {
  const h = history(); h.gameLog[0].gameId = 'wnba:another';
  assert.equal(evaluateProof(h, expected).status, 'FAILING');
  assert.equal(evaluateProof(h, expected).code, 'VERIFIED_GAME_NOT_RETURNED');
});
test('incomplete coverage or wrong current season cannot establish a definitive omission', () => {
  const h = history(); h.gameLog = []; h.coverage.seasonComplete = false;
  assert.equal(evaluateProof(h, expected).status, 'UNVERIFIABLE');
  h.coverage.seasonComplete = true; h.season = '2025';
  assert.equal(evaluateProof(h, expected).status, 'UNVERIFIABLE');
});
test('wrong identity, team, opponent, date, season, market value and duplicates never pass', () => {
  for (const mutate of [h => h.player.providerPlayerId = 'history:WNBA:111', h => h.gameLog[0].teamId = 'WNBA:999',
    h => h.gameLog[0].opponentId = 'WNBA:999', h => h.gameLog[0].date = '2026-09-17T02:00:00Z',
    h => h.gameLog[0].season = '2025', h => h.gameLog[0].value = 10, h => h.gameLog.push(h.gameLog[0])]) {
    const h = history(); mutate(h); assert.equal(evaluateProof(h, expected).status, 'FAILING');
  }
});
test('retain exact fail-closed code without provider messages or secrets', () => {
  const r = evaluateProof({ available: false, code: 'RESEARCH_PROVIDER_ERROR', message: 'secret' }, expected);
  assert.equal(r.status, 'UNVERIFIABLE'); assert.equal(r.providerCode, 'RESEARCH_PROVIDER_ERROR');
  assert.ok(!JSON.stringify(r).includes('secret'));
});
const transport = (fetchImpl = network, limits = PROOF_LIMITS) => {
  const t = createProofTransport({ date, fetchImpl, signal: new AbortController().signal, limits });
  t.selectEvent(expected.eventId); t.selectPlayer(expected); return t;
};
test('reject DB hosts, POST, credentials, unknown athlete, other sport and other player without HTTP', async () => {
  let calls = 0; const t = transport(async () => { calls++; return new Response('{}'); });
  const valid = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${expected.athleteId}/gamelog`;
  for (const [url, init] of [['https://example.supabase.co/rest/v1/player_game_logs', {}], [valid, { method: 'POST' }],
    [valid, { headers: { Authorization: 'secret' } }], [valid.replace(expected.athleteId, '111'), {}],
    [valid.replace('/wnba/', '/nba/'), {}],
    ['https://site.web.api.espn.com/apis/search/v2?query=another&sport=basketball', {}]]) await assert.rejects(t.fetch(url, init));
  assert.equal(calls, 0);
});
test('prior-season reads and repeats are blocked; HTTP budget is capped', async () => {
  let calls = 0; const t = transport(async () => { calls++; return new Response('{}'); }, { ...PROOF_LIMITS, requests: 1 });
  const root = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${expected.athleteId}/gamelog`;
  await assert.rejects(t.fetch(`${root}?season=2025`), { proofCode: 'PRIOR_SEASON_READ_BLOCKED' });
  await t.fetch(root);
  await assert.rejects(t.fetch(`${root}?season=2026`), { proofCode: 'REQUEST_BUDGET_EXCEEDED' });
  const repeat = transport(); await repeat.fetch(root);
  await assert.rejects(repeat.fetch(root), { proofCode: 'REPEATED_REQUEST_BLOCKED' });
  assert.equal(calls, 1);
});
test('429, malformed JSON and oversized response stay UNVERIFIABLE; no retries', async () => {
  for (const response of [() => new Response('', { status: 429 }), () => new Response('oops'), () => new Response('x'.repeat(101))]) {
    let calls = 0;
    const r = await runWnbaProof({ now, createResearch: providerFactory(history()), limits: { ...PROOF_LIMITS, bytes: 100 },
      fetchImpl: async () => { calls++; return response(); } });
    assert.equal(r.status, 'UNVERIFIABLE'); assert.equal(calls, 1);
  }
});
test('DNS/network failure is sanitized and cannot masquerade as stale history', async () => {
  const r = await runWnbaProof({ now, createResearch: providerFactory(history()), fetchImpl: async () => { throw new Error('secret hostname'); } });
  assert.equal(r.status, 'UNVERIFIABLE'); assert.equal(r.code, 'UPSTREAM_NETWORK_ERROR');
  assert.ok(!JSON.stringify(r).includes('secret'));
});
test('whole-probe deadline bounds an uncooperative research promise', async () => {
  const r = await runWnbaProof({ now, createResearch: () => () => new Promise(() => {}), fetchImpl: network,
    limits: { ...PROOF_LIMITS, totalMs: 20 } });
  assert.equal(r.status, 'UNVERIFIABLE'); assert.equal(r.code, 'PROBE_DEADLINE');
});
test('invalid input requires zero requests', async () => {
  let calls = 0;
  const r = await runWnbaProof({ date: '2026-02-31', now, createResearch: providerFactory(history()), fetchImpl: async () => { calls++; } });
  assert.equal(r.code, 'INVALID_PROBE_ARGUMENTS'); assert.equal(calls, 0);
});
