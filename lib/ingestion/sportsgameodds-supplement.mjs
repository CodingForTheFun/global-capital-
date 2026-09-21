import { normalizePlayerName } from '../data-sources/contract.mjs';
import { customerPropMaxAgeMs } from './customer-prop-freshness.mjs';
import { normalizedDataFromBoardRows } from './normalize.mjs';
import {
  fetchSportsGameOddsUsage,
  sportsGameOddsConfigured,
  sportsGameOddsHealth,
  sportsGameOddsMonthlyUsage,
  sportsGameOddsPaidFallbackEnabled,
} from '../data-sources/sportsgameodds/client.mjs';
import {
  fetchSportsGameOddsBoard,
  SPORTSGAMEODDS_SPORTS,
  sportsGameOddsProviderHealth,
} from '../autoscout/providers/sportsgameodds.mjs';

const text = (value) => String(value ?? '').trim();
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());
const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const DEFAULT_SPORTS = Object.freeze(['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','SOCCER','MLS','EPL','UCL','MMA','PGA','CFL']);
const supported = new Set(SPORTSGAMEODDS_SPORTS);

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
  demandAt: new Map(),
  refreshedAt: new Map(),
};

function configuredSports() {
  const raw = text(process.env.SPORTSGAMEODDS_SUPPLEMENT_SPORTS);
  const values = (raw ? raw.split(',') : DEFAULT_SPORTS)
    .map((value) => text(value).toUpperCase())
    .filter((sport) => supported.has(sport));
  return [...new Set(values)];
}

export function sportsGameOddsSupplementEnabled() {
  return sportsGameOddsPaidFallbackEnabled() && !truthy(process.env.SPORTSGAMEODDS_SUPPLEMENT_DISABLED);
}

export function sportsGameOddsSupplementPolicy(usage = undefined) {
  const monthly = sportsGameOddsMonthlyUsage(usage);
  const limit = Number(monthly.max);
  const reserveObjects = Number.isFinite(limit) && limit > 0
    ? Math.max(5_000, Math.ceil(limit * 0.10))
    : 10_000;
  return {
    // One paid event page every four minutes is bounded to about 86k returned
    // event objects/month at the default 8-event cap, before the reserve stops
    // calls. Actual usage is normally much lower because this supplement only
    // refreshes recently requested sports.
    intervalSeconds: clamp(process.env.SPORTSGAMEODDS_SUPPLEMENT_INTERVAL_SECONDS, 240, 120, 900),
    eventLimit: clamp(process.env.SPORTSGAMEODDS_EVENTS_PER_REFRESH, 8, 1, 20),
    demandWindowSeconds: clamp(process.env.SPORTSGAMEODDS_DEMAND_WINDOW_SECONDS, 900, 300, 3600),
    reserveObjects,
    maxAgeSeconds: Math.floor(customerPropMaxAgeMs() / 1000),
    monthly,
  };
}

function pauseForQuota(policy) {
  // Usage is monthly and the exact billing reset time is not exposed in the
  // normalized client state. Re-check occasionally so a plan change or reset is
  // noticed without hammering the upstream.
  state.nextAt = Date.now() + 60 * 60_000;
  state.lastError = 'SPORTSGAMEODDS_MONTHLY_RESERVE';
  return { skipped: true, reason: 'monthly_reserve', monthly: policy.monthly };
}

function markDemand(sport, now = Date.now()) {
  const selected = text(sport).toUpperCase();
  if (supported.has(selected)) state.demandAt.set(selected, now);
}

function dueSports(policy, now) {
  const sports = configuredSports();
  const active = sports.filter((sport) => now - Number(state.demandAt.get(sport) || 0) <= policy.demandWindowSeconds * 1000);
  if (!active.length) return [];
  // Oldest refresh first makes multiple actively viewed sports round-robin
  // instead of letting the most recently clicked tab starve the others.
  return active.sort((a, b) => Number(state.refreshedAt.get(a) || 0) - Number(state.refreshedAt.get(b) || 0));
}

export async function maybeRefreshSportsGameOddsSupplement({ now = Date.now } = {}) {
  if (!sportsGameOddsSupplementEnabled()) return { skipped: true, reason: 'disabled_or_unconfigured' };
  if (state.running) return { skipped: true, reason: 'already_running' };
  const current = now();
  if (state.nextAt > current) return { skipped: true, reason: 'not_due', nextAt: new Date(state.nextAt).toISOString() };

  state.running = true;
  state.startedAt ||= new Date(current).toISOString();
  state.lastAttemptAt = new Date(current).toISOString();
  try {
    const usage = await fetchSportsGameOddsUsage().catch(() => null);
    const policy = sportsGameOddsSupplementPolicy(usage);
    if (policy.monthly.remaining !== null && policy.monthly.remaining <= policy.reserveObjects) {
      return pauseForQuota(policy);
    }

    const due = dueSports(policy, current);
    const sport = due[0] || null;
    if (!sport) {
      // No paid request was made. Re-check demand soon so the first visit to a
      // previously quiet sport can warm its gap cache on the next scheduler tick.
      state.nextAt = current + Math.min(60, policy.intervalSeconds) * 1000;
      return { skipped: true, reason: 'no_recent_demand', policy };
    }

    state.lastSport = sport;
    let board;
    try {
      board = await fetchSportsGameOddsBoard(sport, {
        force: true,
        eventLimit: policy.eventLimit,
        includeAlternates: truthy(process.env.SPORTSGAMEODDS_INCLUDE_ALTS),
      });
    } catch (error) {
      state.lastError = text(error?.code || error?.name || 'SPORTSGAMEODDS_SUPPLEMENT_FAILED');
      state.refreshedAt.set(sport, current);
      state.nextAt = current + (state.lastError === 'SPORTSGAMEODDS_RATE_LIMITED' ? 5 * 60 : policy.intervalSeconds) * 1000;
      return { skipped: false, sport, error: state.lastError };
    }

    state.cycles += 1;
    state.refreshedAt.set(sport, current);
    if (board?.props?.length && board?.meta?.stale !== true) {
      state.boards.set(sport, board);
      state.lastSuccessAt = new Date(now()).toISOString();
      state.lastError = null;
    } else {
      state.lastError = board?.meta?.refreshError || null;
    }
    state.nextAt = current + policy.intervalSeconds * 1000;
    return {
      skipped: false,
      sport,
      props: Number(board?.props?.length || 0),
      events: Number(board?.meta?.events || 0),
      books: Number(board?.meta?.sportsbookCount || 0),
      notice: board?.meta?.notice || null,
      policy,
      monthly: sportsGameOddsMonthlyUsage(),
    };
  } finally {
    state.running = false;
  }
}

function roundedStart(row) {
  const at = Date.parse(row?.gameStartTime || row?.commenceTime || '');
  return Number.isFinite(at) ? Math.round(at / 60_000) : null;
}

function basePlayerGameKey(row) {
  const sport = text(row?.sport).toUpperCase();
  const player = normalizePlayerName(row?.playerName);
  const start = roundedStart(row);
  return sport && player && start !== null ? [sport, player, start].join('|') : null;
}

function marketKey(row) {
  return text(row?.marketId || row?.marketKey || row?.market).toLowerCase();
}

function quoteSlot(row) {
  const playerGame = basePlayerGameKey(row);
  const market = marketKey(row);
  const book = text(row?.sportsbookKey).toLowerCase();
  const side = text(row?.side).toUpperCase();
  const period = text(row?.period || 'game').toLowerCase();
  if (!playerGame || !market || !book || !['OVER','UNDER'].includes(side)) return null;
  return [playerGame, market, period, book, side].join('|');
}

function exactQuote(row) {
  const slot = quoteSlot(row);
  const line = Number(row?.line);
  return slot && Number.isFinite(line) ? [slot, line].join('|') : null;
}

const IDENTITY_METADATA_FIELDS = Object.freeze([
  'sportsGameOddsEventId',
  'sportsGameOddsLeagueId',
  'sportsGameOddsPlayerId',
]);
const QUOTE_METADATA_FIELDS = Object.freeze([
  'sportsGameOddsOddId',
  'sportsGameOddsBookmakerId',
]);

function overlayFields(row, source, fields) {
  if (!row || !source) return row;
  let changed = false;
  const merged = { ...row };
  for (const key of fields) {
    const value = source[key];
    if (value !== null && value !== undefined && value !== '' && merged[key] !== value) {
      merged[key] = value;
      changed = true;
    }
  }
  return changed ? merged : row;
}

function overlayQuoteMetadata(row, source) {
  if (!row || !source) return row;
  let merged = overlayFields(row, source, QUOTE_METADATA_FIELDS);
  let changed = merged !== row;
  if (changed) merged = { ...merged };
  for (const key of ['fairOdds','fairLine','consensusLine']) {
    const current = merged[key];
    const value = source[key];
    if ((current === null || current === undefined || current === '') && value !== null && value !== undefined && value !== '') {
      merged[key] = value;
      changed = true;
    }
  }
  return changed ? merged : row;
}

function rebaseRows(supplementRows, baseRows) {
  const byPlayerGame = new Map();
  for (const row of baseRows) {
    const key = basePlayerGameKey(row);
    if (!key) continue;
    if (!byPlayerGame.has(key)) byPlayerGame.set(key, row);
    else {
      const first = byPlayerGame.get(key);
      if (first && first.eventId !== row.eventId) byPlayerGame.set(key, null);
    }
  }
  return supplementRows.map((row) => {
    const base = byPlayerGame.get(basePlayerGameKey(row));
    if (!base) return row;
    return {
      ...row,
      eventId: base.eventId || row.eventId,
      playerId: base.playerId || row.playerId,
      // The canonical board's provider player id remains the public join key;
      // the SGO id stays separately attached for SGO-only research fallback.
      providerPlayerId: base.providerPlayerId || row.providerPlayerId,
      team: base.team || row.team,
      homeTeam: base.homeTeam || row.homeTeam,
      awayTeam: base.awayTeam || row.awayTeam,
    };
  });
}

export function mergeCachedSportsGameOdds(board, sport, { now = Date.now } = {}) {
  const selected = text(sport).toUpperCase();
  markDemand(selected, now());
  const supplement = state.boards.get(selected);
  if (!supplement?.props?.length || supplement?.meta?.stale === true) return board;

  const fetched = Date.parse(supplement?.meta?.fetchedAt || supplement?.meta?.ingestionTimestamp || '');
  const maxAgeMs = customerPropMaxAgeMs();
  if (!Number.isFinite(fetched) || now() - fetched > maxAgeMs) return board;

  const rawBaseProps = Array.isArray(board?.props) ? board.props : [];
  const rebased = rebaseRows(supplement.props, rawBaseProps);
  const byExact = new Map(rebased.map((row) => [exactQuote(row), row]).filter(([key]) => key));
  const byPlayerGame = new Map();
  for (const row of rebased) {
    const key = basePlayerGameKey(row);
    if (key && !byPlayerGame.has(key)) byPlayerGame.set(key, row);
  }
  const baseProps = rawBaseProps.map((row) => {
    // Event/player identity is safe across books and line moves once the same
    // player+game has been matched. Quote-specific IDs/fair values still
    // require an exact book+side+line match and can never overwrite the quote.
    let merged = overlayFields(row, byPlayerGame.get(basePlayerGameKey(row)), IDENTITY_METADATA_FIELDS);
    const source = byExact.get(exactQuote(row));
    if (source) merged = overlayQuoteMetadata(merged, source);
    return merged;
  });

  // PropLine/public data always wins a book+player+market+side slot. SGO fills
  // only slots that are absent, even when it has a different line for the same
  // bookmaker. That prevents a lower-priority fallback from fighting a fresher
  // primary quote.
  const occupied = new Set(baseProps.map(quoteSlot).filter(Boolean));
  const accepted = [];
  for (const row of rebased) {
    if (row?.isAlternate === true && !truthy(process.env.SPORTSGAMEODDS_INCLUDE_ALTS)) continue;
    if (Date.parse(row?.gameStartTime || '') <= now() && row?.live !== true) continue;
    const slot = quoteSlot(row);
    if (!slot || occupied.has(slot)) continue;
    occupied.add(slot);
    accepted.push(row);
  }

  const enriched = baseProps.reduce((count, row, index) => count + (row === rawBaseProps[index] ? 0 : 1), 0);
  if (!accepted.length && !enriched) {
    return {
      ...board,
      meta: {
        ...(board?.meta || {}),
        sportsGameOddsSupplement: {
          cached: true,
          added: 0,
          enriched: 0,
          fetchedAt: supplement.meta?.fetchedAt || null,
          notice: supplement.meta?.notice || null,
        },
      },
    };
  }

  const addedData = normalizedDataFromBoardRows(accepted);
  const baseData = board?.data || {};
  const data = {};
  for (const key of ['events','players','props','lines']) {
    data[key] = [...new Map([...(baseData[key] || []), ...(addedData[key] || [])].map((row) => [row.id, row])).values()];
  }
  const props = [...baseProps, ...accepted];
  const books = [...new Set(props.map((row) => text(row?.sportsbookKey).toLowerCase()).filter(Boolean))].sort();

  return {
    ...board,
    props,
    data,
    meta: {
      ...(board?.meta || {}),
      supplemental: true,
      sportsbooks: books,
      sportsbookCount: books.length,
      lineCount: props.filter((row) => row?.isAlternate !== true).length,
      propCount: data.props.length,
      events: data.events.length,
      sportsGameOddsSupplement: {
        cached: true,
        added: accepted.length,
        enriched,
        fetchedAt: supplement.meta?.fetchedAt || null,
        notice: supplement.meta?.notice || null,
        accountTier: supplement.meta?.accountTier || sportsGameOddsHealth().tier || null,
      },
    },
  };
}

export function sportsGameOddsIdentityFor({ sport, playerName, team = '', gameStartTime = '', marketKey: wantedMarketKey = '', marketName = '' } = {}) {
  const selected = text(sport).toUpperCase();
  const board = state.boards.get(selected);
  if (!board?.props?.length) return null;
  const wanted = normalizePlayerName(playerName);
  const wantedTeam = text(team).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const wantedStart = Date.parse(gameStartTime || '');
  const wantedMarket = text(wantedMarketKey).toLowerCase();
  const wantedLabel = text(marketName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const matches = board.props.filter((row) => {
    if (normalizePlayerName(row?.playerName) !== wanted) return false;
    if (wantedMarket && marketKey(row) !== wantedMarket) return false;
    if (!wantedMarket && wantedLabel) {
      const rowLabel = text(row?.market).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (rowLabel && rowLabel !== wantedLabel) return false;
    }
    if (wantedTeam) {
      const rowTeam = text(row?.team).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (rowTeam && rowTeam !== wantedTeam && !rowTeam.startsWith(wantedTeam) && !wantedTeam.startsWith(rowTeam)) return false;
    }
    if (Number.isFinite(wantedStart)) {
      const rowStart = Date.parse(row?.gameStartTime || '');
      if (Number.isFinite(rowStart) && Math.abs(rowStart - wantedStart) > 10 * 60_000) return false;
    }
    return Boolean(row?.sportsGameOddsPlayerId);
  });
  const ids = [...new Set(matches.map((row) => row.sportsGameOddsPlayerId).filter(Boolean))];
  if (ids.length !== 1) return null;
  const row = matches[0];
  return {
    playerId: ids[0],
    eventId: row?.sportsGameOddsEventId || null,
    leagueId: row?.sportsGameOddsLeagueId || null,
    statId: row?.statId || null,
    playerName: row?.playerName || playerName || null,
    team: row?.team || team || null,
  };
}

export function sportsGameOddsSupplementHealth() {
  const provider = sportsGameOddsProviderHealth();
  const policy = sportsGameOddsSupplementPolicy();
  return {
    configured: sportsGameOddsConfigured(),
    enabled: sportsGameOddsSupplementEnabled(),
    running: state.running,
    startedAt: state.startedAt,
    cycles: state.cycles,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastSport: state.lastSport,
    lastError: state.lastError,
    nextAt: state.nextAt ? new Date(state.nextAt).toISOString() : null,
    cachedSports: [...state.boards.keys()],
    recentlyDemandedSports: [...state.demandAt.entries()]
      .filter(([, at]) => Date.now() - at <= policy.demandWindowSeconds * 1000)
      .map(([sport]) => sport),
    policy,
    provider,
  };
}

export function __resetSportsGameOddsSupplement() {
  Object.assign(state, {
    running: false,
    startedAt: null,
    nextAt: 0,
    cursor: 0,
    cycles: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastSport: null,
    lastError: null,
  });
  state.boards.clear();
  state.demandAt.clear();
  state.refreshedAt.clear();
}
