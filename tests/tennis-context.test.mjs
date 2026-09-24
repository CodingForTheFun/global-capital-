import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTennisContext, memoryStore, personKey, parseRankings, resolveRanked, parseHandedness,
  parseSurface, surfaceFromInfo, parseSummaries, pairMatch,
} from '../lib/data-sources/sportradar/tennis-context.mjs';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const rankings = { rankings: [
  { name: 'ATP', type_id: 1, competitor_rankings: [
    { rank: 6, competitor: { id: 'sr:competitor:med', name: 'Medvedev, Daniil' } },
    { rank: 99, competitor: { id: 'sr:competitor:wal', name: 'Walton, Adam' } },
    { rank: 104, competitor: { id: 'sr:competitor:roy', name: 'Royer, Valentin' } },
    { rank: 151, competitor: { id: 'sr:competitor:mar', name: 'Martinez, Pedro' } },
  ] },
  { name: 'WTA', type_id: 2, competitor_rankings: [{ rank: 1, competitor: { id: 'sr:competitor:w1', name: 'Player, Top' } }] },
] };
const summary = (id, day, opponentId, opponentName, competition, status = 'closed') => ({
  sport_event: {
    id, start_time: `2026-09-${day}T15:00:00+00:00`,
    sport_event_context: { competition: { id: competition, name: 'Tournament' }, season: { id: competition + ':2026' } },
    competitors: [{ id: 'sr:competitor:med', name: 'Medvedev, Daniil', qualifier: 'home' }, { id: opponentId, name: opponentName, qualifier: 'away' }],
  },
  sport_event_status: { status },
});
const summaries = { summaries: [
  summary('sr:sport_event:1', '06', 'sr:competitor:tia', 'Tiafoe, Frances', 'sr:competition:usopen'),
  summary('sr:sport_event:2', '04', 'sr:competitor:rin', 'Rinderknech, Arthur', 'sr:competition:usopen'),
  summary('sr:sport_event:3', '16', 'sr:competitor:mar', 'Martinez, Pedro', 'sr:competition:clay'),
  summary('sr:sport_event:9', '27', 'sr:competitor:roy', 'Royer, Valentin', 'sr:competition:next', 'not_started'),
] };
const profiles = {
  'sr:competitor:tia': { competitor: { id: 'sr:competitor:tia' }, info: { handedness: 'right' } },
  'sr:competitor:rin': { competitor: { id: 'sr:competitor:rin' }, info: { handedness: 'right' } },
  'sr:competitor:mar': { competitor: { id: 'sr:competitor:mar' }, info: { handedness: 'left' } },
  'sr:competitor:roy': { competitor: { id: 'sr:competitor:roy' }, info: { handedness: 'right' } },
};
const infos = {
  'sr:competition:usopen': { competition: { id: 'sr:competition:usopen' }, info: { surface: 'hardcourt_outdoor' } },
  'sr:competition:clay': { competition: { id: 'sr:competition:clay' }, info: { surface: 'red_clay' } },
  'sr:competition:next': { competition: { id: 'sr:competition:next' }, info: { surface: 'hardcourt_indoor' } },
};
function fakeGet(calls) {
  return async (path) => {
    calls.push(path);
    if (path === '/rankings.json') return { ok: true, payload: rankings };
    let m = /^\/competitors\/([^/]+)\/summaries\.json$/.exec(path);
    if (m) return { ok: true, payload: decodeURIComponent(m[1]) === 'sr:competitor:med' ? summaries : { summaries: [] } };
    m = /^\/competitors\/([^/]+)\/profile\.json$/.exec(path);
    if (m) return { ok: true, payload: profiles[decodeURIComponent(m[1])] || {} };
    m = /^\/competitions\/([^/]+)\/info\.json$/.exec(path);
    if (m) return { ok: true, payload: infos[decodeURIComponent(m[1])] || {} };
    return { ok: false, code: 'NOT_FOUND' };
  };
}
const matches = [
  { id: 'p1', date: '2026-09-06T16:00:00Z', opponent: 'Frances Tiafoe' },
  { id: 'p2', date: '2026-09-04T13:00:00Z', opponent: 'Arthur Rinderknech' },
  { id: 'p3', date: '2026-09-16T15:00:00Z', opponent: 'Pedro Martinez' },
  { id: 'p4', date: '2026-08-10T15:00:00Z', opponent: 'Adam Walton' },
];

test('names, rankings, hands and surfaces parse from v3 shapes', () => {
  assert.equal(personKey('Medvedev, Daniil'), 'daniil medvedev');
  assert.equal(personKey('Martín Etcheverry, Tomás'), 'tomas martin etcheverry');
  const ranked = parseRankings(rankings);
  assert.equal(resolveRanked(ranked, 'Valentin Royer').rank, 104);
  assert.equal(resolveRanked(ranked, 'Unknown Player'), null);
  assert.equal(resolveRanked([...ranked, { id: 'x', key: 'valentin royer', rank: 5 }], 'Valentin Royer'), null, 'two ids for one name is ambiguous');
  assert.equal(parseHandedness({ info: { handedness: 'left' } }), 'L');
  assert.equal(parseHandedness({ info: { handedness: 'ambidextrous' } }), null);
  assert.deepEqual(parseSurface('hardcourt_indoor'), { surface: 'Hard', indoor: true });
  assert.deepEqual(parseSurface('red_clay'), { surface: 'Clay', indoor: null });
  assert.equal(parseSurface('unknown'), null);
  assert.deepEqual(surfaceFromInfo({ info: { surface: 'grass' } }), { surface: 'Grass', indoor: null });
});

test('a match pairs only on the same opponent within 36 hours', () => {
  const rows = parseSummaries(summaries, 'sr:competitor:med');
  assert.equal(pairMatch(rows, matches[0]).competitionId, 'sr:competition:usopen');
  assert.equal(pairMatch(rows, { date: '2026-09-09T15:00:00Z', opponent: 'Frances Tiafoe' }), null);
  assert.equal(pairMatch(rows, { date: '2026-09-06T15:00:00Z', opponent: 'Someone Else' }), null);
});

test('lookup joins ranks, hands and surfaces, and stores the permanent ones', async () => {
  const calls = [], store = memoryStore();
  const context = createTennisContext({ get: fakeGet(calls), available: () => true, store, now: () => NOW, dailyBudget: () => 30 });
  const result = await context.lookup({ player: 'Daniil Medvedev', opponent: 'Valentin Royer', matches });
  assert.equal(result.available, true);
  assert.equal(result.player.rank, 6);
  assert.deepEqual(result.matches.p1, { opponentRank: null, opponentHand: 'R', surface: 'Hard', indoor: false, paired: true });
  assert.deepEqual(result.matches.p3, { opponentRank: 151, opponentHand: 'L', surface: 'Clay', indoor: null, paired: true });
  assert.deepEqual(result.matches.p4, { opponentRank: 99, opponentHand: null, surface: null, indoor: null, paired: false });
  assert.deepEqual(result.upcoming, { opponentRank: 104, opponentHand: 'R', surface: 'Hard', indoor: true });
  assert.equal(result.complete, true);
  const firstCalls = calls.length;
  // Second lookup: hands and surfaces come from the store; rankings/summaries from caches.
  const again = await context.lookup({ player: 'Daniil Medvedev', opponent: 'Valentin Royer', matches });
  assert.deepEqual(again.matches, result.matches);
  assert.equal(calls.length, firstCalls, 'nothing is re-requested');
  assert.equal(store.load().hands['sr:competitor:mar'].v, 'L');
});

test('the daily budget stops provider reads and leaves unknowns pending', async () => {
  const calls = [];
  const context = createTennisContext({ get: fakeGet(calls), available: () => true, store: memoryStore(), now: () => NOW, dailyBudget: () => 3 });
  const result = await context.lookup({ player: 'Daniil Medvedev', opponent: 'Valentin Royer', matches });
  assert.equal(calls.length, 3);
  assert.equal(result.complete, false);
  assert.equal(result.coverage.budgetLeft, undefined, 'plan limits never reach the customer payload');
  assert.equal(context.stats().budgetLeft, 0);
});

test('an unavailable product makes no requests', async () => {
  const calls = [];
  const context = createTennisContext({ get: fakeGet(calls), available: () => false, store: memoryStore(), now: () => NOW });
  const result = await context.lookup({ player: 'Daniil Medvedev', matches });
  assert.equal(result.available, false);
  assert.equal(calls.length, 0);
});

test('without fill, past matches use stored answers only', async () => {
  const calls = [];
  const context = createTennisContext({ get: fakeGet(calls), available: () => true, store: memoryStore(), now: () => NOW, dailyBudget: () => 30 });
  const light = await context.lookup({ player: 'Daniil Medvedev', opponent: 'Valentin Royer', matches, fill: false });
  assert.deepEqual(calls, ['/rankings.json', '/competitors/sr%3Acompetitor%3Amed/summaries.json', '/competitors/sr%3Acompetitor%3Aroy/profile.json', '/competitions/sr%3Acompetition%3Anext/info.json']);
  assert.equal(light.matches.p1.opponentHand, null);
  assert.equal(light.complete, false);
  assert.equal(light.upcoming.opponentHand, 'R');
});
