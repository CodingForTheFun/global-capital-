import { assessSourceCoverage, advanceCoverageAlert } from './source-freshness.mjs';

const text = value => String(value ?? '').trim();
/** Passive DB read only. Invoked by the existing scheduler; never starts a timer
 * or a provider call. Missing RPC/credentials are UNKNOWN, never zero coverage. */
export function createSourceCoverageObserver({
  now = Date.now, fetcher = globalThis.fetch, emit = row => console.log('[Oblige source coverage]', JSON.stringify(row)),
  intervalMs = 60_000, timeoutMs = 2_500,
  config = () => ({ url: text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, ''),
    key: text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY),
    token: text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN) }),
} = {}) {
  let pending = null, nextAt = 0, lastTelemetry = null;
  const states = new Map();
  const safeEmit = row => { try { emit(row); } catch {} };
  function unknown(code) {
    // No raw error messages, response bodies, hostnames, headers, or secrets.
    if (lastTelemetry !== code) safeEmit({ scope: 'active-public-store', level: 'unknown', code });
    lastTelemetry = code;
    // An observation gap cannot count as consecutive successful recovery.
    for (const [source, state] of states) states.set(source, { ...state, successes: 0, incident: true });
    return { ok: false, code };
  }
  async function read(feeds) {
    const { url, key, token } = config();
    if (!url || !key || !token) return unknown('SOURCE_COVERAGE_NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
    let response;
    try {
      response = await fetcher(`${url}/rest/v1/rpc/autoscout_source_freshness`, {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
        body: JSON.stringify({ p_token: token }), signal: controller.signal,
      });
      if (!response.ok) return unknown(response.status === 404 ? 'SOURCE_COVERAGE_RPC_MISSING' : 'SOURCE_COVERAGE_READ_FAILED');
      const body = await response.json();
      const dbNowMs = Date.parse(String(body?.dbNow || ''));
      if (!Array.isArray(body?.sources) || !body.sources.length || !Number.isFinite(dbNowMs)
          || Math.abs(now() - dbNowMs) > 60_000 || body.sources.length > 128) return unknown('SOURCE_COVERAGE_INVALID_RESPONSE');
      const seen = new Set();
      for (const row of body.sources) {
        if (typeof row?.source !== 'string' || !/^[a-z0-9:_-]{1,80}$/i.test(row.source) || seen.has(row.source)) return unknown('SOURCE_COVERAGE_INVALID_RESPONSE');
        seen.add(row.source);
      }
      // Fixed DFS sources must not disappear from a successful aggregate read.
      if (!seen.has('underdog') || !seen.has('prizepicks')) return unknown('SOURCE_COVERAGE_MISSING_SOURCE');
      if (lastTelemetry) safeEmit({ scope: 'active-public-store', level: 'info', code: 'SOURCE_COVERAGE_TELEMETRY_RESTORED' });
      lastTelemetry = null;
      const output = [];
      for (const row of body.sources) {
        const feed = feeds.find(f => f.id === row.source);
        const current = assessSourceCoverage(row, { dbNow: body.dbNow, feed });
        const state = advanceCoverageAlert(states.get(row.source), current, now());
        states.set(row.source, state);
        const summary = { ...current, level: state.level, recoverySuccesses: state.successes,
          dbNow: body.dbNow, scope: 'active-public-store', sports: row.sports || [] };
        delete summary.recoveryObservation;
        if (state.emit) safeEmit(summary);
        output.push(summary);
      }
      // A source present in a previous read must not silently vanish.
      for (const source of states.keys()) if (!seen.has(source)) {
        const current = { source, level: 'unknown', reason: 'source_missing_from_aggregate', freshShare: null };
        const state = advanceCoverageAlert(states.get(source), current, now());
        states.set(source, state);
        if (state.emit) safeEmit({ ...current, scope: 'active-public-store', dbNow: body.dbNow });
      }
      return { ok: true, dbNow: body.dbNow, sources: output };
    } catch { return unknown('SOURCE_COVERAGE_READ_FAILED'); }
    finally {
      clearTimeout(timer);
      try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch {}
      controller.abort();
    }
  }
  return { observe(feeds = []) {
    if (pending) return pending;
    if (now() < nextAt) return Promise.resolve({ skipped: true });
    nextAt = now() + Math.max(60_000, intervalMs);
    pending = read(feeds).finally(() => { pending = null; });
    return pending;
  } };
}
