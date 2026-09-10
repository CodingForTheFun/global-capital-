// Background line ingestion.
//
// Until now the board was only persisted when a visitor's request missed the
// cache, so every stored snapshot landed in one burst and `line_snapshots` was
// a duplicate of `prop_lines` rather than a time series. Line movement — open
// vs current, and the history behind it — cannot exist without writes spread
// over time.
//
// This worker takes a snapshot on a fixed interval so movement accumulates on
// its own, and so the dataset keeps growing whether or not anyone is looking.
//
// The odds provider bills per request, so the worker is deliberately frugal:
// it skips leagues that had no events last time it looked, re-checking them
// only occasionally, and it will not exceed a daily cycle budget.

const bool = (value, fallback) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return text !== 'false' && text !== '0' && text !== 'no';
};
const int = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function ingestConfig() {
  return {
    // OFF by default. frontdoor-clearsports.mjs already schedules a frugal
    // 6-hourly persistence pass; running both would double the odds-provider
    // spend for the same rows. Enable this one only when you want true line
    // movement: it forces a fresh fetch, which is what actually produces
    // history, and it is budgeted and idle-league aware. If you turn it on,
    // turn the other one off.
    enabled: bool(process.env.AUTOSCOUT_INGEST_ENABLED, false),
    intervalMinutes: Math.max(5, int(process.env.AUTOSCOUT_INGEST_INTERVAL_MINUTES, 20)),
    maxCyclesPerDay: int(process.env.AUTOSCOUT_INGEST_MAX_CYCLES_PER_DAY, 96),
    // How many cycles an empty league sits out before being re-checked.
    idleLeagueSkipCycles: int(process.env.AUTOSCOUT_INGEST_IDLE_SKIP_CYCLES, 6),
    sports: String(process.env.AUTOSCOUT_INGEST_SPORTS || '')
      .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  };
}

const state = {
  running: false,
  startedAt: null,
  cycles: 0,
  cyclesToday: 0,
  dayKey: null,
  lastCycleAt: null,
  lastError: null,
  written: { events: 0, players: 0, props: 0, lines: 0, snapshots: 0 },
  leagues: new Map(), // sport -> { lastEvents, emptyStreak, lastAt, lastError }
  timer: null,
};

function today() { return new Date().toISOString().slice(0, 10); }

function rollDay() {
  const key = today();
  if (state.dayKey !== key) { state.dayKey = key; state.cyclesToday = 0; }
}

/**
 * Skip a league that has had nothing on the board, re-checking periodically.
 *
 * The skip counter advances on every skipped cycle, not only on cycles that
 * actually looked. Without that, a league that went quiet once would be
 * skipped forever, because its streak could never move again.
 */
function claimSkip(sport, config) {
  const row = state.leagues.get(sport);
  if (!row || row.emptyStreak <= 0) return false;

  row.skipsSinceCheck = Number(row.skipsSinceCheck || 0) + 1;
  if (row.skipsSinceCheck >= config.idleLeagueSkipCycles) {
    row.skipsSinceCheck = 0;
    return false; // due for another look
  }
  return true;
}

function recordLeague(sport, { events = 0, error = null } = {}) {
  const row = state.leagues.get(sport) || { lastEvents: 0, emptyStreak: 0, skipsSinceCheck: 0, lastAt: null, lastError: null };
  row.lastEvents = events;
  if (events > 0) row.skipsSinceCheck = 0;
  row.emptyStreak = events > 0 ? 0 : row.emptyStreak + 1;
  row.lastAt = new Date().toISOString();
  row.lastError = error;
  state.leagues.set(sport, row);
}

/**
 * One pass over the configured leagues.
 * `deps` is injected so this is testable without network or a database.
 */
export async function runIngestCycle({
  sports, fetchBoard, decorate = (b) => b, persist, log = console,
} = {}) {
  const config = ingestConfig();
  rollDay();

  if (state.cyclesToday >= config.maxCyclesPerDay) {
    return { skipped: true, reason: 'daily cycle budget reached', cyclesToday: state.cyclesToday };
  }

  const targets = (config.sports.length ? config.sports : sports) || [];
  const result = { startedAt: new Date().toISOString(), leagues: [], written: { events: 0, players: 0, props: 0, lines: 0, snapshots: 0 } };

  for (const sport of targets) {
    if (claimSkip(sport, config)) {
      result.leagues.push({ sport, skipped: true, reason: 'no events recently' });
      continue;
    }
    try {
      // force:true — a cache hit writes nothing, which is what kept the table flat.
      const board = decorate(await fetchBoard(sport, { force: true }));
      const events = Number(board?.meta?.events || 0);
      recordLeague(sport, { events });

      if (!events) {
        result.leagues.push({ sport, events: 0, persisted: false });
        continue;
      }
      // persistNormalizedBoard reports { configured, persisted, counts }.
      const outcome = (await persist(board)) || {};
      const counts = outcome.counts || {};
      for (const key of Object.keys(result.written)) {
        result.written[key] += Number(counts[key] || 0);
      }
      if (outcome.persisted === false && outcome.error) {
        recordLeague(sport, { events, error: String(outcome.error).slice(0, 120) });
      }
      result.leagues.push({ sport, events, persisted: outcome.persisted !== false, counts });
    } catch (error) {
      const code = String(error?.code || error?.message || 'INGEST_FAILED').slice(0, 120);
      recordLeague(sport, { events: 0, error: code });
      result.leagues.push({ sport, error: code });
      log?.error?.(`[AutoScout ingest] ${sport} failed code=${code}`);
    }
  }

  state.cycles += 1;
  state.cyclesToday += 1;
  state.lastCycleAt = new Date().toISOString();
  for (const key of Object.keys(state.written)) state.written[key] += result.written[key];
  result.finishedAt = new Date().toISOString();
  return result;
}

export function startIngestWorker({ sports, fetchBoard, decorate, persist, persistenceConfigured, log = console } = {}) {
  const config = ingestConfig();
  if (!config.enabled) { log?.log?.('[AutoScout ingest] disabled by configuration'); return null; }
  if (typeof persistenceConfigured === 'function' && !persistenceConfigured()) {
    log?.log?.('[AutoScout ingest] no database configured; snapshots would be discarded, so the worker is idle');
    return null;
  }
  if (state.running) return state.timer;

  state.running = true;
  state.startedAt = new Date().toISOString();
  const period = config.intervalMinutes * 60 * 1000;

  const tick = async () => {
    try {
      const cycle = await runIngestCycle({ sports, fetchBoard, decorate, persist, log });
      if (!cycle.skipped) {
        const persisted = cycle.leagues.filter((row) => row.persisted).map((row) => row.sport);
        log?.log?.(`[AutoScout ingest] cycle ${state.cycles} leagues=${persisted.join(',') || 'none'} snapshots=${cycle.written.snapshots} lines=${cycle.written.lines}`);
      }
      state.lastError = null;
    } catch (error) {
      state.lastError = String(error?.message || error).slice(0, 200);
      log?.error?.('[AutoScout ingest] cycle failed', state.lastError);
    }
  };

  // The first pass is deferred so it does not compete with server startup.
  const timer = setInterval(() => void tick(), period);
  if (typeof timer.unref === 'function') timer.unref();
  state.timer = timer;
  setTimeout(() => void tick(), 30_000).unref?.();

  log?.log?.(`[AutoScout ingest] every ${config.intervalMinutes}m, up to ${config.maxCyclesPerDay} cycles/day`);
  return timer;
}

export function stopIngestWorker() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
}

/** Owner diagnostics only — this names leagues and counts, never credentials. */
export function ingestHealth() {
  const config = ingestConfig();
  return {
    enabled: config.enabled,
    running: state.running,
    intervalMinutes: config.intervalMinutes,
    startedAt: state.startedAt,
    cycles: state.cycles,
    cyclesToday: state.cyclesToday,
    dailyBudget: config.maxCyclesPerDay,
    lastCycleAt: state.lastCycleAt,
    lastError: state.lastError,
    written: { ...state.written },
    leagues: Object.fromEntries(state.leagues),
  };
}

/** Test seam. */
export function _resetIngestState() {
  stopIngestWorker();
  state.cycles = 0; state.cyclesToday = 0; state.dayKey = null;
  state.lastCycleAt = null; state.lastError = null;
  state.written = { events: 0, players: 0, props: 0, lines: 0, snapshots: 0 };
  state.leagues = new Map(); state.startedAt = null;
}
