import { proplineConfigured, proplineQuota } from '../data-sources/propline/client.mjs';
import { fetchBoard as fetchPropLineBoard, probePropLine, proplineMarketsForSport, PROPLINE_SPORTS } from '../autoscout/providers/propline.mjs';
import { customerPropMaxAgeMs } from './customer-prop-freshness.mjs';
import { normalizedDataFromBoardRows } from './normalize.mjs';

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
    // Never schedule more slots than configured sports: nextSport advances the
    // cursor before sportNextAt is updated, so allowing the slice to wrap would
    // select the first sports twice and waste quota in the same scheduler pass.
    const perCycle = Math.min(sports.length, Math.max(1, Number(policy.sportsPerCycle) || 1));
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
          // PropLine already returns the DFS variants inside this same odds
          // response. Retain them locally so the UI can label Goblin/Demon and
          // Underdog boosts without adding requests, books or markets.
          includeAlternates: true,
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

function periodIdentity(row) {
  const raw = text(row?.period || row?.periodKey).toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw || ['game','full','full_game','fullgame','match','single_stat'].includes(raw)) return 'game';
  const aliases = {
    '1h': 'h1', first_half: 'h1',
    '2h': 'h2', second_half: 'h2',
    '1q': 'q1', first_quarter: 'q1',
    '2q': 'q2', second_quarter: 'q2',
    '3q': 'q3', third_quarter: 'q3',
    '4q': 'q4', fourth_quarter: 'q4',
    '1st_inning': 'first_inning',
  };
  return aliases[raw] || raw;
}

function identity(row) {
  const player = text(row?.playerName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const market = text(row?.marketId || row?.market).toLowerCase();
  const book = text(row?.sportsbookKey).toLowerCase();
  const side = text(row?.side).toUpperCase();
  const start = Date.parse(row?.gameStartTime || '');
  if (!player || !market || !book || !['OVER','UNDER'].includes(side) || !Number.isFinite(start)) return null;
  // Period is part of the quote slot. A 1H line can never suppress or replace a
  // full-game line just because the player, market, book and side are the same.
  return [
    text(row?.sport).toUpperCase(),
    player,
    market,
    periodIdentity(row),
    book,
    side,
    Math.round(start / 60_000),
  ].join('|');
}

function exactQuoteIdentity(row) {
  const base = identity(row);
  const line = row?.line == null || typeof row.line === 'boolean' || text(row.line) === '' ? NaN : Number(row.line);
  if (!base || !Number.isFinite(line)) return null;
  const flavor = text(row?.specialType || row?.dfsOddsType).toLowerCase() || 'standard';
  return [base, line, flavor, Number(row?.payoutMultiplier) || 1].join('|');
}

function comparablePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : text(value);
}

function sameQuote(left, right) {
  const a = Number(left?.line), b = Number(right?.line);
  return Number.isFinite(a) && Number.isFinite(b) && a === b
    && comparablePrice(left?.price) === comparablePrice(right?.price);
}

function primarySlotIndex(rows = []) {
  const index = new Map();
  for (const row of rows) {
    if (row?.isAlternate === true) continue;
    const key = identity(row);
    if (!key) continue;
    if (!index.has(key)) {
      index.set(key, row);
      continue;
    }
    const prior = index.get(key);
    if (prior && !sameQuote(prior, row)) index.set(key, null);
  }
  return index;
}

function gameIdentity(row) {
  const sport = text(row?.sport).toUpperCase();
  const home = text(row?.homeTeam).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const away = text(row?.awayTeam).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const start = Date.parse(row?.gameStartTime || '');
  return sport && home && away && Number.isFinite(start) ? [sport, away, home, Math.round(start / 60_000)].join('|') : null;
}

const EVENT_METADATA_FIELDS = Object.freeze([
  'proplineEventId',
  'providerEventId','homeTeamKey','awayTeamKey','homeTeamProviderId','awayTeamProviderId',
  'homeTeamLogoUrl','awayTeamLogoUrl','espnEventId',
]);

const METADATA_FIELDS = Object.freeze([
  'proplineEventId','proplinePlayerId','proplineOutcomeId',
  'providerEventId','providerPlayerId','providerOutcomeId','bookOutcomeId','bookEventId',
  'homeTeamKey','awayTeamKey','homeTeamProviderId','awayTeamProviderId',
  'homeTeamLogoUrl','awayTeamLogoUrl','espnEventId',
  'dfsOddsType','payoutMultiplier','lineGap','liquidity','liquidityUpdatedAt',
  'bookUpdatedAt','lastChangeAt','lastSeenAt','specialType','specialVerified',
  'specialSideVerified','specialTypeSource','specialSourceId','appLink','deeplink',
]);

function enrichFromPropline(row, source) {
  if (!row || !source) return row;
  const merged = { ...row };
  for (const key of METADATA_FIELDS) {
    const value = source[key];
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
  }

  // Presence and movement are intentionally separate. When PropLine confirms
  // an unchanged exact quote, refresh the observation timestamp from
  // last_seen_at (or the ingestion observation when last_seen_at is absent).
  // changedSnapshots() compares line+price, so this keeps an active unchanged
  // row fresh without manufacturing a line-history change.
  const observedAt = source.lastSeenAt || source.ingestedAt || source.observedAt || null;
  if (observedAt && Number.isFinite(Date.parse(observedAt))) {
    merged.observedAt = observedAt;
    merged.ingestedAt = observedAt;
    merged.presenceSource = 'propline';
  }
  return merged;
}

export function mergeCachedPropline(board, sport, { now = Date.now } = {}) {
  const selected = text(sport).toUpperCase();
  const supplement = state.boards.get(selected);
  if (!supplement?.props?.length) return board;
  if (supplement?.meta?.stale === true) return board;

  const policy = proplineSupplementPolicy();
  const fetched = Date.parse(supplement?.meta?.fetchedAt || supplement?.meta?.ingestionTimestamp || '');
  const serveMaxAgeMs = Math.min(policy.maxAgeSeconds * 1000, customerPropMaxAgeMs());
  if (!Number.isFinite(fetched) || now() - fetched > serveMaxAgeMs) return board;

  const rawBaseProps = Array.isArray(board?.props) ? board.props : [];
  const proplineByExact = new Map();
  const proplineByGame = new Map();
  const proplineBySlot = primarySlotIndex(supplement.props);
  for (const row of supplement.props) {
    const key = exactQuoteIdentity(row);
    if (key) proplineByExact.set(key, row);
    const gameKey = gameIdentity(row);
    if (gameKey && !proplineByGame.has(gameKey)) proplineByGame.set(gameKey, row);
  }

  let prioritized = 0;
  let presenceRefreshed = 0;
  let duplicateBaseSuppressed = 0;
  const transformed = rawBaseProps.map((row) => {
    let merged = row;
    const gameKey = gameIdentity(row), eventSource = gameKey ? proplineByGame.get(gameKey) : null;
    if (eventSource) {
      merged = { ...merged };
      for (const key of EVENT_METADATA_FIELDS) {
        const value = eventSource[key];
        if (value !== null && value !== undefined && value !== '') merged[key] = value;
      }
    }

    // PropLine is the primary current-quote source. For a unique verified
    // player+market+period+book+side slot, a different PropLine line/price
    // replaces the lower-priority row. Identical quotes keep the existing row
    // identity and only receive PropLine presence/metadata.
    if (row?.isAlternate !== true) {
      const slot = identity(row);
      const primary = slot ? proplineBySlot.get(slot) : null;
      if (primary) {
        if (!sameQuote(row, primary)) {
          prioritized += 1;
          return primary;
        }
        const refreshed = enrichFromPropline(merged, primary);
        if (refreshed !== merged) presenceRefreshed += 1;
        return refreshed;
      }
    }

    const exact = exactQuoteIdentity(row), quoteSource = exact ? proplineByExact.get(exact) : null;
    if (quoteSource) {
      const refreshed = enrichFromPropline(merged, quoteSource);
      if (refreshed !== merged) presenceRefreshed += 1;
      return refreshed;
    }
    return merged;
  });

  // Collapse duplicate standard slots after priority selection. Specials remain
  // separate because their variant/line is part of the customer-facing offer.
  const baseProps = [];
  const emittedSlots = new Set();
  for (const row of transformed) {
    if (row?.isAlternate === true) {
      baseProps.push(row);
      continue;
    }
    const slot = identity(row);
    if (slot && emittedSlots.has(slot)) {
      duplicateBaseSuppressed += 1;
      continue;
    }
    if (slot) emittedSlots.add(slot);
    baseProps.push(row);
  }

  const occupied = new Set(baseProps.filter((row) => row?.isAlternate !== true).map(identity).filter(Boolean));
  const specialOccupied = new Set(baseProps.filter((row) => row?.isAlternate === true).map(exactQuoteIdentity).filter(Boolean));
  const accepted = [];
  const acceptedSpecials = [];
  for (const row of supplement.props) {
    if (Date.parse(row?.gameStartTime || '') <= now()) continue;
    if (row?.isAlternate === true) {
      const supportedSpecial = row?.specialVerified === true
        && ((row?.sportsbookKey === 'prizepicks' && ['goblin','demon'].includes(row?.specialType))
          || (row?.sportsbookKey === 'underdog' && Number(row?.payoutMultiplier) > 0 && Number.isFinite(Number(row.payoutMultiplier)) && Number(row.payoutMultiplier) !== 1));
      const exact = exactQuoteIdentity(row);
      if (!supportedSpecial || !exact || specialOccupied.has(exact)) continue;
      specialOccupied.add(exact);
      acceptedSpecials.push(row);
      continue;
    }
    const key = identity(row);
    if (!key || occupied.has(key)) continue;
    occupied.add(key);
    accepted.push(row);
  }

  const acceptedAll = [...accepted, ...acceptedSpecials];
  const props = [...baseProps, ...acceptedAll];

  if (!acceptedAll.length && prioritized === 0 && presenceRefreshed === 0 && duplicateBaseSuppressed === 0) {
    return {
      ...board,
      meta: {
        ...(board?.meta || {}),
        proplineSupplement: {
          cached: true,
          added: 0,
          prioritized: 0,
          presenceRefreshed: 0,
          duplicateBaseSuppressed: 0,
          enriched: 0,
          fetchedAt: supplement.meta?.fetchedAt || null,
          tier: proplineQuota()?.tier || null,
        },
      },
    };
  }

  // Keep normalized persistence aligned with the exact rows served to the
  // customer. When PropLine replaces a lower-priority quote, the displaced
  // line is removed from board.data so it cannot be written back as a second,
  // stale quote. Rebuilding from flat rows also covers persisted/public rows
  // whose normalized halves were not present in memory.
  const rebuilt = normalizedDataFromBoardRows(props);
  const baseData = board?.data || {};
  const supplementData = supplement?.data || {};
  const mergeById = (...collections) => [...new Map(
    collections.flat().filter(Boolean).map((row) => [row.id, row])
  ).values()];

  const finalLineIds = new Set(props.map((row) => text(row?.id)).filter(Boolean));
  const lines = mergeById(rebuilt.lines, baseData.lines || [], supplementData.lines || [])
    .filter((row) => finalLineIds.has(text(row?.id)));
  const propIds = new Set(lines.map((row) => text(row?.propId)).filter(Boolean));
  const normalizedProps = mergeById(rebuilt.props, baseData.props || [], supplementData.props || [])
    .filter((row) => propIds.has(text(row?.id)));
  const playerIds = new Set(normalizedProps.map((row) => text(row?.playerId)).filter(Boolean));
  const eventIds = new Set(normalizedProps.map((row) => text(row?.eventId)).filter(Boolean));
  const players = mergeById(rebuilt.players, baseData.players || [], supplementData.players || [])
    .filter((row) => playerIds.has(text(row?.id)));
  const events = mergeById(rebuilt.events, baseData.events || [], supplementData.events || [])
    .filter((row) => eventIds.has(text(row?.id)));
  const data = { events, players, props: normalizedProps, lines };

  const books = [...new Set(props.map((row) => text(row.sportsbookKey).toLowerCase()).filter(Boolean))].sort();
  const enriched = presenceRefreshed + prioritized;

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
        added: acceptedAll.length,
        specialsAdded: acceptedSpecials.length,
        prioritized,
        presenceRefreshed,
        duplicateBaseSuppressed,
        enriched,
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
