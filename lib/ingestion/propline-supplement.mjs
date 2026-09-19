import { proplineConfigured, proplineQuota, proplineHealth, proplineReserve } from '../data-sources/propline/client.mjs';
import { fetchBoard as fetchPropLineBoard, probePropLine, proplineMarketsForSport, PROPLINE_SPORTS } from '../autoscout/providers/propline.mjs';
import { coverageRequestBudget, sportRefreshDelaySeconds } from '../data-sources/propline/slate-coverage.mjs';

const text = (value) => String(value ?? '').trim();
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());
const DEFAULT_SPORTS = Object.freeze(['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS']);
const supported = new Set(PROPLINE_SPORTS);

const state = {
  running: false,
  startedAt: null,
  nextAt: 0,
  cursor: 0,
  cycles: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastSport: null,
  lastError: null,
  lastCoverage: null,
  boards: new Map(),
  sportNextAt: new Map(),
};

function configuredSports() {
  const raw = text(process.env.PROPLINE_SUPPLEMENT_SPORTS);
  const rows = (raw ? raw.split(',') : DEFAULT_SPORTS)
    .map((value) => text(value).toUpperCase())
    .filter((sport) => supported.has(sport) && proplineMarketsForSport(sport).length);
  return [...new Set(rows)];
}

export function proplineSupplementEnabled() {
  return truthy(process.env.PROPLINE_SUPPLEMENT_ENABLED) && proplineConfigured();
}

// Keep the established tier/reserve contracts. Large accounts additionally use
// the quota-paced slate sweep below; this eventLimit still governs legacy and
// small-tier calls, so their polling/budgets are not widened incidentally.
export function proplineSupplementPolicy(quota = proplineQuota()) {
  const limit = Number(quota?.limit);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { tier: quota?.tier || 'unknown', intervalSeconds: 900, eventLimit: 2, sportsPerCycle: 1, reserve: 100, maxAgeSeconds: 10_800 };
  }
  if (limit <= 1_000) return { tier: quota?.tier || 'free', intervalSeconds: 900, eventLimit: 2, sportsPerCycle: 1, reserve: Math.max(100, Math.ceil(limit * 0.10)), maxAgeSeconds: 10_800 };
  if (limit <= 5_000) return { tier: quota?.tier || 'hobby', intervalSeconds: 300, eventLimit: 4, sportsPerCycle: 1, reserve: Math.max(300, Math.ceil(limit * 0.10)), maxAgeSeconds: 5_400 };
  if (limit <= 25_000) return { tier: quota?.tier || 'pro', intervalSeconds: 120, eventLimit: 8, sportsPerCycle: 2, reserve: Math.max(1_000, Math.ceil(limit * 0.10)), maxAgeSeconds: 2_700 };
  if (limit <= 250_000) return { tier: quota?.tier || 'streaming-lite', intervalSeconds: 60, eventLimit: 24, sportsPerCycle: 16, reserve: Math.ceil(limit * 0.10), maxAgeSeconds: 1_200 };
  return { tier: quota?.tier || 'streaming', intervalSeconds: 60, eventLimit: 32, sportsPerCycle: 24, reserve: Math.ceil(limit * 0.10), maxAgeSeconds: 900 };
}

function applySportResult(sport, board, current, policy, sports, now) {
  const coverage = board?.meta?.coverage;
  if (board?.props?.length) {
    state.boards.set(sport, board);
    if (!coverage || (!board.meta?.refreshError && coverage.succeeded > 0)) state.lastSuccessAt = new Date(now()).toISOString();
    const delay = coverage ? sportRefreshDelaySeconds(policy, sports.length) : policy.intervalSeconds * Math.max(1, sports.length - 1);
    state.sportNextAt.set(sport, current + delay * 1000);
    return;
  }
  // Valid empty snapshots withdraw old offers. A failure must not manufacture
  // an empty replacement; the collector retains valid prior event snapshots.
  if (coverage && !board.meta?.refreshError) state.boards.delete(sport);
  if (coverage && !coverage.complete) {
    state.sportNextAt.set(sport, current + policy.intervalSeconds * 1000);
    return;
  }
  const events = Number(board?.meta?.eventsAvailable || 0);
  const nextEventAt = Date.parse(board?.meta?.nextEventAt || '');
  let waitSeconds = events > 0 ? 30 * 60 : 6 * 60 * 60;
  if (Number.isFinite(nextEventAt)) {
    const horizonHours = Math.min(336, Math.max(1, Math.floor(Number(process.env.PROPLINE_EVENT_HORIZON_HOURS)) || 48));
    const untilInRange = Math.floor((nextEventAt - horizonHours * 3_600_000 - current) / 1000);
    waitSeconds = Math.min(12 * 60 * 60, Math.max(waitSeconds, untilInRange));
  }
  state.sportNextAt.set(sport, current + waitSeconds * 1000);
}

function nextSport(sports, now) {
  if (!sports.length) return null;
  for (let offset = 0; offset < sports.length; offset += 1) {
    const index = (state.cursor + offset) % sports.length;
    const sport = sports[index];
    if ((state.sportNextAt.get(sport) || 0) <= now) {
      state.cursor = (index + 1) % sports.length;
      return sport;
    }
  }
  return null;
}

function pauseUntilReset(quota, now) {
  const reset = Date.parse(quota?.resetAt || '');
  return Number.isFinite(reset) && reset > now ? reset + 5_000 : now + 60 * 60 * 1000;
}

/** Single-owner entrypoint. No second timer/lease/provider scheduler is added. */
export async function maybeRefreshProplineSupplement({ now = Date.now } = {}) {
  if (!proplineSupplementEnabled()) return { skipped: true, reason: 'disabled_or_unconfigured' };
  if (state.running) return { skipped: true, reason: 'already_running' };
  const current = now();
  if (state.nextAt > current) return { skipped: true, reason: 'not_due', nextAt: new Date(state.nextAt).toISOString() };

  state.running = true;
  state.startedAt ||= new Date(current).toISOString();
  state.lastAttemptAt = new Date(current).toISOString();
  let deadlineTimer;
  try {
    const beforeProbe = proplineQuota();
    const expiredWindow = Number.isFinite(Date.parse(beforeProbe?.resetAt || '')) && Date.parse(beforeProbe.resetAt) <= current;
    if (!(Number(beforeProbe?.limit) > 0) || expiredWindow) {
      // A new quota day must be observed, not treated as an invented reset to
      // 250k; one shared probe replaces the expired header observation.
      await probePropLine({ bypassCache: expiredWindow });
    }

    const quota = proplineQuota();
    const policy = proplineSupplementPolicy(quota);
    const remaining = quota.remaining == null ? null : Number(quota.remaining);
    if (remaining !== null && Number.isFinite(remaining) && remaining <= Math.max(policy.reserve, proplineReserve())) {
      state.nextAt = pauseUntilReset(quota, current);
      state.lastError = 'PROPLINE_QUOTA_RESERVE';
      return { skipped: true, reason: 'quota_reserve', quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt, tier: quota.tier } };
    }

    const sports = configuredSports();
    const perCycle = Math.min(sports.length, Math.max(1, Number(policy.sportsPerCycle) || 1));
    const refreshed = [];
    for (let slot = 0; slot < perCycle; slot += 1) {
      const pick = nextSport(sports, current);
      if (!pick) break;
      refreshed.push(pick);
    }
    if (!refreshed.length) {
      const nextSportAt = Math.min(...[...state.sportNextAt.values()].filter((value) => value > current));
      state.nextAt = Number.isFinite(nextSportAt) ? nextSportAt : current + policy.intervalSeconds * 1000;
      return { skipped: true, reason: sports.length ? 'sports_backoff' : 'no_markets' };
    }

    const fullSlate = Number(quota.limit) >= 250000;
    const budget = fullSlate ? coverageRequestBudget(quota, { now: current, reserve: Math.max(policy.reserve, proplineReserve()) }) : null;
    if (fullSlate && budget < 2) {
      state.nextAt = current + 300_000;
      return { skipped: true, reason: 'coverage_budget', quota };
    }
    const controller = new AbortController();
    if (fullSlate) deadlineTimer = setTimeout(() => controller.abort(), 120_000);
    let board = null, props = 0, spent = 0;
    const results = [];
    const requestsBefore = proplineHealth().requests;
    for (let index = 0; index < refreshed.length; index += 1) {
      const pick = refreshed[index];
      // Each remaining sport gets a fair share; unused capacity carries forward.
      const requestBudget = fullSlate ? Math.min(129, Math.floor((budget - spent) / (refreshed.length - index))) : null;
      if (fullSlate && (requestBudget < 2 || controller.signal.aborted)) {
        results.push(...refreshed.slice(index).map((sport) => ({ sport, deferred: true, reason: controller.signal.aborted ? 'cycle_deadline' : 'request_budget' })));
        break;
      }
      state.lastSport = pick;
      const countBefore = proplineHealth().requests;
      let picked = null;
      try {
        picked = await fetchPropLineBoard(pick, {
          force: true,
          includeAlternates: false,
          eventLimit: policy.eventLimit,
          ...(fullSlate ? { fullSlate: true, requestBudget, coverageMaxAgeSeconds: policy.maxAgeSeconds, signal: controller.signal } : {}),
        });
      } catch (error) {
        state.lastError = String(error?.code || 'PROPLINE_SPORT_FAILED').slice(0, 60);
        spent += Math.max(1, proplineHealth().requests - countBefore);
        results.push({ sport: pick, error: state.lastError });
        state.sportNextAt.set(pick, current + policy.intervalSeconds * 1000);
        continue;
      }
      spent += Math.max(1 + (picked?.meta?.coverage?.requested || 0), proplineHealth().requests - countBefore);
      state.cycles += 1;
      applySportResult(pick, picked, current, policy, sports, now);
      results.push({ sport: pick, eventsAvailable: picked?.meta?.eventsAvailable ?? null, coverage: picked?.meta?.coverage ?? null, props: picked?.props?.length || 0, books: picked?.meta?.sportsbookCount || 0, processRequests: proplineHealth().requests - countBefore, error: picked?.meta?.refreshError || picked?.meta?.failures?.at(-1)?.code || null });
      if (picked?.props?.length) { board = board || picked; props += picked.props.length; }
      const stopCode = picked?.meta?.coverage?.reason;
      if (fullSlate && ['PROPLINE_DAILY_LIMIT','PROPLINE_QUOTA_RESERVE','PROPLINE_BURST_LIMIT','PROPLINE_RATE_LIMITED','PROPLINE_UNAUTHORIZED'].includes(stopCode)) {
        results.push(...refreshed.slice(index + 1).map((sport) => ({ sport, deferred: true, reason: stopCode })));
        break;
      }
    }
    state.lastError = results.find((result) => result.error)?.error || null;
    state.nextAt = current + policy.intervalSeconds * 1000;
    if (fullSlate) {
      const latest = proplineQuota();
      state.lastCoverage = {
        observedAt: new Date(now()).toISOString(),
        configuredSports: sports,
        // This is the configured comparable O/U scope, not all provider sports.
        unpolledMappedSports: PROPLINE_SPORTS.filter((sport) => !sports.includes(sport)),
        requestBudget: budget,
        processRequestsDuringPass: proplineHealth().requests - requestsBefore,
        quota: { limit: latest.limit, used: latest.used, remaining: latest.remaining, resetAt: latest.resetAt, at: latest.at },
        reserve: Math.max(policy.reserve, proplineReserve()),
        sports: results,
      };
      console.log('[PropLine coverage] ' + JSON.stringify(state.lastCoverage));
    }
    return {
      skipped: false,
      sport: state.lastSport,
      sports: refreshed,
      props,
      events: Number(board?.meta?.eventsAvailable || 0),
      reason: null,
      error: state.lastError,
      ...(fullSlate ? { coverage: state.lastCoverage } : {}),
    };
  } catch (error) {
    const code = text(error?.code || error?.name || 'PROPLINE_SUPPLEMENT_FAILED');
    state.lastError = code;
    const quota = proplineQuota();
    const policy = proplineSupplementPolicy(quota);
    if (code === 'PROPLINE_DAILY_LIMIT') state.nextAt = pauseUntilReset(quota, current);
    else state.nextAt = current + (code === 'PROPLINE_BURST_LIMIT' || code === 'PROPLINE_RATE_LIMITED' ? 120 : policy.intervalSeconds) * 1000;
    return { skipped: false, error: code };
  } finally {
    clearTimeout(deadlineTimer);
    state.running = false;
  }
}

function identity(row) {
  const player = text(row?.playerName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const market = text(row?.marketId || row?.market).toLowerCase();
  const book = text(row?.sportsbookKey).toLowerCase();
  const side = text(row?.side).toUpperCase();
  const start = Date.parse(row?.gameStartTime || '');
  if (!player || !market || !book || !['OVER','UNDER'].includes(side) || !Number.isFinite(start)) return null;
  // Round only for identity. Providers can differ by a few seconds in scheduled
  // timestamps while still describing the same game and player market.
  return [text(row?.sport).toUpperCase(), player, market, book, side, Math.round(start / 60_000)].join('|');
}

export function mergeCachedPropline(board, sport, { now = Date.now } = {}) {
  const selected = text(sport).toUpperCase();
  const supplement = state.boards.get(selected);
  if (!supplement?.props?.length) return board;

  const policy = proplineSupplementPolicy();
  const fetched = Date.parse(supplement?.meta?.fetchedAt || supplement?.meta?.ingestionTimestamp || '');
  if (!Number.isFinite(fetched) || now() - fetched > policy.maxAgeSeconds * 1000) return board;

  const baseProps = Array.isArray(board?.props) ? board.props : [];
  const occupied = new Set(baseProps.map(identity).filter(Boolean));
  const accepted = [];
  for (const row of supplement.props) {
    if (row?.isAlternate === true || Date.parse(row?.gameStartTime || '') <= now()) continue;
    const key = identity(row);
    if (!key || occupied.has(key)) continue;
    occupied.add(key);
    accepted.push(row);
  }
  if (!accepted.length) {
    return { ...board, meta: { ...(board?.meta || {}), proplineSupplement: { cached: true, added: 0, fetchedAt: supplement.meta?.fetchedAt || null } } };
  }

  const acceptedLineIds = new Set(accepted.map((row) => row.id));
  const supplementLines = (supplement.data?.lines || []).filter((row) => acceptedLineIds.has(row.id));
  const propIds = new Set(supplementLines.map((row) => row.propId));
  const supplementProps = (supplement.data?.props || []).filter((row) => propIds.has(row.propId || row.id));
  const playerIds = new Set(supplementProps.map((row) => row.playerId));
  const eventIds = new Set(supplementProps.map((row) => row.eventId));
  const supplementPlayers = (supplement.data?.players || []).filter((row) => playerIds.has(row.id));
  const supplementEvents = (supplement.data?.events || []).filter((row) => eventIds.has(row.id));

  const baseData = board?.data || {};
  const data = {
    events: [...new Map([...supplementEvents, ...(baseData.events || [])].map((row) => [row.id, row])).values()],
    players: [...new Map([...supplementPlayers, ...(baseData.players || [])].map((row) => [row.id, row])).values()],
    props: [...new Map([...supplementProps, ...(baseData.props || [])].map((row) => [row.id, row])).values()],
    lines: [...new Map([...supplementLines, ...(baseData.lines || [])].map((row) => [row.id, row])).values()],
  };
  const props = [...baseProps, ...accepted];
  const books = [...new Set(props.map((row) => text(row.sportsbookKey).toLowerCase()).filter(Boolean))].sort();

  return {
    ...board,
    props,
    data,
    meta: {
      ...(board?.meta || {}),
      sportsbooks: books,
      sportsbookCount: books.length,
      lineCount: props.filter((row) => row.isAlternate !== true).length,
      propCount: data.props.length,
      events: data.events.length,
      supplemental: true,
      proplineSupplement: {
        cached: true,
        added: accepted.length,
        fetchedAt: supplement.meta?.fetchedAt || null,
        tier: proplineQuota()?.tier || null,
        ...(supplement.meta?.coverage ? { stale: supplement.meta.stale === true, coverage: supplement.meta.coverage } : {}),
      },
    },
  };
}

export function proplineSupplementHealth() {
  const quota = proplineQuota();
  const policy = proplineSupplementPolicy(quota);
  return {
    configured: proplineConfigured(),
    enabled: proplineSupplementEnabled(),
    running: state.running,
    startedAt: state.startedAt,
    cycles: state.cycles,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastSport: state.lastSport,
    lastError: state.lastError,
    nextAt: state.nextAt ? new Date(state.nextAt).toISOString() : null,
    cachedSports: [...state.boards.keys()],
    policy,
    quota: { limit: quota.limit, used: quota.used, remaining: quota.remaining, resetAt: quota.resetAt, tier: quota.tier },
    coverage: state.lastCoverage,
  };
}

export function __resetProplineSupplement() {
  state.running = false;
  state.startedAt = null;
  state.nextAt = 0;
  state.cursor = 0;
  state.cycles = 0;
  state.lastAttemptAt = null;
  state.lastSuccessAt = null;
  state.lastSport = null;
  state.lastError = null;
  state.lastCoverage = null;
  state.boards.clear();
  state.sportNextAt.clear();
}
