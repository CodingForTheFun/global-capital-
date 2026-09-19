// No network, timers or provider work at module import. Used only by the
// existing single-owner supplement; ordinary page/cache-only reads never run it.
const idOf = (event) => String(event?.id ?? event?.event_id ?? '').trim();
const finite = (value) => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value));
const bound = (value, fallback, min, max) => finite(value) ? Math.min(max, Math.max(min, Math.floor(Number(value)))) : fallback;
const stopped = new Set(['PROPLINE_DAILY_LIMIT', 'PROPLINE_QUOTA_RESERVE', 'PROPLINE_BURST_LIMIT', 'PROPLINE_RATE_LIMITED', 'PROPLINE_UNAUTHORIZED', 'PROPLINE_COVERAGE_DEADLINE', 'PROPLINE_COVERAGE_ABORTED']);
const failure = (code) => Object.assign(new Error('PropLine coverage operation stopped.'), { code });

// An upper budget, never a consumption target. Leave 20% of the time-proportional
// post-reserve headroom for research/recovery; cap one existing 5-minute pass.
export function coverageRequestBudget(quota, { now = Date.now(), reserve = 0, intervalSeconds = 300 } = {}) {
  if (!finite(quota?.limit) || Number(quota.limit) < 250000 || !finite(quota?.remaining)) return 0;
  const reset = Date.parse(quota?.resetAt || '');
  if (!Number.isFinite(reset) || reset <= now) return 0;
  const protectedRequests = Math.max(Math.ceil(Number(quota.limit) * 0.10), finite(reserve) ? Number(reserve) : 0);
  const available = Math.max(0, Number(quota.remaining) - protectedRequests);
  const interval = bound(intervalSeconds, 300, 300, 3600) * 1000;
  return Math.min(384, Math.floor(available * 0.8 * interval / Math.max(interval, reset - now)));
}

export function sportRefreshDelaySeconds(policy, sportCount) {
  const perCycle = Math.max(1, Number(policy?.sportsPerCycle) || 1);
  // A multi-sport pass must not keep the old single-sport rotation multiplier.
  return Math.max(1, Number(policy?.intervalSeconds) || 60) * Math.max(1, Math.ceil(sportCount / perCycle));
}

export async function boundedCoverageCall(operation, { signal = null, timeoutMs = 20000 } = {}) {
  if (signal?.aborted) throw failure('PROPLINE_COVERAGE_ABORTED');
  const controller = new AbortController();
  let timer, onAbort;
  const stop = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(failure('PROPLINE_COVERAGE_ABORTED')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(failure('PROPLINE_COVERAGE_DEADLINE')); }, Math.max(1, timeoutMs));
  });
  try {
    // Even a transport that ignores cancellation cannot wedge this caller or
    // publish a late result: state is committed only after this await succeeds.
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), stop]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function createSlateCoverage({ now = Date.now, maxScopes = 16, maxEvents = 512 } = {}) {
  const scopes = new Map();
  const scopeLimit = bound(maxScopes, 16, 1, 32);
  const eventLimit = bound(maxEvents, 512, 1, 1024);
  return {
    reset() { scopes.clear(); },
    async collect({ scope, events, fetchEvent, requestBudget = 48, maxAgeSeconds = 1200, durationMs = 20000, signal = null }) {
      const start = now();
      const budget = bound(requestBudget, 0, 0, 128);
      const ageMs = bound(maxAgeSeconds, 1200, 1, 1200) * 1000;
      const unique = [...new Map((Array.isArray(events) ? events : []).filter(idOf).map((event) => [idOf(event), event])).values()];
      const eligibleIds = new Set(unique.map(idOf));
      let entries = scopes.get(scope);
      if (!entries) { entries = new Map(); scopes.set(scope, entries); }
      // Recently used scopes remain; a changed market/book/sport scope cannot
      // borrow another scope's event state or retained prices.
      scopes.delete(scope); scopes.set(scope, entries);
      while (scopes.size > scopeLimit) scopes.delete(scopes.keys().next().value);
      for (const [id, entry] of entries) {
        if (!eligibleIds.has(id)) entries.delete(id);
        else if (entry.part && (start < entry.at || start - entry.at >= ageMs)) { entry.part = null; }
      }
      // Unknown events first, then least-recently attempted. Sorting is stable:
      // initial/otherwise equal entries retain the provider's kickoff ordering.
      const ordered = unique.map((event, index) => ({ event, index, last: entries.get(idOf(event))?.attemptedAt ?? -Infinity }))
        .sort((a, b) => a.last - b.last || a.index - b.index);
      const requested = new Set(), succeeded = new Set(), failures = [];
      let reason = null;
      for (const { event } of ordered) {
        if (requested.size >= budget) { reason = 'request_budget'; break; }
        const timeLeft = Math.min(20000, durationMs) - (now() - start);
        if (signal?.aborted || timeLeft <= 0) { reason = signal?.aborted ? 'aborted' : 'deadline'; break; }
        const id = idOf(event);
        requested.add(id);
        const entry = entries.get(id) || { part: null, at: 0, attemptedAt: 0 };
        entry.attemptedAt = now(); entries.set(id, entry);
        try {
          const part = await boundedCoverageCall((requestSignal) => fetchEvent(event, requestSignal), { signal, timeoutMs: timeLeft });
          if (!part || !['events', 'players', 'props', 'lines'].every((key) => Array.isArray(part[key]))) throw failure('PROPLINE_COVERAGE_INVALID_RESPONSE');
          entry.part = part; entry.at = now(); succeeded.add(id);
        } catch (error) {
          const code = /^[A-Z0-9_]{1,80}$/.test(String(error?.code || '')) ? error.code : 'PROPLINE_EVENT_FAILED';
          failures.push({ eventId: id, code });
          if (stopped.has(code)) { reason = code; break; }
        }
      }
      const parts = [], ages = [];
      let retained = 0, covered = 0;
      for (const event of unique) {
        const id = idOf(event), entry = entries.get(id);
        if (!entry?.part || now() < entry.at || now() - entry.at >= ageMs) continue;
        parts.push(entry.part); ages.push(entry.at); covered += 1;
        if (!succeeded.has(id)) retained += 1;
      }
      // Bound retained normalized snapshots. Metadata reports incomplete coverage
      // rather than inventing a complete board if an extreme slate exceeds this.
      while (entries.size > eventLimit) {
        const oldest = [...entries].sort((a, b) => a[1].attemptedAt - b[1].attemptedAt)[0][0];
        entries.delete(oldest);
      }
      const deferred = unique.length - requested.size;
      return {
        parts, failures,
        coverage: {
          eligible: unique.length, requested: requested.size, succeeded: succeeded.size,
          failed: failures.length, deferred, retained, covered,
          complete: deferred === 0 && failures.length === 0 && retained === 0,
          reason, oldestFetchedAt: ages.length ? new Date(Math.min(...ages)).toISOString() : null,
        },
      };
    },
  };
}
