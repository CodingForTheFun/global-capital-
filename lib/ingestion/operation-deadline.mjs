import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

// A timeout bounds the caller; cancellation fences late I/O. Uncooperative work
// remains quarantined by key until it actually settles, never retried in parallel.
const context = new AsyncLocalStorage();
const active = new Map();
const recent = new Map();
const MAX_RECENT = 96;
export const INGESTION_BUDGET_MS = Object.freeze({
  cycle: 270_000, group: 180_000, provider: 90_000, sport: 60_000,
  feeds: 45_000, coordination: 25_000, release: 8_000, status: 10_000,
});

function failure(code, key) {
  return Object.assign(new Error(`${code}:${key}`), { code, operation: key });
}
function check(scope) {
  if (!scope) return;
  if (!scope.signal.aborted && performance.now() >= scope.deadline) {
    scope.controller.abort(failure('INGESTION_DEADLINE', scope.key));
  }
  scope.signal.throwIfAborted();
}
export function assertIngestionActive() { check(context.getStore()); }
export function ingestionSignal(signal) {
  const scope = context.getStore();
  check(scope);
  if (!scope) return signal;
  return signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
}
export function ingestionFetch(input, init = {}, fetcher = globalThis.fetch) {
  const signal = ingestionSignal(init.signal ?? (input instanceof Request ? input.signal : undefined));
  return fetcher(input, signal ? { ...init, signal } : init);
}
export function ingestionDeadlineHealth() {
  return {
    active: [...active.values()].map(({ key, startedAt, started, signal }) => ({
      operation: key, startedAt, elapsedMs: Math.round(performance.now() - started),
      quarantined: signal.aborted,
    })),
    recent: [...recent.values()],
  };
}

export async function withIngestionDeadline(key, task, timeoutMs = INGESTION_BUDGET_MS.provider) {
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(key) || typeof task !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('A static operation key, function and positive deadline are required.');
  }
  const inherited = context.getStore();
  // AsyncLocalStorage is intentionally inherited by timers created inside a scope.
  // A scheduler retry timer can therefore wake after that same-key operation has
  // already settled and otherwise inherit only the old scope's remaining budget.
  // Treat only that exact settled same-key context as stale. Active same-key work
  // still quarantines below, and different-key late continuations keep the parent
  // cancellation fence unchanged.
  const parent = inherited && inherited.key === key && !active.has(key) ? null : inherited;
  check(parent);
  if (active.has(key)) {
    console.warn('[AutoScout ingestion quarantine]', JSON.stringify({ operation: key }));
    throw failure('INGESTION_OPERATION_IN_FLIGHT', key);
  }
  const controller = new AbortController();
  const started = performance.now();
  const signal = parent ? AbortSignal.any([controller.signal, parent.signal]) : controller.signal;
  const scope = { key, controller, signal, started,
    startedAt: new Date().toISOString(),
    deadline: Math.min(started + timeoutMs, parent?.deadline ?? Infinity),
  };
  active.set(key, scope);
  let timer;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => controller.abort(failure('INGESTION_DEADLINE', key)),
      Math.max(1, Math.ceil(scope.deadline - performance.now())));
  });
  const work = context.run(scope, () => Promise.resolve().then(() => {
    check(scope);
    return task(signal);
  }));
  // Both handlers are installed immediately. A late rejection is consumed, and
  // a late success never escapes as a current result. Only actual settlement
  // removes quarantine; the caller's timeout must not do so.
  const observed = work.then((value) => { check(scope); return value; }).finally(() => {
    if (active.get(key) === scope) active.delete(key);
  });
  try {
    return await Promise.race([observed, aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    const entry = { operation: key, finishedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started), timedOut: signal.aborted };
    recent.delete(key);
    recent.set(key, entry);
    while (recent.size > MAX_RECENT) recent.delete(recent.keys().next().value);
    if (signal.aborted) console.warn('[AutoScout ingestion deadline]', JSON.stringify(entry));
  }
}
