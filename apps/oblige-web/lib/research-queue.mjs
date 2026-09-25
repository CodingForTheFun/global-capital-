// Loads board research (L5/L10/L15/H2H/streak) in batches without fighting the
// live board. The board's row list changes on every live refresh and as EV
// estimates re-sort it; the old loader aborted its request each time, so on a
// phone most batches were cancelled (HTTP 499) and a failed batch left 100
// rows blank for good. This queue:
//   - never aborts a request because the wanted list changed, only on cancel()
//   - asks once per prop, highest-priority (visible) rows first
//   - retries busy/transient failures with backoff, honouring Retry-After
//   - splits a batch the server rejected as invalid, so one bad prop cannot
//     blank the other 99
//   - keeps the server's per-row code so the board can say why a cell is empty
// Framework-free so it can be tested with node --test.

export const RESEARCH_REASONS = Object.freeze({
  UNSUPPORTED_MARKET: 'No stat history for this market yet.',
  UNMAPPED_MARKET: 'No stat history for this market yet.',
  PLAYER_NOT_MATCHED: 'Player not matched to a stats source yet.',
  PLAYER_TEAM_MISMATCH: 'Player not matched to a stats source yet.',
  HISTORY_IDENTITY_UNVERIFIED: 'Player not matched to a stats source yet.',
  FANTASY_SCORING_UNVERIFIED: 'Fantasy scoring differs by app, so history is not scored here.',
  NO_GAME_LOG_DATA: 'No recent games found for this player.',
  GAME_LOG_UNAVAILABLE: 'No recent games found for this player.',
  PERIOD_HISTORY_UNAVAILABLE: 'No history for this part of the game.',
  INVALID_RESEARCH_REQUEST: 'This prop is missing details needed for history.',
  RESEARCH_PROVIDER_ERROR: 'Stats source is busy. Try again in a minute.',
  RESEARCH_RETRY_EXHAUSTED: 'Stats source is busy. Try again in a minute.',
  RESEARCH_BATCH_UNAVAILABLE: 'History is temporarily unavailable.',
  NO_RESULT: 'History is temporarily unavailable.',
  NO_WINDOW: 'Not enough games for this window yet.',
});

const TRANSIENT_ROW_CODES = new Set(['RESEARCH_PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT', 'RESEARCH_TIMEOUT']);
const TRANSIENT_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

/** One short sentence for an empty research cell. */
export function reasonText(code, message) {
  if (code && RESEARCH_REASONS[code]) return RESEARCH_REASONS[code];
  const text = typeof message === 'string' ? message.trim() : '';
  return text ? text.slice(0, 140) : 'History is unavailable for this prop.';
}

export function isTransientError(error) {
  if (!error) return false;
  if (error.name === 'TypeError') return true; // fetch network failure
  const status = Number(error.status);
  return Number.isFinite(status) ? TRANSIENT_STATUSES.has(status) : false;
}

function isTransientRow(row) {
  return Boolean(row && (row.retryable === true || TRANSIENT_ROW_CODES.has(row.code)));
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * @param {object} options
 * @param {(groups: any[], signal: AbortSignal) => Promise<Record<string, any>>} options.fetchBatch
 * @param {(settled: Array<{group: any, row: any, code: string|null, message: string|null}>) => void} options.onSettled
 */
export function createResearchQueue({
  fetchBatch,
  onSettled,
  onAuthLost = () => {},
  batchSize = 100,
  /** Size of the batch that carries newly prioritised (visible) props, so they return first. */
  priorityBatchSize = batchSize,
  maxAttempts = 3,
  baseDelayMs = 2000,
  gapMs = 250,
  sleep = defaultSleep,
}) {
  const pending = new Map(); // key -> { group, attempts, limit }
  let order = [];
  const inFlight = new Set();
  const settled = new Set();
  const controller = new AbortController();
  let running = false;
  let cancelled = false;
  let requests = 0;
  let priorityRemaining = 0;

  function settle(entries) {
    if (!entries.length || cancelled) return;
    for (const e of entries) settled.add(e.group.key);
    onSettled(entries);
  }

  function requeue(entry, { front = false, countAttempt = true, limit = entry.limit } = {}) {
    const attempts = entry.attempts + (countAttempt ? 1 : 0);
    if (attempts >= maxAttempts) {
      settle([{ group: entry.group, row: null, code: 'RESEARCH_RETRY_EXHAUSTED', message: null }]);
      return false;
    }
    pending.set(entry.group.key, { group: entry.group, attempts, limit });
    order = front ? [entry.group.key, ...order] : [...order, entry.group.key];
    return true;
  }

  async function runBatch(batch) {
    requests++;
    let results;
    try {
      results = await fetchBatch(batch.map((e) => e.group), controller.signal);
    } catch (error) {
      for (const e of batch) inFlight.delete(e.group.key);
      if (cancelled || error?.name === 'AbortError') return 0;
      if (Number(error?.status) === 401) {
        cancel();
        onAuthLost();
        return 0;
      }
      if (Number(error?.status) === 400 && batch.length > 1) {
        // One invalid prop rejects the whole batch; split to isolate it.
        const half = Math.ceil(batch.length / 2);
        // Each half remembers its size so the next pass cannot merge them back.
        for (const part of [batch.slice(half), batch.slice(0, half)]) {
          for (const e of [...part].reverse()) requeue(e, { front: true, countAttempt: false, limit: part.length });
        }
        return 0;
      }
      if (isTransientError(error)) {
        let retried = false;
        for (const e of batch) retried = requeue(e) || retried;
        if (!retried) return 0;
        const attempt = Math.max(1, ...batch.map((e) => e.attempts + 1));
        const retryAfter = Number(error?.retryAfterMs);
        return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : baseDelayMs * 2 ** (attempt - 1);
      }
      settle(batch.map((e) => ({
        group: e.group,
        row: null,
        code: batch.length === 1 && Number(error?.status) === 400 ? 'INVALID_RESEARCH_REQUEST' : (error?.code || 'RESEARCH_BATCH_UNAVAILABLE'),
        message: null,
      })));
      return 0;
    }

    const done = [];
    let retried = false;
    for (const e of batch) {
      inFlight.delete(e.group.key);
      const row = results?.[e.group.key];
      if (!row) done.push({ group: e.group, row: null, code: 'NO_RESULT', message: null });
      else if (isTransientRow(row)) retried = requeue(e) || retried;
      else done.push({ group: e.group, row, code: row.code || null, message: row.message || null });
    }
    settle(done);
    return retried ? baseDelayMs : 0;
  }

  async function pump() {
    if (running || cancelled) return;
    running = true;
    try {
      while (!cancelled && order.length) {
        const batch = [];
        const size = priorityRemaining > 0 ? Math.min(batchSize, priorityBatchSize) : batchSize;
        let limit = size;
        while (order.length && batch.length < limit) {
          const key = order.shift();
          const entry = pending.get(key);
          if (!entry) continue;
          if (!batch.length) limit = Math.min(size, entry.limit ?? batchSize);
          else if ((entry.limit ?? batchSize) < batchSize && batch.length) { order.unshift(key); break; }
          pending.delete(key);
          inFlight.add(key);
          batch.push(entry);
        }
        if (!batch.length) continue;
        priorityRemaining = Math.max(0, priorityRemaining - batch.length);
        const wait = await runBatch(batch);
        if (cancelled) break;
        if (wait > 0) await sleep(wait, controller.signal);
        else if (order.length && gapMs > 0) await sleep(gapMs, controller.signal);
      }
    } finally {
      running = false;
    }
  }

  /** Ask for research on these props, in priority order. Already loaded or loading props are skipped. */
  function want(groups) {
    if (cancelled) return;
    const first = [];
    for (const group of groups) {
      if (!group?.key || settled.has(group.key) || inFlight.has(group.key)) continue;
      if (first.includes(group.key)) continue;
      const current = pending.get(group.key);
      pending.set(group.key, { group, attempts: current?.attempts ?? 0, limit: current?.limit ?? batchSize });
      first.push(group.key);
    }
    if (!first.length) return;
    const wanted = new Set(first);
    order = [...first, ...order.filter((key) => !wanted.has(key) && pending.has(key))];
    priorityRemaining = Math.min(first.length, priorityBatchSize);
    void pump();
  }

  function cancel() {
    cancelled = true;
    controller.abort();
    pending.clear();
    order = [];
  }

  return {
    want,
    cancel,
    stats: () => ({ requests, pending: order.length, inFlight: inFlight.size, settled: settled.size, running }),
  };
}
