import test from 'node:test';
import assert from 'node:assert/strict';
import { createSportsDataIoAdapter, PROJECTION_LEAGUES, UNCOVERED_LEAGUES, formatDate } from '../lib/data-sources/sportsdataio/index.mjs';
import { createClient, redact, resolveKey, isConfigured } from '../lib/data-sources/sportsdataio/client.mjs';
import { statFromRow, fieldsFor, marketKey } from '../lib/data-sources/sportsdataio/markets.mjs';
import { injuryStatus, liveStatus, indexDepthChart, indexLineups } from '../lib/data-sources/sportsdataio/normalize.mjs';
import { validateAdapter, enrichmentKey } from '../lib/data-sources/contract.mjs';
import { registerProvider, resetProviders, providerStatus, PROVIDER_STATUS } from '../lib/data-sources/registry.mjs';
import { enrichProps } from '../lib/data-sources/enrich.mjs';
import { fromPickFinder } from '../lib/props/model.mjs';
import { applyPropFilters, availableFilters } from '../lib/filters/index.mjs';

const silent = { error: () => {} };
const KEY = 'test-key-not-a-real-credential-abc123';

function prop(overrides = {}) {
  return fromPickFinder({
    player: 'Alpha Beta', prop: 'Points', line: 25.5, sport: 'NBA', pick: 'OVER',
    opponent: 'PHX', matchId: 'NBA-1', l5: 80, l10: 78, l15: 76,
    regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true,
    filterAudit: [], ...overrides,
  });
}

const PROJECTION_ROW = {
  Name: 'Alpha Beta', Team: 'LAL', Opponent: 'PHX', Position: 'PG', PlayerID: 1,
  DateTime: '2026-09-09T19:30:00', IsGameOver: false, Started: 1, Minutes: 34.2,
  Points: 29.1, Rebounds: 7.4, Assists: 6.2, ThreePointersMade: 2.8,
  InjuryStatus: 'Probable', OpponentRank: 12, OpponentPositionRank: 5,
};

/** Routes each feed URL to a canned payload; unrouted feeds 404. */
function router(routes = {}, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, headers: options?.headers || {} });
    for (const [fragment, payload] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        const value = typeof payload === 'function' ? payload() : payload;
        // A status is written as { __status: 403 }; anything else is a payload,
        // so a numeric payload like CurrentSeason: 2026 is not mistaken for one.
        if (value && typeof value === 'object' && '__status' in value) {
          return { ok: false, status: value.__status, headers: { get: () => '1' }, json: async () => ({}) };
        }
        return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => value };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

const NBA_OK = { 'PlayerGameProjectionStatsByDate': [PROJECTION_ROW] };

test.beforeEach(() => { resetProviders(); process.env.SPORTSDATAIO_API_KEY = KEY; });
test.after(() => { delete process.env.SPORTSDATAIO_API_KEY; });

test('the adapter satisfies the provider contract', () => {
  assert.deepEqual(validateAdapter(createSportsDataIoAdapter()), []);
});

test('the key is read only from the environment', () => {
  assert.equal(resolveKey('NBA'), KEY);
  process.env.SPORTSDATAIO_KEY_NBA = 'per-league-key-value';
  assert.equal(resolveKey('NBA'), 'per-league-key-value', 'a per-league key wins');
  assert.equal(resolveKey('MLB'), KEY, 'others fall back to the global key');
  delete process.env.SPORTSDATAIO_KEY_NBA;

  delete process.env.SPORTSDATAIO_API_KEY;
  assert.equal(isConfigured(), false);
  process.env.SPORTSDATAIO_API_KEY = KEY;
  assert.equal(isConfigured(), true);
});

test('the key travels in the documented header and never in a URL', async () => {
  const fetchImpl = router(NBA_OK);
  const adapter = createSportsDataIoAdapter({ fetchImpl, now: () => new Date('2026-09-09T12:00:00Z') });
  await adapter.fetchEnrichment({ props: [prop()] });

  assert.ok(fetchImpl.calls.length > 0);
  for (const call of fetchImpl.calls) {
    assert.equal(call.headers['Ocp-Apim-Subscription-Key'], KEY);
    assert.ok(!call.url.includes(KEY), `key leaked into URL: ${call.url}`);
    assert.ok(call.url.startsWith('https://'), 'always TLS');
  }
});

test('redact strips the key from any text before it can be logged', () => {
  assert.equal(redact(`failed with key ${KEY} attached`), 'failed with key [redacted] attached');
  process.env.SPORTSDATAIO_KEY_NHL = 'another-secret-value-here';
  assert.ok(!redact('used another-secret-value-here').includes('another-secret-value-here'));
  delete process.env.SPORTSDATAIO_KEY_NHL;
});

test('dates use the format SportsDataIO documents', () => {
  assert.equal(formatDate(new Date('2026-09-09T12:00:00Z')), '2026-SEP-09');
  assert.equal(formatDate(new Date('2015-07-31T00:00:00Z')), '2015-JUL-31');
});

test('markets map to real stat fields, including combos', () => {
  assert.equal(statFromRow('NBA', 'Points', PROJECTION_ROW), 29.1);
  assert.equal(statFromRow('NBA', 'PRA', PROJECTION_ROW), 42.7);
  assert.equal(statFromRow('NBA', 'Pts+Reb+Ast', PROJECTION_ROW), 42.7);
  assert.equal(statFromRow('NBA', 'Three Pointers', PROJECTION_ROW), 2.8);
  assert.equal(marketKey('Pts + Reb + Ast'), 'pts+reb+ast');
});

test('an unmapped market, or a combo missing a part, yields no projection', () => {
  assert.equal(statFromRow('NBA', 'Double Doubles', PROJECTION_ROW), null);
  assert.equal(fieldsFor('NBA', 'Double Doubles'), null);
  assert.equal(statFromRow('NBA', 'PRA', { ...PROJECTION_ROW, Assists: null }), null, 'a partial sum is never published');
  assert.equal(statFromRow('TENNIS', 'Games', PROJECTION_ROW), null);
});

test('injury and game-status wording normalise to fixed enums', () => {
  for (const [input, expected] of [['Probable', 'ACTIVE'], ['Questionable', 'QUESTIONABLE'], ['GTD', 'QUESTIONABLE'], ['Day-To-Day', 'QUESTIONABLE'], ['Out', 'OUT'], ['IR', 'OUT'], ['Doubtful', 'DOUBTFUL'], ['', null], ['Who knows', null]]) {
    assert.equal(injuryStatus(input), expected, `injury "${input}"`);
  }
  assert.equal(liveStatus({ Status: 'InProgress' }), 'LIVE');
  assert.equal(liveStatus({ Status: 'Final' }), 'FINAL');
  assert.equal(liveStatus({ Status: 'Scheduled' }), 'SCHEDULED');
  assert.equal(liveStatus({ IsGameOver: true }), 'FINAL');
  assert.equal(liveStatus({}), null, 'unknown status stays unknown');
});

test('depth charts and lineups are read from either payload shape', () => {
  const flat = indexDepthChart([{ Name: 'Alpha Beta', DepthOrder: 1, Position: 'PG' }]);
  assert.equal(flat.get('alpha beta').depthOrder, 1);
  const nested = indexDepthChart([{ Offense: [{ Name: 'Alpha Beta', DepthOrder: 2 }], Defense: [] }]);
  assert.equal(nested.get('alpha beta').depthOrder, 2);

  const lineups = indexLineups([{ Confirmed: true, HomeTeamLineup: [{ Name: 'Alpha Beta', BattingOrder: 3 }] }]);
  assert.equal(lineups.get('alpha beta').lineupStatus, 'CONFIRMED');
  assert.equal(indexLineups([{ Confirmed: false, Lineups: [{ Name: 'Alpha Beta' }] }]).get('alpha beta').lineupStatus, 'PROJECTED');
});

test('responses are cached so a repeat scan does not re-request', async () => {
  const fetchImpl = router(NBA_OK);
  const adapter = createSportsDataIoAdapter({ fetchImpl, now: () => new Date('2026-09-09T12:00:00Z') });
  await adapter.fetchEnrichment({ props: [prop()] });
  const first = fetchImpl.calls.length;
  await adapter.fetchEnrichment({ props: [prop()] });
  assert.equal(fetchImpl.calls.length, first, 'the second scan is served entirely from cache');
});

test('a rate limit backs off and serves cached data rather than failing', async () => {
  let payload = [PROJECTION_ROW];
  const fetchImpl = router({ 'PlayerGameProjectionStatsByDate': () => payload });
  const client = createClient({ fetchImpl });
  const adapter = createSportsDataIoAdapter({ client, now: () => new Date('2026-09-09T12:00:00Z') });

  const before = await adapter.fetchEnrichment({ props: [prop()] });
  assert.equal(before.get(enrichmentKey(prop())).projection, 29.1);

  payload = { __status: 429 };
  client.clearCache();
  const during = await enrichProps([prop()], { log: silent });
  assert.equal(during.enrichedCount, 0, 'no data is invented while rate limited');
});

test('one failing feed does not lose the others', async () => {
  // Projections succeed; injuries and depth charts 403 (not in the plan).
  const fetchImpl = router({
    'PlayerGameProjectionStatsByDate': [PROJECTION_ROW],
    'InjuredPlayers': { __status: 403 },
    'DepthCharts': { __status: 403 },
  });
  const adapter = createSportsDataIoAdapter({ fetchImpl, now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await adapter.fetchEnrichment({ props: [prop()] });
  const row = result.get(enrichmentKey(prop()));

  assert.equal(row.projection, 29.1, 'the feed that worked still applies');
  assert.equal(row.expectedMinutes, 34.2);
  assert.equal(row.depthChartOrder, undefined, 'the feed that failed contributes nothing');
});

test('a total outage leaves props un-enriched and marks the provider unavailable', async () => {
  registerProvider(createSportsDataIoAdapter({ fetchImpl: router({}, { status: 500 }), now: () => new Date('2026-09-09T12:00:00Z'), log: silent }));
  const { props, enrichedCount, providers } = await enrichProps([prop()], { log: silent });

  assert.equal(enrichedCount, 0);
  assert.equal(props[0].projection, null, 'nothing is invented during an outage');
  assert.equal(props[0].line, 25.5, 'the PickFinder prop is untouched and still usable');
  assert.equal(providers[0].status, PROVIDER_STATUS.UNAVAILABLE);
  assert.ok(!JSON.stringify(providers).includes(KEY));
});

test('NFL resolves its own season and week', async () => {
  const fetchImpl = router({
    'CurrentSeason': 2026,
    'CurrentWeek': 2,
    'PlayerGameProjectionStatsByWeek': [{ Name: 'Quarter Back', Team: 'KC', Opponent: 'BUF', PassingYards: 271.5, DateTime: '2026-09-09T19:30:00' }],
  });
  const adapter = createSportsDataIoAdapter({ fetchImpl });
  const result = await adapter.fetchEnrichment({
    props: [prop({ player: 'Quarter Back', sport: 'NFL', prop: 'Passing Yards', opponent: 'BUF' })],
  });
  assert.ok(fetchImpl.calls.some((c) => c.url.endsWith('/PlayerGameProjectionStatsByWeek/2026/2')));
  assert.equal(result.get(enrichmentKey({ sport: 'NFL', playerName: 'Quarter Back' })).projection, 271.5);
});

test('NFL is never called with a guessed week when the timeframe is unavailable', async () => {
  const fetchImpl = router({ 'CurrentSeason': { __status: 403 }, 'CurrentWeek': { __status: 403 } });
  registerProvider(createSportsDataIoAdapter({ fetchImpl, log: silent }));
  const { props, enrichedCount, providers } = await enrichProps(
    [prop({ sport: 'NFL', prop: 'Passing Yards' })],
    { log: silent },
  );

  // The important guarantee: no request is made against a week we do not know.
  assert.ok(!fetchImpl.calls.some((c) => c.url.includes('PlayerGameProjectionStatsByWeek')));
  // And the failure surfaces as provider status rather than as bad data.
  assert.equal(enrichedCount, 0);
  assert.equal(props[0].projection, null);
  assert.equal(providers[0].status, PROVIDER_STATUS.UNAVAILABLE);
});

test('leagues with no SportsDataIO feed are skipped, not called', async () => {
  const fetchImpl = router(NBA_OK);
  const adapter = createSportsDataIoAdapter({ fetchImpl });
  const props = [prop({ sport: 'TENNIS' }), prop({ sport: 'VAL' })];
  assert.deepEqual(adapter.unsupportedFor(props).sort(), ['TENNIS', 'VAL']);
  const result = await adapter.fetchEnrichment({ props });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(result.size, 0);
  for (const league of ['TENNIS', 'VAL', 'DOTA2', 'COD']) assert.ok(UNCOVERED_LEAGUES.includes(league));
  assert.deepEqual([...PROJECTION_LEAGUES].sort(), ['MLB', 'NBA', 'NFL', 'NHL']);
});

test('WNBA and NCAA get intelligence feeds but never a projection', async () => {
  const fetchImpl = router({
    'GamesByDate': [{ HomeTeam: 'LV', AwayTeam: 'PHX', Status: 'Scheduled', DateTime: '2026-09-09T19:00:00' }],
    'PlayerGameStatsByDate': [{ Name: 'Alpha Beta', Team: 'LV', Opponent: 'PHX', Points: 18, Minutes: 30 }],
  });
  const adapter = createSportsDataIoAdapter({ fetchImpl, now: () => new Date('2026-09-09T12:00:00Z') });
  const result = await adapter.fetchEnrichment({ props: [prop({ sport: 'WNBA' })] });
  const row = result.get(enrichmentKey({ sport: 'WNBA', playerName: 'Alpha Beta' }));

  assert.ok(row, 'WNBA still gets enrichment');
  assert.equal(row.projection, undefined, 'but never a projection, because none is sold');
  assert.equal(row.actualMinutes, 30);
  assert.ok(!fetchImpl.calls.some((c) => c.url.includes('/projections/')), 'the projections feed is not even called');
});

test('end to end: full intelligence reaches the prop and activates its filters', async () => {
  registerProvider(createSportsDataIoAdapter({
    fetchImpl: router({
      'PlayerGameProjectionStatsByDate': [PROJECTION_ROW],
      'InjuredPlayers': [{ Name: 'Alpha Beta', Status: 'Questionable', BodyPart: 'Ankle' }],
      'GamesByDate': [{ HomeTeam: 'LAL', AwayTeam: 'PHX', Status: 'Scheduled', DateTime: '2026-09-09T19:30:00' }],
      'PlayerGameStatsByDate': [{ Name: 'Alpha Beta', Team: 'LAL', Opponent: 'PHX', Points: 12, Minutes: 18 }],
      'PlayerSeasonStats': [{ Name: 'Alpha Beta', Team: 'LAL', Points: 1400, Games: 70 }],
      'DepthCharts': [{ Name: 'Alpha Beta', DepthOrder: 1, Position: 'PG' }],
    }),
    now: () => new Date('2026-09-09T12:00:00Z'),
  }));
  const { props } = await enrichProps([prop()], { log: silent });
  const [p] = props;

  assert.equal(p.projection, 29.1);
  assert.equal(p.projectionSource, 'SportsDataIO');
  assert.equal(p.expectedMinutes, 34.2);
  assert.equal(p.actualMinutes, 18, 'in-play minutes');
  assert.equal(p.liveStat, 12, 'in-play value for this prop\'s own market');
  assert.equal(p.seasonAverage, 20, '1400 points over 70 games');
  assert.equal(p.injuryStatus, 'QUESTIONABLE');
  assert.equal(p.injuryDetail, 'Ankle');
  assert.equal(p.depthChartOrder, 1);
  assert.equal(p.opponentRank, 12);
  assert.equal(p.liveStatus, 'SCHEDULED');
  assert.equal(p.enrichedBy.projection, 'sportsdataio');

  // Every one of these filters was inapplicable before enrichment.
  assert.equal(applyPropFilters(props, { minProjectionEdge: 3 }).length, 1);
  assert.equal(applyPropFilters(props, { minProjectionEdge: 5 }).length, 0);
  assert.equal(applyPropFilters(props, { startersByDepthChart: true }).length, 1);
  assert.equal(applyPropFilters(props, { excludeInjured: true }).length, 1, 'questionable is shown, not excluded');
  assert.equal(applyPropFilters(props, { injuryStatuses: ['OUT'] }).length, 0);
  assert.equal(applyPropFilters(props, { minExpectedMinutes: 30 }).length, 1);
  assert.equal(applyPropFilters(props, { liveStatuses: ['SCHEDULED'] }).length, 1);
  for (const id of ['minProjectionEdge', 'startersByDepthChart', 'excludeInjured', 'minExpectedMinutes']) {
    assert.ok(availableFilters(props).includes(id), `${id} should now be offered`);
  }
});

test('an out player is excluded when the user asks to exclude injuries', async () => {
  registerProvider(createSportsDataIoAdapter({
    fetchImpl: router({
      'PlayerGameProjectionStatsByDate': [PROJECTION_ROW],
      'InjuredPlayers': [{ Name: 'Alpha Beta', Status: 'Out', BodyPart: 'Knee' }],
    }),
    now: () => new Date('2026-09-09T12:00:00Z'),
  }));
  const { props } = await enrichProps([prop()], { log: silent });
  assert.equal(props[0].injuryStatus, 'OUT');
  assert.equal(applyPropFilters(props, { excludeInjured: true }).length, 0);
});
