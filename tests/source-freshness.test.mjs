import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublicFeedJson, publicFeedErrorCode, deferUnderdogTimeoutFallback } from '../lib/ingestion/public-feed-transport.mjs';
import { feedObservation, feedFreshness, assessSourceCoverage, advanceCoverageAlert } from '../lib/ingestion/source-freshness.mjs';
import { createSourceCoverageObserver } from '../lib/ingestion/source-coverage-observer.mjs';

const BASE = Date.parse('2026-09-19T10:00:00Z');
const iso = offset => new Date(BASE + offset).toISOString();
const source = (overrides = {}) => ({ source: 'underdog', activeRows: 100, freshRows: 100, staleRows: 0,
  expiringRows: 0, expiredUpcomingRows: 0, fetchedAt: iso(0), fetchStatus: 'available', retained: false, ...overrides });
const assess = (overrides = {}, extra = {}) => assessSourceCoverage(source(overrides), { dbNow: iso(60_000), ...extra });

test('HTTP failure cancels unconsumed body and aborts its owned request', async () => {
  let cancelled = 0, signal;
  await assert.rejects(fetchPublicFeedJson('https://feed.example/lines?secret=not-logged', {
    fetcher: async (_url, options) => { signal = options.signal; return { ok: false, status: 426,
      headers: new Headers(), body: { cancel() { cancelled++; return Promise.resolve(); } } }; },
  }), e => e.status === 426 && e.endpoint === 'feed.example');
  assert.equal(cancelled, 1); assert.equal(signal.aborted, true);
});

test('HTTP Retry-After is preserved and rejected cleanup does not mask the error', async () => {
  await assert.rejects(fetchPublicFeedJson('https://feed.example', { fetcher: async () => ({ ok: false, status: 429,
    headers: new Headers({ 'retry-after': '120' }), body: { cancel() { return Promise.reject(new Error('cleanup')); } } }),
  }), e => e.status === 429 && e.retryMs === 120_000);
});

test('successful JSON still uses one request and releases its resources', async () => {
  let calls = 0, signal;
  const result = await fetchPublicFeedJson('https://feed.example', { fetcher: async (_u, opts) => {
    calls++; signal = opts.signal; return new Response('{"lines":[1]}');
  } });
  assert.deepEqual(result, { lines: [1] }); assert.equal(calls, 1); assert.equal(signal.aborted, true);
});

test('oversized and invalid payloads fail closed', async () => {
  await assert.rejects(fetchPublicFeedJson('https://feed.example', { maxBytes: 2, fetcher: async () => new Response('123') }), /PUBLIC_FEED_TOO_LARGE/);
  await assert.rejects(fetchPublicFeedJson('https://feed.example', { fetcher: async () => new Response('not-json') }), SyntaxError);
});

test('request timeout aborts transport and keeps the primary timeout code', async () => {
  // Keep the fake request alive exactly as a real network socket would.
  const hold = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchPublicFeedJson('https://feed.example', { timeoutMs: 5,
      fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    }), e => publicFeedErrorCode(e) === 'PUBLIC_FEED_TIMEOUT');
  } finally { clearTimeout(hold); }
});

test('only an unsuccessful Underdog transient timeout defers fallback churn', () => {
  const failed = { status: 'unavailable', httpStatus: 426, primaryCode: 'PUBLIC_FEED_TIMEOUT' };
  assert.equal(deferUnderdogTimeoutFallback('underdog', failed), true);
  assert.equal(deferUnderdogTimeoutFallback('prizepicks', failed), false);
  assert.equal(deferUnderdogTimeoutFallback('underdog', { ...failed, status: 'available' }), false);
  assert.equal(deferUnderdogTimeoutFallback('underdog', { ...failed, primaryCode: 'PUBLIC_FEED_HTTP' }), false);
  assert.equal(deferUnderdogTimeoutFallback('underdog', { status: 'unavailable', reason: 'The operation was aborted due to timeout' }), true);
});

test('source telemetry is bounded, identifies flapping, and never mutates last-known-good', () => {
  let state = { records: [{ line: 2.5 }], fetchedAt: iso(0) };
  const records = state.records;
  for (let i = 0; i < 20; i++) state = { ...state, observability: feedObservation(state, { startedAt: BASE + i * 1000, endedAt: BASE + i * 1000 + 5, ok: i % 2 === 0 }) };
  const report = feedFreshness(state, BASE + 21_000);
  assert.equal(state.observability.history.length, 12);
  assert.equal(report.flapping, true); assert.equal(report.consecutiveSuccesses, 0);
  assert.equal(state.records, records); assert.equal(state.fetchedAt, iso(0));
  assert.equal(report.evidence, 'feed-cache-not-database');
  assert.equal(feedFreshness(state, BASE + 2 * 60 * 60_000).flapping, false);
});

test('missing telemetry stays unknown rather than becoming a zero count', () => {
  assert.equal(assess({ activeRows: undefined }).level, 'unknown');
  assert.equal(assess({ freshRows: null }).freshShare, null);
  assert.equal(assess({ freshRows: 101 }).level, 'unknown');
  assert.equal(assess({ expiringRows: 101 }).level, 'unknown');
});

test('newest observation does not hide stale or expired coverage', () => {
  assert.equal(assess({ activeRows: 6979, freshRows: 6946, staleRows: 33, expiringRows: 33, latestObservedAt: iso(59_000) }).level, 'warning');
  assert.equal(assess({ freshRows: 0, staleRows: 100 }).reason, 'all_active_rows_stale');
  assert.equal(assess({ activeRows: 1, freshRows: 1, expiredUpcomingRows: 99 }).reason, 'partial_coverage_expired');
  assert.equal(assess({ activeRows: 0, freshRows: 0, expiredUpcomingRows: 100 }).reason, 'retained_upcoming_coverage_expired');
});

test('zero active source is explicit; fresh confirmed no-props can be idle', () => {
  assert.equal(assess({ activeRows: 0, freshRows: 0, fetchStatus: 'unavailable' }).level, 'critical');
  assert.equal(assess({ activeRows: 0, freshRows: 0, fetchStatus: 'no_props' }).level, 'idle');
  assert.equal(assess({ activeRows: 0, freshRows: 0, fetchStatus: 'no_props', fetchedAt: iso(-20 * 60_000) }).level, 'unknown');
});

test('fetch failure or flapping cannot be hidden by other fresh source rows', () => {
  assert.equal(assess({}, { feed: { status: 'unavailable' } }).level, 'warning');
  assert.equal(assess({}, { feed: { status: 'available', freshness: { flapping: true } } }).level, 'warning');
  assert.equal(assess({}, { feed: { status: 'available', partial: true } }).level, 'warning');
  assert.equal(assess({ written: 0 }).level, 'healthy');
});

test('recovery needs two distinct, monotonically newer persisted observations', () => {
  let alert = advanceCoverageAlert(null, assess({ fetchStatus: 'unavailable' }), BASE);
  let recovered = assess();
  alert = advanceCoverageAlert(alert, recovered, BASE + 1000);
  assert.equal(alert.level, 'recovering'); assert.equal(alert.successes, 1);
  alert = advanceCoverageAlert(alert, recovered, BASE + 2000);
  assert.equal(alert.level, 'recovering'); assert.equal(alert.successes, 1);
  alert = advanceCoverageAlert(alert, { ...recovered, recoveryObservation: iso(-60_000) }, BASE + 3000);
  alert = advanceCoverageAlert(alert, recovered, BASE + 4000);
  assert.equal(alert.successes, 1);
  alert = advanceCoverageAlert(alert, { ...recovered, recoveryObservation: iso(300_000) }, BASE + 300_000);
  assert.equal(alert.level, 'healthy'); assert.equal(alert.recovered, true);
});

test('failed recovery resets streak and repeated same-level incidents are rate limited', () => {
  const failed = assess({ fetchStatus: 'unavailable' });
  let alert = advanceCoverageAlert(null, failed, BASE);
  assert.equal(alert.emit, true);
  alert = advanceCoverageAlert(alert, failed, BASE + 1000);
  assert.equal(alert.emit, false);
  alert = advanceCoverageAlert(alert, assess(), BASE + 2000);
  alert = advanceCoverageAlert(alert, failed, BASE + 3000);
  assert.equal(alert.successes, 0);
  alert = advanceCoverageAlert(alert, failed, BASE + 11 * 60_000);
  assert.equal(alert.emit, true);
});

const config = () => ({ url: 'https://db.example', key: 'test-key', token: 'test-token' });
const response = (time, rows = [source(), source({ source: 'prizepicks' })]) => new Response(JSON.stringify({ dbNow: new Date(time).toISOString(), sources: rows }));

test('passive observer is single flight and never widens cadence', async () => {
  let clock = BASE, calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const observer = createSourceCoverageObserver({ now: () => clock, config, emit: () => {}, intervalMs: 1,
    fetcher: async (url, options) => { calls++; assert.equal(url, 'https://db.example/rest/v1/rpc/autoscout_source_freshness');
      assert.deepEqual(JSON.parse(options.body), { p_token: 'test-token' }); await gate; return response(clock); },
  });
  const a = observer.observe(), b = observer.observe(); assert.equal(a, b); release();
  assert.equal((await a).ok, true); assert.equal(calls, 1);
  assert.equal((await observer.observe()).skipped, true);
  clock += 60_000; await observer.observe(); assert.equal(calls, 2);
});

test('observer failures are unknown, redact errors, and missing source is not success', async () => {
  let clock = BASE, kind = 0;
  const logs = [];
  const observer = createSourceCoverageObserver({ now: () => clock, config, emit: row => logs.push(row), fetcher: async () => {
    if (kind === 0) throw new Error('test-token secret response');
    if (kind === 1) return new Response('test-token', { status: 404 });
    return response(clock, [source()]);
  } });
  assert.equal((await observer.observe()).code, 'SOURCE_COVERAGE_READ_FAILED');
  clock += 60_000; kind = 1;
  assert.equal((await observer.observe()).code, 'SOURCE_COVERAGE_RPC_MISSING');
  clock += 60_000; kind = 2;
  assert.equal((await observer.observe()).code, 'SOURCE_COVERAGE_MISSING_SOURCE');
  assert.equal(JSON.stringify(logs).includes('test-token'), false);
});
