import test from 'node:test';
import assert from 'node:assert/strict';
import { createSportsDataIoAdapter, formatDate, UNSUPPORTED_LEAGUES } from '../lib/data-sources/sportsdataio.mjs';
import { registerProvider, resetProviders, providerStatus, PROVIDER_STATUS } from '../lib/data-sources/registry.mjs';
import { enrichProps } from '../lib/data-sources/enrich.mjs';
import { validateAdapter, enrichmentKey } from '../lib/data-sources/contract.mjs';
import { fromPickFinder } from '../lib/props/model.mjs';
import { applyPropFilters } from '../lib/filters/index.mjs';

const silent = { error: () => {} };
const KEY = 'test-key-not-a-real-credential';

function prop(overrides = {}) {
  return fromPickFinder({
    player: 'Alpha Beta', prop: 'Points', line: 25.5, sport: 'NBA', pick: 'OVER',
    opponent: 'PHX', matchId: 'NBA-1', l5: 80, l10: 78, l15: 76,
    regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true,
    filterAudit: [], ...overrides,
  });
}

// One NBA projection row shaped like SportsDataIO's PlayerGameProjection.
function nbaRow(overrides = {}) {
  return {
    Name: 'Alpha Beta', Team: 'LAL', Opponent: 'PHX', Position: 'PG', PlayerID: 1,
    DateTime: '2026-09-09T19:30:00', IsGameOver: false, Started: 1, Minutes: 34.2,
    Points: 29.1, Rebounds: 7.4, Assists: 6.2, Steals: 1.1, BlockedShots: 0.4, ThreePointersMade: 2.8,
    InjuryStatus: 'Probable', OpponentRank: 12, ...overrides,
  };
}

function fakeFetch(rows, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, headers: options?.headers || {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => rows,
    };
  };
  impl.calls = calls;
  return impl;
}

test.beforeEach(() => { resetProviders(); delete process.env.SPORTSDATAIO_API_KEY; });
test.after(() => { delete process.env.SPORTSDATAIO_API_KEY; });

test('the adapter satisfies the provider contract', () => {
  assert.deepEqual(validateAdapter(createSportsDataIoAdapter()), []);
});

test('dates are formatted the way SportsDataIO documents them', () => {
  assert.equal(formatDate(new Date('2026-09-09T12:00:00Z')), '2026-SEP-09');
  assert.equal(formatDate(new Date('2015-07-31T00:00:00Z')), '2015-JUL-31');
  assert.equal(formatDate(new Date('2026-01-05T00:00:00Z')), '2026-JAN-05');
});

test('the adapter is inactive until a key is present', () => {
  const adapter = createSportsDataIoAdapter();
  assert.equal(adapter.isConfigured(), false);
  process.env.SPORTSDATAIO_API_KEY = KEY;
  assert.equal(adapter.isConfigured(), true);
});

test('the API key travels in the documented header and never in the URL', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const fetchImpl = fakeFetch([nbaRow()]);
  const adapter = createSportsDataIoAdapter({ fetchImpl, now: () => new Date('2026-09-09T12:00:00Z') });
  await adapter.fetchEnrichment({ props: [prop()] });

  const [call] = fetchImpl.calls;
  assert.equal(call.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.ok(!call.url.includes(KEY), 'the key must never appear in the URL');
  assert.ok(call.url.startsWith('https://'), 'always TLS');
  assert.match(call.url, /\/v3\/nba\/projections\/json\/PlayerGameProjectionStatsByDate\/2026-SEP-09$/);
});

test('a projection is mapped from the market that was actually posted', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const adapter = createSportsDataIoAdapter({ fetchImpl: fakeFetch([nbaRow()]), now: () => new Date('2026-09-09T12:00:00Z') });

  const points = await adapter.fetchEnrichment({ props: [prop({ prop: 'Points' })] });
  assert.equal(points.get(enrichmentKey({ sport: 'NBA', playerName: 'Alpha Beta' })).projection, 29.1);

  const pra = await adapter.fetchEnrichment({ props: [prop({ prop: 'PRA' })] });
  assert.equal(pra.get(enrichmentKey({ sport: 'NBA', playerName: 'Alpha Beta' })).projection, 42.7, 'combo markets sum their parts');

  const threes = await adapter.fetchEnrichment({ props: [prop({ prop: 'Three Pointers' })] });
  assert.equal(threes.get(enrichmentKey({ sport: 'NBA', playerName: 'Alpha Beta' })).projection, 2.8);
});

test('an unmapped market yields no projection rather than a guess', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const adapter = createSportsDataIoAdapter({ fetchImpl: fakeFetch([nbaRow()]), now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await adapter.fetchEnrichment({ props: [prop({ prop: 'Double Doubles' })] });
  const row = result.get(enrichmentKey({ sport: 'NBA', playerName: 'Alpha Beta' }));
  assert.equal(row.projection, undefined, 'no projection field at all');
  assert.equal(row.expectedMinutes, 34.2, 'other enrichment still applies');
});

test('a combo market with a missing component yields no projection', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const adapter = createSportsDataIoAdapter({ fetchImpl: fakeFetch([nbaRow({ Assists: null })]), now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await adapter.fetchEnrichment({ props: [prop({ prop: 'PRA' })] });
  assert.equal(result.get(enrichmentKey({ sport: 'NBA', playerName: 'Alpha Beta' })).projection, undefined);
});

test('injury wording is normalised to the contract enum', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const cases = [['Probable', 'ACTIVE'], ['Questionable', 'QUESTIONABLE'], ['Out', 'OUT'], ['Doubtful', 'DOUBTFUL'], ['GTD', 'QUESTIONABLE'], ['', null], ['Scratched', null]];
  for (const [input, expected] of cases) {
    const adapter = createSportsDataIoAdapter({ fetchImpl: fakeFetch([nbaRow({ InjuryStatus: input })]), now: () => new Date('2026-09-09T12:00:00Z') });
    const result = await adapter.fetchEnrichment({ props: [prop()] });
    assert.equal(result.get(enrichmentKey({ sport: 'NBA', playerName: 'Alpha Beta' })).injuryStatus, expected, `for "${input}"`);
  }
});

test('NFL is addressed by season and week, not by date', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const fetchImpl = fakeFetch([{ Name: 'Quarter Back', Team: 'KC', Opponent: 'BUF', PassingYards: 271.5, DateTime: '2026-09-09T19:30:00' }]);
  const adapter = createSportsDataIoAdapter({ fetchImpl, nflSeason: '2026REG', nflWeek: 2 });
  const result = await adapter.fetchEnrichment({
    props: [prop({ player: 'Quarter Back', sport: 'NFL', prop: 'Passing Yards', opponent: 'BUF' })],
  });
  assert.match(fetchImpl.calls[0].url, /\/nfl\/projections\/json\/PlayerGameProjectionStatsByWeek\/2026REG\/2$/);
  assert.equal(result.get(enrichmentKey({ sport: 'NFL', playerName: 'Quarter Back' })).projection, 271.5);
});

test('NFL resolves its season and week from the scores feed automatically', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/CurrentSeason')) return { ok: true, status: 200, json: async () => 2026 };
    if (url.endsWith('/CurrentWeek')) return { ok: true, status: 200, json: async () => 3 };
    return { ok: true, status: 200, json: async () => [{ Name: 'Quarter Back', Team: 'KC', Opponent: 'BUF', PassingYards: 271.5 }] };
  };
  const adapter = createSportsDataIoAdapter({ fetchImpl });
  const result = await adapter.fetchEnrichment({
    props: [prop({ player: 'Quarter Back', sport: 'NFL', prop: 'Passing Yards', opponent: 'BUF' })],
  });

  assert.ok(calls.some((url) => url.endsWith('/nfl/scores/json/CurrentSeason')));
  assert.ok(calls.some((url) => url.endsWith('/nfl/scores/json/CurrentWeek')));
  assert.ok(calls.some((url) => url.endsWith('/PlayerGameProjectionStatsByWeek/2026/3')), 'the resolved values address the projections feed');
  assert.equal(result.get(enrichmentKey({ sport: 'NFL', playerName: 'Quarter Back' })).projection, 271.5);
});

test('NFL is skipped, never called with a guessed week, when resolution fails', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    // The scores scope is not in this subscription.
    return { ok: false, status: 403, json: async () => ({}) };
  };
  const adapter = createSportsDataIoAdapter({ fetchImpl });
  const result = await adapter.fetchEnrichment({ props: [prop({ sport: 'NFL', prop: 'Passing Yards' })] });

  assert.equal(result.size, 0);
  assert.ok(!calls.some((url) => url.includes('PlayerGameProjectionStatsByWeek')), 'no projections call with a guessed week');
});

test('leagues SportsDataIO cannot project are reported, not faked', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  const fetchImpl = fakeFetch([]);
  const adapter = createSportsDataIoAdapter({ fetchImpl });
  const props = [prop({ sport: 'WNBA' }), prop({ sport: 'NCAAB' }), prop({ sport: 'NCAAF' })];

  assert.deepEqual(adapter.unsupportedFor(props).sort(), ['NCAAB', 'NCAAF', 'WNBA']);
  const result = await adapter.fetchEnrichment({ props });
  assert.equal(fetchImpl.calls.length, 0, 'no pointless requests for unsupported leagues');
  assert.equal(result.size, 0);
  for (const league of ['WNBA', 'NCAAF', 'NCAAB']) assert.ok(UNSUPPORTED_LEAGUES.includes(league));
});

test('a rejected key marks the provider unavailable and leaks nothing', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  registerProvider(createSportsDataIoAdapter({ fetchImpl: fakeFetch([], { status: 401 }), now: () => new Date('2026-09-09T12:00:00Z') }));
  const { props, enrichedCount, providers } = await enrichProps([prop()], { log: silent });

  assert.equal(enrichedCount, 0);
  assert.equal(props[0].projection, null, 'no projection is invented when the provider is down');
  assert.equal(providers[0].status, PROVIDER_STATUS.UNAVAILABLE);
  const serialised = JSON.stringify(providerStatus());
  assert.ok(!serialised.includes(KEY), 'the key never reaches a status payload');
});

test('a same-name player in another game is rejected, not mis-joined', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  // The provider row is for a player facing DEN; our prop is against PHX.
  registerProvider(createSportsDataIoAdapter({
    fetchImpl: fakeFetch([nbaRow({ Opponent: 'DEN', Points: 99 })]),
    now: () => new Date('2026-09-09T12:00:00Z'),
  }));
  const { props, enrichedCount } = await enrichProps([prop({ opponent: 'PHX' })], { log: silent });
  assert.equal(enrichedCount, 0);
  assert.equal(props[0].projection, null, 'another game\'s projection must never attach');
});

test('end to end: a real projection lights up the projection-edge filter', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  registerProvider(createSportsDataIoAdapter({ fetchImpl: fakeFetch([nbaRow()]), now: () => new Date('2026-09-09T12:00:00Z') }));
  const { props } = await enrichProps([prop({ line: 25.5, prop: 'Points', pick: 'OVER' })], { log: silent });

  assert.equal(props[0].projection, 29.1);
  assert.equal(props[0].projectionSource, 'SportsDataIO');
  assert.equal(props[0].enrichedBy.projection, 'sportsdataio');
  assert.equal(props[0].expectedMinutes, 34.2);
  assert.equal(props[0].isStarter, true);
  assert.equal(props[0].injuryStatus, 'ACTIVE');
  assert.equal(props[0].opponentRank, 12);

  // Projection edge of +3.6 on an OVER.
  assert.equal(applyPropFilters(props, { minProjectionEdge: 3 }).length, 1);
  assert.equal(applyPropFilters(props, { minProjectionEdge: 5 }).length, 0);
  assert.equal(applyPropFilters(props, { startersOnly: true }).length, 1);
  assert.equal(applyPropFilters(props, { injuryStatuses: ['OUT'] }).length, 0);
  assert.equal(applyPropFilters(props, { minExpectedMinutes: 30 }).length, 1);
});

test('projection edge is read in the direction of an UNDER', async () => {
  process.env.SPORTSDATAIO_API_KEY = KEY;
  registerProvider(createSportsDataIoAdapter({ fetchImpl: fakeFetch([nbaRow({ Points: 20.0 })]), now: () => new Date('2026-09-09T12:00:00Z') }));
  const { props } = await enrichProps([prop({ line: 25.5, pick: 'UNDER' })], { log: silent });
  assert.equal(applyPropFilters(props, { minProjectionEdge: 5 }).length, 1, 'line 25.5 vs projection 20.0 is +5.5 for the under');
});
