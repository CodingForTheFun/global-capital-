const MINUTE = 60_000;
const time = value => { const n = Date.parse(String(value || '')); return Number.isFinite(n) ? n : null; };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Persist only bounded telemetry alongside the existing source cache. */
export function feedObservation(previous, { startedAt, endedAt, ok, primaryCode = null, primaryHttpStatus = null, attempts = [] }) {
  const prior = previous?.observability || {};
  const history = (Array.isArray(prior.history) ? prior.history : [])
    .filter(row => row && Number.isFinite(row.at) && row.at >= endedAt - 60 * MINUTE && row.at <= endedAt)
    .slice(-11);
  history.push({ at: endedAt, ok: Boolean(ok) });
  return {
    lastAttemptAt: new Date(startedAt).toISOString(),
    lastOutcomeAt: new Date(endedAt).toISOString(),
    durationMs: Math.max(0, endedAt - startedAt),
    consecutiveSuccesses: ok ? Math.min(1000, (Number(prior.consecutiveSuccesses) || 0) + 1) : 0,
    primaryCode, primaryHttpStatus,
    attempts: attempts.slice(0, 10).map(a => ({ candidate: a.candidate, code: a.code, httpStatus: a.httpStatus ?? null })),
    history,
  };
}

export function feedFreshness(state, now) {
  const fetched = time(state?.fetchedAt);
  const telemetry = state?.observability;
  const history = (Array.isArray(telemetry?.history) ? telemetry.history : []).filter(row => row && Number.isFinite(row.at) && row.at >= now - 60 * MINUTE && row.at <= now);
  const transitions = history.reduce((sum, row, i) => sum + (i > 0 && row.ok !== history[i - 1].ok ? 1 : 0), 0);
  return {
    evidence: 'feed-cache-not-database',
    lastAttemptAt: telemetry?.lastAttemptAt || null,
    lastOutcomeAt: telemetry?.lastOutcomeAt || null,
    durationMs: telemetry?.durationMs ?? null,
    fetchAgeMs: fetched === null || fetched > now ? null : now - fetched,
    consecutiveSuccesses: telemetry?.consecutiveSuccesses ?? null,
    primaryCode: telemetry?.primaryCode ?? null,
    primaryHttpStatus: telemetry?.primaryHttpStatus ?? null,
    transitionsLastHour: transitions,
    flapping: transitions >= 3,
  };
}

/** Classify actual DB aggregates. A successful read with zero rows differs from
 * a failed/missing read. Freshness share is NOT coverage of a provider universe. */
export function assessSourceCoverage(row, { dbNow, feed = null } = {}) {
  const measured = time(dbNow);
  const active = count(row?.activeRows), fresh = count(row?.freshRows);
  const stale = count(row?.staleRows), expiring = count(row?.expiringRows);
  const expired = count(row?.expiredUpcomingRows);
  if (measured === null || [active, fresh, stale, expiring, expired].some(n => n === null)
      || fresh + stale !== active || expiring > active) {
    return { source: row?.source || 'unknown', level: 'unknown', reason: 'coverage_telemetry_unavailable', freshShare: null };
  }
  const fetched = time(row.fetchedAt);
  const recent = fetched !== null && fetched <= measured && measured - fetched <= 10 * MINUTE;
  const freshShare = active ? fresh / active : null;
  const status = row.fetchStatus;
  const failed = ['unavailable', 'cooldown', 'partial', 'stale'].includes(status)
    || ['unavailable', 'cooldown', 'partial', 'stale'].includes(feed?.status) || feed?.partial === true;
  let level = 'healthy', reason = 'fresh_active_rows';
  if (active === 0 && status === 'no_props' && recent && !failed) {
    level = 'idle'; reason = 'confirmed_empty_fetch';
  } else if (active === 0 && expired > 0) {
    level = 'critical'; reason = 'retained_upcoming_coverage_expired';
  } else if (active === 0 && failed) {
    level = 'critical'; reason = 'source_unavailable_without_active_rows';
  } else if (active === 0) {
    level = 'unknown'; reason = 'no_current_coverage_evidence';
  } else if (fresh === 0) {
    level = 'critical'; reason = 'all_active_rows_stale';
  } else if (expired > 0 || stale > 0 || failed || feed?.freshness?.flapping || !recent) {
    level = 'warning'; reason = expired > 0 ? 'partial_coverage_expired'
      : stale > 0 ? 'retained_rows_stale' : failed ? 'fetch_failed_retaining_rows'
      : feed?.freshness?.flapping ? 'source_flapping' : 'fetch_recency_unverified';
  }
  return { source: row.source, level, reason, activeRows: active, freshRows: fresh,
    staleRows: stale, expiringRows: expiring, expiredUpcomingRows: expired,
    freshShare, latestObservedAt: row.latestObservedAt || null, nextExpiryAt: row.nextExpiryAt || null,
    fetchedAt: row.fetchedAt || null,
    // Only a successful persistence status can count toward recovery; the cache
    // timestamp alone, or written=0 vs written>0, cannot prove it.
    recoveryObservation: level === 'healthy' && status === 'available' && row.retained !== true
      && recent && fresh > 0 ? row.fetchedAt : null };
}

/** Single-flight observer owns this map. No timers or upstream requests here. */
export function advanceCoverageAlert(previous, current, now, { reminderMs = 10 * MINUTE } = {}) {
  const bad = !['healthy', 'idle'].includes(current.level);
  let successes = previous?.successes || 0;
  let lastObservation = previous?.lastObservation || null;
  let incident = previous?.incident || false;
  if (bad) { incident = true; successes = 0; }
  else if (current.recoveryObservation && current.recoveryObservation !== lastObservation) {
    const next = time(current.recoveryObservation), last = time(lastObservation);
    if (next !== null && (last === null || next > last)) successes += 1;
  }
  if (current.recoveryObservation && (time(lastObservation) === null || time(current.recoveryObservation) > time(lastObservation))) lastObservation = current.recoveryObservation;
  const recovered = incident && !bad && successes >= 2;
  if (recovered) incident = false;
  const level = incident && !bad ? 'recovering' : current.level;
  const changed = !previous || previous.level !== level || previous.reason !== current.reason;
  const emit = changed || (level !== 'healthy' && level !== 'idle' && now - (previous?.lastEmittedAt || 0) >= reminderMs);
  return { level, reason: current.reason, incident, successes, lastObservation,
    lastEmittedAt: emit ? now : previous?.lastEmittedAt || 0, emit, recovered };
}
