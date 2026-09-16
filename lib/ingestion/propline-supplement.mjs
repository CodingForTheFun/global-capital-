import { proplineConfigured, proplineQuota } from '../data-sources/propline/client.mjs';
import { fetchBoard as fetchPropLineBoard, probePropLine, proplineMarketsForSport, PROPLINE_SPORTS } from '../autoscout/providers/propline.mjs';

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

/**
 * Request policy based on the daily limit PropLine reports on every response.
 * Each cycle refreshes one sport only. With the defaults below a Free key uses
 * at most ~288 requests/day before cache hits (96 cycles x event list + 2 event
 * odds calls), while larger tiers scale up without ever treating the allowance
 * as unlimited.
 */
export function proplineSupplementPolicy(quota = proplineQuota()) {
  const limit = Number(quota?.limit);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { tier: quota?.tier || 'unknown', intervalSeconds: 900, eventLimit: 2, sportsPerCycle: 1, reserve: 100, maxAgeSeconds: 10_800 };
  }
  if (limit <= 1_000) return { tier: quota?.tier || 'free', intervalSeconds: 900, eventLimit: 2, sportsPerCycle: 1, reserve: Math.max(100, Math.ceil(limit * 0.10)), maxAgeSeconds: 10_800 };
  if (limit <= 5_000) return { tier: quota?.tier || 'hobby', intervalSeconds: 300, eventLimit: 4, sportsPerCycle: 1, reserve: Math.max(300, Math.ceil(limit * 0.10)), maxAgeSeconds: 5_400 };
  if (limit <= 25_000) return { tier: quota?.tier || 'pro', intervalSeconds: 120, eventLimit: 8, sportsPerCycle: 2, reserve: Math.max(1_000, Math.ceil(limit * 0.10)), maxAgeSeconds: 2_700 };
  // Twelve events per sport covers a weeknight but truncates the slates that
  // matter most: an NFL Sunday is sixteen games and an NCAAF Saturday many more,
  // so the events beyond the cap simply never appeared on the board. Twenty-four
  // covers a full NFL slate and the meaningful part of a college one.
  //
  // The cost is bounded and small. Each sport comes round every
  // intervalSeconds x (sports - 1), about eleven minutes for twelve sports, so
  // raising the cap from twelve to twenty-four moves a streaming-lite key from
  // roughly 20,000 to 39,000 requests a day - from 9% to 17% of the allowance
  // left after the 10% reserve. The reserve itself is untouched.
  if (limit <= 250_000) return { tier: quota?.tier || 'streaming-lite', intervalSeconds: 60, eventLimit: 24, sportsPerCycle: 16, reserve: Math.ceil(limit * 0.10), maxAgeSeconds: 1_200 };
  return { tier: quota?.tier || 'streaming', intervalSeconds: 60, eventLimit: 32, sportsPerCycle: 24, reserve: Math.ceil(limit * 0.10), maxAgeSeconds: 900 };
}

/**
 * Record one sport's outcome and decide when it is next due.
 *
 * Extracted so every sport in a slice is treated identically to the way a
 * single sport was, rather than the first one getting different handling.
 */
function applySportResult(sport, board, current, policy, sports, now) {
  if (board?.props?.length) {
    state.boards.set(sport, board);
    state.lastSuccessAt = new Date(now()).toISOString();
    state.sportNextAt.set(sport, current + policy.intervalSeconds * 1000 * Math.max(1, sports.length - 1));
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

/**
 * Single-owner refresh entry point. The existing persistence scheduler calls
 * this frequently, but upstream requests happen only when nextAt is due.
 */
export async function maybeRefreshProplineSupplement({ now = Date.now } = {}) {
  if (!proplineSupplementEnabled()) return { skipped: true, reason: 'disabled_or_unconfigured' };
  if (state.running) return { skipped: true, reason: 'already_running' };
  const current = now();
  if (state.nextAt > current) return { skipped: true, reason: 'not_due', nextAt: new Date(state.nextAt).toISOString() };

  state.running = true;
  state.startedAt ||= new Date(current).toISOString();
  state.lastAttemptAt = new Date(current).toISOString();
  try {
    // One cheap probe establishes the tier and daily allowance. After that the
    // per-event responses keep the same counters current.
    if (!Number.isFinite(Number(proplineQuota()?.limit))) {
      await probePropLine();
    }

    const quota = proplineQuota();
    const policy = proplineSupplementPolicy(quota);
    const remaining = Number(quota?.remaining);
    if (Number.isFinite(remaining) && remaining <= policy.reserve) {
      state.nextAt = pauseUntilReset(quota, current);
      state.lastError = 'PROPLINE_QUOTA_RESERVE';
      return { skipped: true, reason: 'quota_reserve', quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt, tier: quota.tier } };
    }

    const sports = configuredSports();
    // One sport per invocation was the real ceiling. The scheduler calls this
    // once per persistence cycle - every 300s - so a single sport per call meant
    // twelve sports rotated once an hour and spent 7,200 requests a day: 3% of a
    // 250,000 allowance. The interval below was never the constraint.
    //
    // Refreshing a slice per invocation is what actually uses the subscription.
    // At sixteen, every sport refreshes every five minutes for about half the
    // usable allowance, and the reserve guard in the client still stops it
    // reaching into the last 10%.
    const perCycle = Math.max(1, Number(policy.sportsPerCycle) || 1);
    const refreshed = [];
    for (let slot = 0; slot < perCycle; slot += 1) {
      const pick = nextSport(sports, current);
      if (!pick) break;
      refreshed.push(pick);
    }
    const sport = refreshed[0] || null;
    if (!sport) {
      const nextSportAt = Math.min(...[...state.sportNextAt.values()].filter((value) => value > current));
      state.nextAt = Number.isFinite(nextSportAt) ? nextSportAt : current + policy.intervalSeconds * 1000;
      return { skipped: true, reason: sports.length ? 'sports_backoff' : 'no_markets' };
    }

    // Each sport in the slice is applied with the same rules the single-sport
    // path used. Sequential rather than parallel on purpose: a burst of sixteen
    // concurrent fetches would spike the upstream and defeat the reserve guard's
    // ability to stop partway.
    let board = null;
    let props = 0;
    for (const pick of refreshed) {
      state.lastSport = pick;
      let picked = null;
      try {
        picked = await fetchPropLineBoard(pick, {
          force: true,
          includeAlternates: false,
          eventLimit: policy.eventLimit,
        });
      } catch (error) {
        // One sport failing must not abandon the rest of the slice.
        state.lastError = String(error?.code || 'PROPLINE_SPORT_FAILED').slice(0, 60);
        state.sportNextAt.set(pick, current + policy.intervalSeconds * 1000);
        continue;
      }
      state.cycles += 1;
      applySportResult(pick, picked, current, policy, sports, now);
      if (picked?.props?.length) { board = board || picked; props += picked.props.length; }
    }
    if (board) {
      state.lastError = board?.meta?.failures?.length ? board.meta.failures.at(-1)?.code || null : null;
      state.nextAt = current + policy.intervalSeconds * 1000;
      return {
        skipped: false,
        sport: state.lastSport,
        sports: refreshed,
        props,
        events: Number(board?.meta?.eventsAvailable || 0),
        reason: null,
        error: state.lastError,
      };
    }
    board = null;

    if (board?.props?.length) {
      state.boards.set(sport, board);
      state.lastSuccessAt = new Date(now()).toISOString();
      state.sportNextAt.set(sport, current + policy.intervalSeconds * 1000 * Math.max(1, sports.length - 1));
    } else {
      // Empty/off-season leagues should not repeatedly spend an event-list call.
      // If events exist but no comparable lines were returned, recheck sooner.
      const events = Number(board?.meta?.eventsAvailable || 0);
      // The provider reports when the soonest out-of-window game starts, so a
      // sport whose next fixture is days away can sleep until that game is
      // nearly in range instead of waking on a fixed timer to learn nothing.
      // Four months of an NBA off-season at six-hourly checks is roughly 480
      // requests spent confirming there is no basketball.
      const nextEventAt = Date.parse(board?.meta?.nextEventAt || '');
      let waitSeconds = events > 0 ? 30 * 60 : 6 * 60 * 60;
      if (Number.isFinite(nextEventAt)) {
        const horizonHours = Math.min(336, Math.max(1, Math.floor(Number(process.env.PROPLINE_EVENT_HORIZON_HOURS)) || 48));
        const horizonMs = horizonHours * 3_600_000;
        const untilInRange = Math.floor((nextEventAt - horizonMs - current) / 1000);
        // Never sooner than the normal backoff, and never so far out that a
        // schedule change upstream goes unnoticed for a day.
        waitSeconds = Math.min(12 * 60 * 60, Math.max(waitSeconds, untilInRange));
      }
      state.sportNextAt.set(sport, current + waitSeconds * 1000);
    }

    state.lastError = board?.meta?.failures?.length ? board.meta.failures.at(-1)?.code || null : null;
    state.nextAt = current + policy.intervalSeconds * 1000;
    return {
      skipped: false,
      sport,
      props: Number(board?.props?.length || 0),
      books: Number(board?.meta?.sportsbookCount || 0),
      events: Number(board?.meta?.events || 0),
      policy,
      quota: { limit: proplineQuota().limit, remaining: proplineQuota().remaining, resetAt: proplineQuota().resetAt, tier: proplineQuota().tier },
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
  const supplementProps = (supplement.data?.props || []).filter((row) => propIds.has(row.id));
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
  state.boards.clear();
  state.sportNextAt.clear();
}
