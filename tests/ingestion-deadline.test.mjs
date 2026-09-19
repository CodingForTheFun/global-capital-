import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { withIngestionDeadline, assertIngestionActive, ingestionFetch, ingestionDeadlineHealth } from '../lib/ingestion/operation-deadline.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('deadline aborts stalled work, quarantines it, fences late writes and then recovers', async () => {
  const gate = deferred(); let writes = 0, calls = 0, signal;
  const stalled = withIngestionDeadline('test:stalled', async s => { calls++; signal = s; await gate.promise; assertIngestionActive(); writes++; }, 15);
  await assert.rejects(stalled, { code: 'INGESTION_DEADLINE' });
  assert.equal(signal.aborted, true);
  await assert.rejects(withIngestionDeadline('test:stalled', () => { calls++; }, 100), { code: 'INGESTION_OPERATION_IN_FLIGHT' });
  assert.equal(calls, 1);
  assert.equal(ingestionDeadlineHealth().active.find(x => x.operation === 'test:stalled').quarantined, true);
  assert.equal(await withIngestionDeadline('test:healthy', () => 42, 100), 42);
  gate.resolve(); await flush();
  assert.equal(writes, 0);
  assert.equal(await withIngestionDeadline('test:stalled', () => 'recovered', 100), 'recovered');
});

test('late rejection is consumed and does not become an unhandled rejection', async () => {
  const gate = deferred(); const unhandled = [];
  const listener = error => unhandled.push(error); process.on('unhandledRejection', listener);
  try {
    await assert.rejects(withIngestionDeadline('test:late-reject', () => gate.promise, 15), { code: 'INGESTION_DEADLINE' });
    gate.reject(new Error('late')); await flush(); await flush();
    assert.deepEqual(unhandled, []);
    assert.ok(!ingestionDeadlineHealth().active.some(x => x.operation === 'test:late-reject'));
  } finally { process.off('unhandledRejection', listener); }
});

test('parent cancellation stops child work and forbids a new fallback', async () => {
  let signal, fallback = 0;
  await assert.rejects(withIngestionDeadline('test:parent', async () => {
    try {
      await withIngestionDeadline('test:child', async s => { signal = s; await sleep(1000, null, { signal: s }); }, 1000);
    } catch {
      await withIngestionDeadline('test:fallback', () => fallback++, 1000);
    }
  }, 15), { code: 'INGESTION_DEADLINE' });
  await flush();
  assert.equal(signal.aborted, true); assert.equal(fallback, 0);
});

test('fetch preserves request options and composes operation and caller abort signals', async () => {
  const controller = new AbortController(); let init;
  const headers = { accept: 'application/json' };
  await assert.rejects(withIngestionDeadline('test:fetch', async () => {
    await ingestionFetch('https://example.invalid', { headers, signal: controller.signal }, async (_url, opts) => {
      init = opts; await sleep(1000, null, { signal: opts.signal });
    });
  }, 15), { code: 'INGESTION_DEADLINE' });
  assert.equal(init.headers, headers); assert.equal(init.signal.aborted, true);
  assert.equal(controller.signal.aborted, false);
  await ingestionFetch('https://example.invalid', { headers }, async (_url, opts) => assert.equal(opts.headers, headers));
});

test('diagnostics are bounded and contain no URLs, request headers or payloads', async () => {
  for (let i = 0; i < 110; i++) await withIngestionDeadline(`test:diagnostic-${i}`, () => i, 100);
  assert.equal(ingestionDeadlineHealth().recent.length, 96);
  await assert.rejects(withIngestionDeadline('https://secret.example?key=x', () => 1, 100), TypeError);
});

test('a settled scope timer gets a fresh budget when it retries the same operation key', async () => {
  const retry = deferred();
  const key = 'test:same-key-retry';
  await withIngestionDeadline(key, () => {
    setTimeout(() => {
      void withIngestionDeadline(key, async () => {
        await sleep(45);
        return 'fresh-budget';
      }, 200).then(retry.resolve, retry.reject);
    }, 55);
    return 'scheduled';
  }, 80);
  assert.equal(await retry.promise, 'fresh-budget');
});
