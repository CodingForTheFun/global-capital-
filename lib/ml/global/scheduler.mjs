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
import { buildRows, trainAndEvaluate, evaluateWeights, splitHoldout, fitLogisticAsync, pushRates, MODEL_VERSION, FEATURES, PROMOTION_POLICY } from './model.mjs';
import { readObservations, writeObservations, mergeObservations, readArtifact, writeArtifact, readState, writeState, readEnrich, writeEnrich, globalModelDir } from './store.mjs';

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
  /** MLB box scores looked up per cycle (ESPN, free and cached); the rest wait for later cycles. */
  maxEnrichPerCycle: 150,
  /** An unmatched game is tried again after this long. */
  enrichRetryMs: 14 * DAY,
});

/** Box-score facts for MLB games not yet looked up, newest first, within the per-cycle cap. */
export async function enrichGames(observations, map, { getEnricher, now, max }) {
  const seen = new Set();
  const due = [];
  for (let i = observations.length - 1; i >= 0 && due.length < max; i--) {
    const o = observations[i];
    if (!o.h || !o.v || seen.has(o.e)) continue;
    seen.add(o.e);
    const prior = map[o.e];
    if (prior && (prior.f || now - (prior.at || 0) < TRAINING_POLICY.enrichRetryMs)) continue;
    due.push(o);
  }
  let added = 0;
  if (!due.length) return { looked: 0, added };
  const enricher = await getEnricher();
  const queue = [...due];
  async function worker() {
    while (queue.length) {
      const game = queue.shift();
      let facts = null;
      try { facts = await enricher.enrich(game); } catch { facts = null; }
      map[game.e] = { f: facts, at: now };
      if (facts) added += 1;
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { looked: due.length, added };
}

let defaultEnricher = null;
async function mlbEnricher() {
  if (!defaultEnricher) {
    const [{ fetchPublicResearch }, { createMlbEnricher }] = await Promise.all([
      import('../../data-sources/espn/research.mjs'), import('./mlb-enrich.mjs'),
    ]);
    defaultEnricher = createMlbEnricher(fetchPublicResearch.espn);
  }
  return defaultEnricher;
}

const iso = ms => new Date(ms).toISOString();
const day = value => (Number.isFinite(Date.parse(value || '')) ? new Date(Date.parse(value)).toISOString().slice(0, 10) : null);
const r4 = value => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null);

/**
 * One line of numbers per sport for the training log: how much data there
 * is, what the holdout held, how the model scored against its baselines, and
 * how far back the archive reaches. Nothing here changes a decision.
 */
/** The decision numbers of one evaluation, compactly: Brier deltas and their evidence bounds. */
export function compactMetrics(metrics) {
  const wm = metrics?.withMarket || {}, wo = metrics?.withoutMarket || {};
  const bound = (d) => (d ? [d.games ?? 0, r4(d.delta), r4(d.upper)] : null);
  return {
    holdoutGames: metrics?.holdoutEvents ?? null,
    // [games, mean Brier difference, 90% upper bound]; negative is better than the baseline.
    vsMarket: bound(wm.delta),
    vsHitRate: bound(wo.deltaHitRate),
    vsCoin: bound(wo.deltaCoin),
    calibration: [r4(metrics?.calibration?.ece), r4(metrics?.calibration?.noise95)],
  };
}

export function cycleDiagnostics(observations, metrics, s, enrich = null) {
  const first = observations[0]?.t, last = observations[observations.length - 1]?.t;
  const wm = metrics?.withMarket || {}, wo = metrics?.withoutMarket || {};
  return {
    obs: observations.length,
    from: Number.isFinite(first) ? iso(first).slice(0, 10) : null,
    to: Number.isFinite(last) ? iso(last).slice(0, 10) : null,
    games: new Set(observations.map(o => o.e)).size,
    withTeams: observations.filter(o => o.h && o.v).length,
    train: metrics?.trainRows ?? null,
    holdout: metrics?.holdoutRows ?? null,
    holdoutGames: metrics?.holdoutEvents ?? null,
    // [rows, model Brier, baseline Brier(s)]
    withMarket: [wm.model?.n ?? 0, r4(wm.model?.brier), r4(wm.market?.brier)],
    withoutMarket: [wo.model?.n ?? 0, r4(wo.model?.brier), r4(wo.hitRate?.brier), r4(wo.coinFlip?.brier)],
    calibration: r4(metrics?.all?.calibrationError),
    evidence: compactMetrics(metrics),
    archive: { floor: Number.isFinite(s?.floor) ? iso(s.floor).slice(0, 10) : null, backfillThrough: day(s?.backfillThrough), tierFloor: day(s?.tierFloor) },
    ...(enrich ? { boxScores: Object.values(enrich).filter(v => v && v.f).length } : {}),
  };
}
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
  // Observations saved before v2 lack the game's teams and scores. Walk the
  // archive once more, newest first, so re-exported windows replace them; the
  // per-cycle export cap and reserve still bound it.
  if (s.contextBackfill !== 2) {
    s.backfillThrough = s.incrementalThrough || iso(now);
    s.contextBackfill = 2;
  }
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
  enricher = null,
} = {}) {
  const state = await readState(dir);
  state.sports ||= {};
  const gained = new Map();
  const log = [];
  let calls = 0, stop = null, exportRemaining = null;

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
    if (Number.isFinite(remaining)) exportRemaining = remaining;
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

  // 3) Merge new data and build every sport's rows. A sport with nothing new
  //    and a serving model is not re-decided, but its rows still teach the
  //    pooled model below.
  const prepared = [];
  for (const sport of sports) {
    const incoming = gained.get(sport) || [];
    const existingArtifact = await readArtifact(sport, dir);
    let observations = await readObservations(sport, dir);
    if (incoming.length) observations = mergeObservations(observations, incoming, { now });
    // MLB also re-decides when new box-score facts arrived, even with no new props.
    let enrich = null, enriched = 0;
    if (sport === 'MLB') {
      enrich = await readEnrich(sport, dir);
      try {
        const result = await enrichGames(observations, enrich, { getEnricher: async () => enricher || mlbEnricher(), now, max: policy.maxEnrichPerCycle ?? TRAINING_POLICY.maxEnrichPerCycle });
        enriched = result.added;
        if (result.looked) await writeEnrich(sport, enrich, dir);
        log.push({ sport, enrich: result });
      } catch { /* box-score facts are an enhancement; training goes on without new ones */ }
    }
    if (incoming.length) await writeObservations(sport, observations, dir);
    if (!observations.length) continue;
    await yieldToEventLoop();
    const rows = buildRows(observations, { enrich });
    prepared.push({
      sport, observations, rows, enrich, existingArtifact,
      split: splitHoldout(rows),
      decide: Boolean(incoming.length || enriched || !existingArtifact),
    });
    await yieldToEventLoop();
  }

  // 4) One model for every sport, as a challenger. For each sport it learns
  //    from every sport's games that started before that sport's test games,
  //    never from the test games or anything after them, then faces the same
  //    gates as the sport's own model. The better of the two that passes
  //    serves the sport; with neither, nothing changes. Sports with little
  //    data borrow what the others teach.
  const allRows = prepared.flatMap(p => p.rows);
  let pooledFinal;
  const trained = [];
  for (const p of prepared) {
    if (!p.decide) continue;
    const { sport, observations, enrich, existingArtifact } = p;
    const testStart = p.split.holdout.length ? p.split.holdout[0].t : -Infinity;
    const pooledTrain = allRows.filter(r => r.t < testStart);
    const pooledFit = pooledTrain.length >= 200 ? await fitLogisticAsync(pooledTrain) : null;
    // Two candidates are two chances to pass by luck, so each is held to half
    // the error rate (the 95% bound instead of 90%): together they still pass
    // a model with no real edge no more often than one candidate did.
    const gate = pooledFit ? { ...PROMOTION_POLICY, evidenceQuantile: 1 - (1 - PROMOTION_POLICY.evidenceQuantile) / 2 } : PROMOTION_POLICY;
    const own = trainAndEvaluate(p.rows, { champion: existingArtifact, policy: gate });
    await yieldToEventLoop();
    const pooled = pooledFit ? evaluateWeights(pooledFit, p.split.holdout, { policy: gate, champion: existingArtifact, trainRows: pooledTrain.length }) : null;
    let chosen = own.promote ? 'sport' : null;
    if (pooled && !pooled.reasons.length && (!chosen || pooled.metrics.all.brier < own.metrics.all.brier)) chosen = 'pooled';
    let weights = chosen === 'sport' ? own.weights : null;
    if (chosen === 'pooled') {
      // Refit once on every row of every sport, as a sport model is refit on all of its rows.
      if (pooledFinal === undefined) pooledFinal = await fitLogisticAsync(allRows);
      weights = pooledFinal;
      if (!weights) chosen = null;
    }
    const decision = chosen === 'pooled' ? pooled : own;
    const s = sportState(state, sport, now);
    s.observations = observations.length;
    s.lastEvaluation = {
      // reasons and metrics are the sport's own model's; pooled holds the challenger's.
      at: iso(now), promote: Boolean(chosen), chosen, reasons: own.reasons, regimes: decision.regimes, metrics: own.metrics,
      pooled: pooled ? { reasons: pooled.reasons, regimes: pooled.regimes, metrics: pooled.metrics } : null,
    };
    if (chosen) {
      await writeArtifact(sport, {
        sport, version: MODEL_VERSION, source: chosen, features: FEATURES, weights, regimes: decision.regimes,
        pushRates: pushRates(observations), trainedAt: iso(now), observations: observations.length,
        dataThrough: iso(observations[observations.length - 1].t), metrics: decision.metrics,
      }, dir);
    }
    const lastPull = log.filter(entry => entry.sport === sport && ('code' in entry || 'observations' in entry)).at(-1) || null;
    trained.push({
      sport, promote: Boolean(chosen), chosen, reasons: own.reasons, pooledReasons: pooled ? pooled.reasons : null,
      diag: { ...cycleDiagnostics(observations, own.metrics, s, enrich), pooled: pooled ? compactMetrics(pooled.metrics) : null, lastPull },
    });
    await yieldToEventLoop();
  }

  const backfillPending = sports.some(sport => {
    const s = state.sports[sport];
    return s?.backfillThrough && Date.parse(s.backfillThrough) > (s.floor ?? 0) + DAY;
  });
  state.lastCycle = { at: iso(now), exportCalls: calls, exportRemaining, stop, backfillPending, pulls: log.slice(-80), trained };
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
