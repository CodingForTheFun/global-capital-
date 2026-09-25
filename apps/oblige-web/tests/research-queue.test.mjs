import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createResearchQueue, reasonText, isTransientError } from '../lib/research-queue.mjs';

const g = (key) => ({ key });
const ok = (key) => ({ ok: true, available: true, windows: { last10: { hitRate: 50 } }, key });
const httpError = (status, extra = {}) => Object.assign(new Error('x'), { status, ...extra });
const tick = () => new Promise((r) => setTimeout(r, 0));
async function idle(queue) {
  for (let i = 0; i < 200 && (queue.stats().running || queue.stats().pending); i++) await tick();
}

function harness(respond, options = {}) {
  const calls = [];
  const settled = [];
  const sleeps = [];
  let authLost = 0;
  const queue = createResearchQueue({
    batchSize: options.batchSize ?? 3,
    priorityBatchSize: options.priorityBatchSize,
    maxAttempts: options.maxAttempts ?? 3,
    gapMs: 0,
    baseDelayMs: 1000,
    sleep: async (ms) => { sleeps.push(ms); },
    onAuthLost: () => { authLost++; },
    fetchBatch: async (groups, signal) => {
      calls.push({ keys: groups.map((x) => x.key), signal });
      return respond(groups, calls.length);
    },
    onSettled: (entries) => settled.push(...entries),
  });
  return { queue, calls, settled, sleeps, authLost: () => authLost };
}

const allOk = (groups) => Object.fromEntries(groups.map((x) => [x.key, ok(x.key)]));

test('asks once per prop even when the wanted list churns (live refresh / EV re-sort)', async () => {
  const h = harness(allOk);
  h.queue.want(['a', 'b', 'c'].map(g));
  h.queue.want(['c', 'b', 'a'].map(g)); // re-sorted while the first batch is in flight
  h.queue.want(['b', 'a', 'c', 'd'].map(g));
  await idle(h.queue);
  h.queue.want(['a', 'b', 'c', 'd'].map(g)); // everything already settled
  await idle(h.queue);
  const asked = h.calls.flatMap((c) => c.keys).sort();
  assert.deepEqual(asked, ['a', 'b', 'c', 'd']);
  assert.ok(h.calls.every((c) => !c.signal.aborted), 'no request was aborted by list changes');
  assert.equal(h.settled.length, 4);
});

test('visible rows jump the queue ahead of background rows', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness(async (groups, n) => { if (n === 1) await gate; return allOk(groups); }, { batchSize: 2 });
  h.queue.want(['x1', 'x2', 'bg1', 'bg2', 'bg3', 'bg4'].map(g));
  await tick();
  h.queue.want(['v1', 'v2'].map(g)); // user scrolls: new visible page
  release();
  await idle(h.queue);
  assert.deepEqual(h.calls.map((c) => c.keys), [['x1', 'x2'], ['v1', 'v2'], ['bg1', 'bg2'], ['bg3', 'bg4']]);
});

test('a batch rejected as invalid is split so one bad prop cannot blank the rest', async () => {
  const h = harness((groups) => {
    if (groups.some((x) => x.key === 'bad')) throw httpError(400, { code: 'INVALID_BATCH_REQUEST' });
    return allOk(groups);
  }, { batchSize: 4 });
  h.queue.want(['a', 'b', 'bad', 'c'].map(g));
  await idle(h.queue);
  const byKey = Object.fromEntries(h.settled.map((s) => [s.group.key, s]));
  for (const k of ['a', 'b', 'c']) assert.ok(byKey[k].row, `${k} has research`);
  assert.equal(byKey.bad.row, null);
  assert.equal(byKey.bad.code, 'INVALID_RESEARCH_REQUEST');
});

test('429 waits for Retry-After, then retries; gives up with a reason after max attempts', async () => {
  const h = harness((groups, n) => {
    if (n === 1) throw httpError(429, { retryAfterMs: 7000 });
    return allOk(groups);
  });
  h.queue.want(['a'].map(g));
  await idle(h.queue);
  assert.equal(h.sleeps[0], 7000);
  assert.ok(h.settled[0].row);

  const busy = harness(() => { throw httpError(503); }, { maxAttempts: 3 });
  busy.queue.want(['a'].map(g));
  await idle(busy.queue);
  assert.equal(busy.calls.length, 3);
  assert.deepEqual(busy.sleeps, [1000, 2000]);
  assert.equal(busy.settled[0].code, 'RESEARCH_RETRY_EXHAUSTED');
});

test('a busy stats provider for one row is retried; other rows settle straight away', async () => {
  const h = harness((groups, n) => {
    const out = allOk(groups);
    if (n === 1) out.b = { ok: false, available: false, code: 'RESEARCH_PROVIDER_ERROR' };
    return out;
  });
  h.queue.want(['a', 'b'].map(g));
  await idle(h.queue);
  assert.deepEqual(h.calls.map((c) => c.keys), [['a', 'b'], ['b']]);
  assert.ok(h.settled.find((s) => s.group.key === 'b').row.available);
});

test('permanent per-row answers keep their code for the tap-for-reason', async () => {
  const h = harness((groups) => ({ a: { ok: true, available: false, code: 'UNSUPPORTED_MARKET', message: 'x' } }));
  h.queue.want(['a', 'missing'].map(g));
  await idle(h.queue);
  const byKey = Object.fromEntries(h.settled.map((s) => [s.group.key, s]));
  assert.equal(byKey.a.code, 'UNSUPPORTED_MARKET');
  assert.equal(byKey.missing.code, 'NO_RESULT');
});

test('401 stops the queue and reports the lost session', async () => {
  const h = harness(() => { throw httpError(401); });
  h.queue.want(['a', 'b', 'c', 'd'].map(g));
  await idle(h.queue);
  assert.equal(h.calls.length, 1);
  assert.equal(h.authLost(), 1);
  h.queue.want(['e'].map(g));
  await idle(h.queue);
  assert.equal(h.calls.length, 1);
});

test('cancel aborts the in-flight request and nothing settles afterwards', async () => {
  let seen;
  const h = harness((groups, n) => new Promise((resolve, reject) => {
    seen = n;
    groups.length && setTimeout(() => resolve(allOk(groups)), 5);
  }));
  h.queue.want(['a'].map(g));
  await tick();
  h.queue.cancel();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(h.calls[0].signal.aborted);
  assert.equal(h.settled.length, 0);
  assert.equal(seen, 1);
});

test('reason text and transient classification', () => {
  assert.equal(reasonText('UNSUPPORTED_MARKET'), 'No stat history for this market yet.');
  assert.equal(reasonText('FANTASY_SCORING_UNVERIFIED'), 'Fantasy scoring differs by app, so history is not scored here.');
  assert.equal(reasonText('SOMETHING_NEW', 'Server said so.'), 'Server said so.');
  assert.equal(reasonText(null, null), 'History is unavailable for this prop.');
  assert.equal(isTransientError(httpError(429)), true);
  assert.equal(isTransientError(httpError(503)), true);
  assert.equal(isTransientError(httpError(400)), false);
  assert.equal(isTransientError(Object.assign(new TypeError('Failed to fetch'))), true);
});

test('the board uses the queue instead of aborting research on every list change', () => {
  const board = readFileSync(new URL('../components/terminal-board.tsx', import.meta.url), 'utf8');
  assert.match(board, /createResearchQueue(<[^>]*>)?\(/);
  assert.doesNotMatch(board, /fetchResearchBatch\(batch, 'OVER', controller\.signal\)/);
});

test('newly wanted rows go out in a small batch of their own, then batches return to full size', async () => {
  const h = harness(allOk, { batchSize: 10, priorityBatchSize: 3 });
  h.queue.want(Array.from({ length: 14 }, (_, i) => g('r' + i)));
  await idle(h.queue);
  assert.deepEqual(h.calls.map((c) => c.keys.length), [3, 10, 1]);
  assert.deepEqual(h.calls[0].keys, ['r0', 'r1', 'r2'], 'the first rows asked for come back first');
});

test('without a priority size, batching is unchanged', async () => {
  const h = harness(allOk, { batchSize: 10 });
  h.queue.want(Array.from({ length: 14 }, (_, i) => g('r' + i)));
  await idle(h.queue);
  assert.deepEqual(h.calls.map((c) => c.keys.length), [10, 4]);
});
