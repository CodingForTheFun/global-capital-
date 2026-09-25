// Daily self-training loop for the global model.
//
// Each cycle, per sport: pull resolved props since the last pull, then walk
// backwards through the archive a window at a time (newest first, so recent
// seasons arrive before old ones) until the per-cycle export budget is spent.
// Every sport that gained data is retrained, and the result is promoted only
// when the gate in model.mjs passes against the market and the current
// champion. A failed or rejected run leaves the champion serving.
//
// One process, one cycle at a time, one export call per window, and no
// retries inside a cycle: the next day's cycle is the retry.
import { SPORT_KEYS } from '../../data-sources/propline/markets.mjs';
import { fetchResolvedWindow } from './export.mjs';
import { buildRows, trainAndEvaluate, pushRates, MODEL_VERSION, FEATURES } from './model.mjs';
import { readObservations, writeObservations, mergeObservations, readArtifact, writeArtifact, readState, writeState, globalModelDir } from './store.mjs';

const DAY = 86_400_000;
export const TRAINING_POLICY = Object.freeze({
  maxExportCallsPerCycle: 60,
  /** Leave this many export calls for anything else using the same key today. */
  exportReserve: 15,
  lookbackDays: 365,
  defaultWindowDays: 7,
  minWindowDays: 1,
  firstRunDelayMs: 10 * 60_000,
  intervalMs: DAY,
  /** While the archive is still being backfilled, cycles come sooner; the daily export cap still bounds them. */
  backfillIntervalMs: 3 * 3600_000,
});

const iso = ms => new Date(ms).toISOString();
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

function sportState(state, sport, now) {
  const s = state.sports[sport] || (state.sports[sport] = {});
  if (!Number.isFinite(Date.parse(s.incrementalThrough || ''))) s.incrementalThrough = null;
  if (!Number.isFinite(Date.parse(s.backfillThrough || ''))) s.backfillThrough = null;
  if (!(s.windowDays >= TRAINING_POLICY.minWindowDays)) s.windowDays = TRAINING_POLICY.defaultWindowDays;
  // tierFloor is the plan's earliest exportable date, learned only when
  // PropLine clamps a request (see pull). The older windowStart field held
  // the requested start and must not be read as a floor.
  delete s.windowStart;
  s.floor = Math.max(now - TRAINING_POLICY.lookbackDays * DAY, Date.parse(s.tierFloor || '') || 0);
  return s;
}

/**
 * One cycle. Returns a summary; never throws for provider or data problems.
 * `fetchWindow` and `dir` are injectable for tests.
 */
export async function runTrainingCycle({
  sports = Object.keys(SPORT_KEYS),
  now = Date.now(),
  dir = globalModelDir(),
  fetchWindow = fetchResolvedWindow,
  policy = TRAINING_POLICY,
} = {}) {
  const state = await readState(dir);
  state.sports ||= {};
  const gained = new Map();
  const log = [];
  let calls = 0, stop = null;

  async function pull(sport, since, until) {
    const s = state.sports[sport];
    calls += 1;
    const result = await fetchWindow({ sportKey: SPORT_KEYS[sport], since, until });
    // X-PropLine-Export-Window-Start is the effective start of this request:
    // the requested since, or the plan's floor when the request asked for
    // more history than the plan allows. Only the second case is a floor.
    const windowStart = Date.parse(result.meta?.windowStart || '');
    if (Number.isFinite(windowStart) && windowStart > since + 60_000) s.tierFloor = new Date(windowStart).toISOString();
    const remaining = Number(result.meta?.dailyRemaining);
    if (Number.isFinite(remaining) && remaining <= policy.exportReserve) stop = 'EXPORT_RESERVE';
    if (!result.ok) {
      log.push({ sport, since: iso(since), until: iso(until), code: result.code });
      if (result.code === 'EXPORT_WINDOW_TOO_LARGE') s.windowDays = Math.max(policy.minWindowDays, Math.floor(s.windowDays / 2));
      if (['EXPORT_DAILY_CAP', 'EXPORT_NOT_ENTITLED', 'PROPLINE_NOT_CONFIGURED', 'PROPLINE_DISABLED_BY_PROVIDER_MODE'].includes(result.code)) stop = result.code;
      return null;
    }
    gained.set(sport, [...(gained.get(sport) || []), ...result.observations]);
    log.push({ sport, since: iso(since), until: iso(until), observations: result.observations.length, rows: result.stats?.rows });
    return result;
  }

  // 1) Incremental: everything resolved since the last successful pull.
  for (const sport of sports) {
    if (stop || calls >= policy.maxExportCallsPerCycle) break;
    const s = sportState(state, sport, now);
    const since = s.incrementalThrough ? Date.parse(s.incrementalThrough) - DAY : now - 2 * DAY;
    if (await pull(sport, since, now)) {
      s.incrementalThrough = iso(now);
      if (!s.backfillThrough) s.backfillThrough = iso(since);
    }
  }

  // 2) Backfill, round-robin across sports so no sport starves the others.
  let progressed = true;
  while (!stop && progressed && calls < policy.maxExportCallsPerCycle) {
    progressed = false;
    for (const sport of sports) {
      if (stop || calls >= policy.maxExportCallsPerCycle) break;
      const s = sportState(state, sport, now);
      if (!s.backfillThrough) continue;
      const until = Date.parse(s.backfillThrough);
      if (until <= s.floor) continue;
      const since = Math.max(s.floor, until - s.windowDays * DAY);
      progressed = true;
      if (await pull(sport, since, until)) s.backfillThrough = iso(since);
    }
  }

  // 3) Merge and retrain every sport that gained data (or has none trained yet).
  const trained = [];
  for (const sport of sports) {
    const incoming = gained.get(sport) || [];
    const existingArtifact = await readArtifact(sport, dir);
    if (!incoming.length && existingArtifact) continue;
    let observations = await readObservations(sport, dir);
    if (incoming.length) {
      observations = mergeObservations(observations, incoming, { now });
      await writeObservations(sport, observations, dir);
    }
    if (!observations.length) continue;
    await yieldToEventLoop();
    const rows = buildRows(observations);
    const result = trainAndEvaluate(rows, { champion: existingArtifact });
    const s = sportState(state, sport, now);
    s.observations = observations.length;
    s.lastEvaluation = { at: iso(now), promote: result.promote, reasons: result.reasons, regimes: result.regimes, metrics: result.metrics };
    if (result.promote) {
      await writeArtifact(sport, {
        sport, version: MODEL_VERSION, features: FEATURES, weights: result.weights, regimes: result.regimes,
        pushRates: pushRates(observations), trainedAt: iso(now), observations: observations.length,
        dataThrough: iso(observations[observations.length - 1].t), metrics: result.metrics,
      }, dir);
    }
    trained.push({ sport, promote: result.promote, reasons: result.reasons });
    await yieldToEventLoop();
  }

  const backfillPending = sports.some(sport => {
    const s = state.sports[sport];
    return s?.backfillThrough && Date.parse(s.backfillThrough) > (s.floor ?? 0) + DAY;
  });
  state.lastCycle = { at: iso(now), exportCalls: calls, stop, backfillPending, pulls: log.slice(-80), trained };
  await writeState(state, dir);
  return state.lastCycle;
}

let timer = null, running = false;

/** Starts the daily loop once per process. ML_GLOBAL_TRAINING=off disables it. */
export function startGlobalTraining({ env = process.env, onCycle = () => {} } = {}) {
  if (timer || String(env.ML_GLOBAL_TRAINING || '').toLowerCase() === 'off') return false;
  if (!String(env.PROPLINE_API_KEY || '').trim()) return false;
  const tick = async () => {
    if (running) return null;
    running = true;
    try { const summary = await runTrainingCycle(); onCycle(summary); return summary; }
    catch (error) { onCycle({ error: String(error?.message || error).slice(0, 200) }); return null; }
    finally { running = false; }
  };
  timer = setTimeout(async function loop() {
    const summary = await tick();
    // Backfill runs every few hours until the archive is in; a cycle that hit
    // the daily cap or reserve waits the full day.
    const soon = summary?.backfillPending && !['EXPORT_DAILY_CAP', 'EXPORT_RESERVE'].includes(summary?.stop);
    timer = setTimeout(loop, soon ? TRAINING_POLICY.backfillIntervalMs : TRAINING_POLICY.intervalMs);
    timer.unref?.();
  }, TRAINING_POLICY.firstRunDelayMs);
  timer.unref?.();
  return true;
}
