import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlateCoverage, coverageRequestBudget, boundedCoverageCall, sportRefreshDelaySeconds } from '../lib/data-sources/propline/slate-coverage.mjs';
import { fetchBoard, __resetProplineProvider } from '../lib/autoscout/providers/propline.mjs';
import { __resetProplineClient, proplineQuota } from '../lib/data-sources/propline/client.mjs';
import { maybeRefreshProplineSupplement, proplineSupplementHealth, mergeCachedPropline, __resetProplineSupplement } from '../lib/ingestion/propline-supplement.mjs';

// All event/player rows below are synthetic test fixtures, never production data.
const events = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));
const part = (id, stamp = 'fixture') => ({ events: [{ id }], players: [], props: [], lines: [{ id, stamp }] });
const empty = () => ({ events: [], players: [], props: [], lines: [] });

test('large accounts receive a bounded upper budget, never a target or permission to spend the reserve', () => {
  const now = Date.parse('2026-09-19T00:00:00Z');
  const quota = { limit: 250000, remaining: 249000, resetAt: '2026-09-20T00:00:00Z' };
  assert.equal(coverageRequestBudget(quota, { now }), 384);
  assert.equal(coverageRequestBudget({ ...quota, remaining: 25000 }, { now }), 0);
  assert.equal(coverageRequestBudget({ ...quota, remaining: 20000 }, { now }), 0);
  assert.equal(coverageRequestBudget(quota, { now, reserve: 249000 }), 0);
  for (const remaining of [null, undefined, '', false, NaN]) assert.equal(coverageRequestBudget({ ...quota, remaining }, { now }), 0);
  for (const limit of [1000, 5000, 25000, null]) assert.equal(coverageRequestBudget({ ...quota, limit }, { now }), 0);
  assert.equal(coverageRequestBudget({ ...quota, resetAt: new Date(now).toISOString() }, { now }), 0);
  assert.equal(coverageRequestBudget({ ...quota, resetAt: null }, { now }), 0);
  assert.ok(coverageRequestBudget({ ...quota, remaining: 50000 }, { now }) < 100);
});

test('a multi-sport pass no longer applies a single-sport rotation delay', () => {
  assert.equal(sportRefreshDelaySeconds({ intervalSeconds: 60, sportsPerCycle: 16 }, 8), 60);
  assert.equal(sportRefreshDelaySeconds({ intervalSeconds: 60, sportsPerCycle: 16 }, 32), 120);
});

test('91 eligible events are collected when affordable; duplicates never spend another slot', async () => {
  const sweep = createSlateCoverage();
  const calls = [];
  const result = await sweep.collect({ scope: 'NCAAF|regular', events: [...events(91), ...events(10)], requestBudget: 128, fetchEvent: async e => { calls.push(e.id); return part(e.id); } });
  assert.equal(calls.length, 91);
  assert.equal(new Set(calls).size, 91);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.eligible, 91);
  assert.equal(result.parts.length, 91);
});

test('later events rotate in instead of permanently losing to the first 24; retained ages do not advance', async () => {
  let now = Date.parse('2026-09-19T00:00:00Z');
  const sweep = createSlateCoverage({ now: () => now });
  const collect = () => sweep.collect({ scope: 'NFL|regular', events: events(48), requestBudget: 24, fetchEvent: async e => part(e.id, new Date(now).toISOString()) });
  const first = await collect();
  now += 300000;
  const second = await collect();
  assert.equal(first.coverage.deferred, 24);
  assert.equal(second.parts.length, 48);
  assert.equal(second.coverage.covered, 48);
  assert.equal(second.coverage.retained, 24);
  assert.equal(second.coverage.complete, false); // Not all observations were refreshed this pass.
  assert.equal(second.coverage.oldestFetchedAt, first.coverage.oldestFetchedAt);
  assert.equal(second.parts[0], first.parts[0]);
  assert.equal(second.parts[24].events[0].id, '25');
  now += 300000;
  const third = await collect();
  assert.notEqual(third.parts[0], first.parts[0]);
  assert.equal(third.parts[24], second.parts[24]);
});

test('empty successful event snapshots withdraw old prices; disappeared events are removed', async () => {
  const sweep = createSlateCoverage();
  await sweep.collect({ scope: 'MLB', events: events(2), fetchEvent: async e => part(e.id) });
  const changed = await sweep.collect({ scope: 'MLB', events: events(1), fetchEvent: async () => empty() });
  assert.equal(changed.parts.flatMap(p => p.lines).length, 0);
  assert.equal(changed.coverage.eligible, 1);
  assert.equal(changed.coverage.complete, true);
  const removed = await sweep.collect({ scope: 'MLB', events: [], fetchEvent: async () => assert.fail('no request') });
  assert.equal(removed.parts.length, 0);
});

test('failure preserves the last-good snapshot only inside its original retention age', async () => {
  let now = 1000000;
  const sweep = createSlateCoverage({ now: () => now });
  const request = { scope: 'WNBA', events: events(1), maxAgeSeconds: 60 };
  const first = await sweep.collect({ ...request, fetchEvent: async () => part('1', 'original') });
  now += 10000;
  const failing = async () => { throw Object.assign(new Error('private diagnostic must not leak'), { code: 'PROPLINE_HTTP_503' }); };
  const retained = await sweep.collect({ ...request, fetchEvent: failing });
  assert.equal(retained.parts[0], first.parts[0]);
  assert.equal(retained.coverage.oldestFetchedAt, first.coverage.oldestFetchedAt);
  assert.equal(retained.coverage.retained, 1);
  assert.equal(retained.coverage.complete, false);
  assert.ok(!JSON.stringify(retained).includes('private diagnostic'));
  now += 50000;
  const expired = await sweep.collect({ ...request, fetchEvent: failing });
  assert.equal(expired.parts.length, 0);
  assert.equal(expired.coverage.oldestFetchedAt, null);
});

test('sport, market, book and regular/alternate scope changes cannot borrow cached snapshots', async () => {
  const sweep = createSlateCoverage();
  await sweep.collect({ scope: 'NFL|points|book-a|regular', events: events(1), fetchEvent: async () => part('1') });
  for (const scope of ['WNBA|points|book-a|regular', 'NFL|yards|book-a|regular', 'NFL|points|book-b|regular', 'NFL|points|book-a|alts']) {
    const result = await sweep.collect({ scope, events: events(1), requestBudget: 0, fetchEvent: async () => assert.fail('zero budget') });
    assert.equal(result.parts.length, 0);
    assert.equal(result.coverage.complete, false);
  }
});

test('rate limiting, exhausted reserve and unauthorized responses stop the remainder', async () => {
  for (const code of ['PROPLINE_RATE_LIMITED','PROPLINE_QUOTA_RESERVE','PROPLINE_UNAUTHORIZED']) {
    let calls = 0;
    const result = await createSlateCoverage().collect({ scope: code, events: events(10), fetchEvent: async () => { calls++; throw Object.assign(new Error(), { code }); } });
    assert.equal(calls, 1);
    assert.equal(result.coverage.deferred, 9);
    assert.equal(result.coverage.reason, code);
  }
});

test('a transport ignoring abort cannot wedge the sweep or publish late state', async () => {
  const sweep = createSlateCoverage();
  let resolve;
  const result = await sweep.collect({ scope: 'deadline', events: events(2), durationMs: 20, fetchEvent: () => new Promise(done => { resolve = done; }) });
  assert.equal(result.coverage.reason, 'PROPLINE_COVERAGE_DEADLINE');
  assert.equal(result.coverage.requested, 1);
  resolve(part('late'));
  await new Promise(done => setTimeout(done, 1));
  const later = await sweep.collect({ scope: 'deadline', events: events(2), requestBudget: 0, fetchEvent: async () => assert.fail('no fetch') });
  assert.equal(later.parts.length, 0);
});

test('parent cancellation fails before a call; malformed results never become valid empty snapshots', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(boundedCoverageCall(() => assert.fail('aborted'), { signal: controller.signal }), { code: 'PROPLINE_COVERAGE_ABORTED' });
  const result = await createSlateCoverage().collect({ scope: 'bad', events: events(1), fetchEvent: async () => null });
  assert.equal(result.coverage.failed, 1);
  assert.equal(result.coverage.complete, false);
});

async function withProviderFixture(run) {
  const saved = Object.fromEntries(['PROPLINE_API_KEY','PROPLINE_SUPPLEMENT_ENABLED','PROPLINE_SUPPLEMENT_SPORTS','PROPLINE_RESERVE_PERCENT'].map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  __resetProplineProvider(); __resetProplineSupplement();
  process.env.PROPLINE_API_KEY = 'synthetic-slate-test-key';
  process.env.PROPLINE_SUPPLEMENT_ENABLED = 'true';
  process.env.PROPLINE_SUPPLEMENT_SPORTS = 'NCAAF';
  process.env.PROPLINE_RESERVE_PERCENT = '10';
  let remaining = 249000;
  const calls = [], fixture = { count: 32, empty: false, malformed: false, throttle: false };
  const kickoff = new Date(Date.now() + 3600000).toISOString();
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname; calls.push(path); remaining--;
    assert.equal(options.headers['x-api-key'], 'synthetic-slate-test-key');
    assert.ok(!String(url).includes('synthetic-slate-test-key'));
    const headers = { 'x-daily-limit': '250000', 'x-daily-remaining': String(remaining), 'x-daily-used': String(250000 - remaining), 'x-daily-reset': String(Math.floor((Date.now() + 86400000) / 1000)) };
    if (path === '/v1/sports') return new Response(JSON.stringify([{ key: 'football_ncaaf', active: true }]), { headers });
    if (path.endsWith('/events')) return new Response(JSON.stringify(events(fixture.count).map(e => ({ ...e, sport_key: 'football_ncaaf', commence_time: kickoff, home_team: 'Fixture Home', away_team: 'Fixture Away' }))), { headers });
    assert.ok(path.endsWith('/odds'));
    if (fixture.throttle) return new Response(JSON.stringify({ error: 'burst_limit_exceeded' }), { status: 429, headers: { ...headers, 'retry-after': '60' } });
    const id = path.split('/').at(-2);
    const params = new URL(url).searchParams;
    assert.ok(params.get('markets').includes('player_pass_yds'));
    const body = { id, sport_key: 'football_ncaaf', commence_time: kickoff, bookmakers: fixture.empty ? [] : [{ key: 'draftkings', last_update: new Date().toISOString(), markets: [{ key: 'player_pass_yds', outcomes: ['Over','Under'].map(name => ({ name, description: `Fixture Player ${id}`, player_id: `fixture:${id}`, point: 100.5, price: -110 })) }] }] };
    return new Response(JSON.stringify(fixture.malformed ? {} : body), { headers });
  };
  try { await run({ calls, fixture }); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
    __resetProplineProvider(); __resetProplineSupplement();
  }
}

test('actual provider reaches beyond 24 and coalesces concurrent full-slate requests; cache-only stays zero-network', async () => withProviderFixture(async ({ calls }) => {
  const boards = await Promise.all(Array.from({ length: 8 }, () => fetchBoard('NCAAF', { fullSlate: true, force: true, requestBudget: 129 })));
  assert.equal(calls.length, 33);
  assert.equal(boards[0].meta.coverage.complete, true);
  assert.equal(boards[0].meta.events, 32);
  assert.equal(boards[0].props.length, 64);
  assert.ok(boards[0].props.some(row => row.providerEventId === '32'));
  assert.equal(new Set(boards[0].props.map(row => row.id)).size, 64);
  const before = calls.length;
  await fetchBoard('NCAAF', { fullSlate: true, cacheOnly: true });
  await fetchBoard('NFL', { cacheOnly: true });
  assert.equal(calls.length, before);
}));

test('actual provider keeps malformed/429 fallback observations old, and successful empty data withdraws quotes', async () => withProviderFixture(async ({ fixture }) => {
  fixture.count = 2;
  const opts = { fullSlate: true, force: true, requestBudget: 129 };
  const first = await fetchBoard('NCAAF', opts);
  __resetProplineClient(); fixture.malformed = true;
  const invalid = await fetchBoard('NCAAF', opts);
  assert.equal(invalid.meta.coverage.complete, false);
  assert.equal(invalid.meta.coverage.retained, 2);
  assert.equal(invalid.meta.fetchedAt, first.meta.fetchedAt);
  __resetProplineClient(); fixture.malformed = false; fixture.empty = true;
  const emptyBoard = await fetchBoard('NCAAF', opts);
  assert.equal(emptyBoard.props.length, 0);
  assert.equal(emptyBoard.meta.coverage.complete, true);
  __resetProplineClient(); fixture.empty = false; fixture.throttle = true;
  const throttled = await fetchBoard('NCAAF', opts);
  assert.equal(throttled.meta.coverage.requested, 1);
  assert.equal(throttled.meta.coverage.complete, false);
}));

test('existing supplement publishes larger coverage and current quota without changing the customer merge contract', async () => withProviderFixture(async ({ calls }) => {
  const result = await maybeRefreshProplineSupplement();
  assert.equal(result.skipped, false);
  assert.equal(result.props, 64);
  assert.equal(proplineSupplementHealth().coverage.sports[0].coverage.eligible, 32);
  assert.equal(proplineSupplementHealth().coverage.quota.remaining, proplineQuota().remaining);
  const count = calls.length;
  const board = mergeCachedPropline({ props: [], data: { events: [], players: [], props: [], lines: [] }, meta: {} }, 'NCAAF');
  assert.equal(board.props.length, 64);
  assert.equal(board.data.events.length, 32);
  assert.equal(board.data.props.length, 32);
  assert.equal(calls.length, count);
  const duplicate = await maybeRefreshProplineSupplement();
  assert.equal(duplicate.skipped, true);
  assert.equal(calls.length, count);
}));
