import { normalizePlayerName } from '../data-sources/contract.mjs';
import { customerPropMaxAgeMs } from './customer-prop-freshness.mjs';
import { normalizedDataFromBoardRows } from './normalize.mjs';
import { providerIsEnabled, providerIsPrimary, propProviderMode } from '../autoscout/provider-mode.mjs';
import { sportradarConfigured, sportradarHealth } from '../data-sources/sportradar/client.mjs';
import { fetchSportradarBoard, SPORTRADAR_PROP_SPORTS } from '../autoscout/providers/sportradar.mjs';

const text = (value) => String(value ?? '').trim();
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());
const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const DEFAULT_SPORTS = Object.freeze(['NFL','NBA','MLB','NHL','NCAAF']);
const supported = new Set(SPORTRADAR_PROP_SPORTS);

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
  refreshedAt: new Map(),
};

function configuredSports() {
  const raw = text(process.env.SPORTRADAR_PROP_SPORTS);
  const rows = (raw ? raw.split(',') : DEFAULT_SPORTS)
    .map((value) => text(value).toUpperCase())
    .filter((sport) => supported.has(sport));
  return [...new Set(rows)];
}

export function sportradarSupplementEnabled() {
  return providerIsEnabled('sportradar')
    && sportradarConfigured()
    && !truthy(process.env.SPORTRADAR_PROP_DISABLED);
}

export function sportradarSupplementPolicy() {
  return {
    intervalSeconds: clamp(process.env.SPORTRADAR_PROP_REFRESH_SECONDS, 60, 60, 900),
    eventLimit: clamp(process.env.SPORTRADAR_PROP_EVENTS_PER_REFRESH, 8, 1, 24),
    maxAgeSeconds: Math.floor(customerPropMaxAgeMs() / 1000),
  };
}

function nextSport(sports) {
  if (!sports.length) return null;
  const sport = sports[state.cursor % sports.length];
  state.cursor = (state.cursor + 1) % sports.length;
  return sport;
}

export async function maybeRefreshSportradarSupplement({ now = Date.now } = {}) {
  if (!sportradarSupplementEnabled()) return { skipped: true, reason: 'disabled_or_unconfigured' };
  if (state.running) return { skipped: true, reason: 'already_running' };

  const current = now();
  if (state.nextAt > current) {
    return { skipped: true, reason: 'not_due', nextAt: new Date(state.nextAt).toISOString() };
  }

  state.running = true;
  state.startedAt ||= new Date(current).toISOString();
  state.lastAttemptAt = new Date(current).toISOString();
  const policy = sportradarSupplementPolicy();

  try {
    const sports = configuredSports();
    const sport = nextSport(sports);
    if (!sport) {
      state.nextAt = current + policy.intervalSeconds * 1000;
      return { skipped: true, reason: 'no_supported_sports' };
    }

    state.lastSport = sport;
    const board = await fetchSportradarBoard(sport, {
      force: true,
      eventLimit: policy.eventLimit,
      includeAlternates: false,
    });

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
      error: state.lastError,
    };
  } catch (error) {
    state.lastError = text(error?.code || error?.name || 'SPORTRADAR_SUPPLEMENT_FAILED');
    state.nextAt = current + (state.lastError === 'SPORTRADAR_RATE_LIMITED' ? 5 * 60 : policy.intervalSeconds) * 1000;
    return { skipped: false, sport: state.lastSport, error: state.lastError };
  } finally {
    state.running = false;
  }
}

function roundedStart(row) {
  const at = Date.parse(row?.gameStartTime || '');
  return Number.isFinite(at) ? Math.round(at / 60_000) : null;
}

function basePlayerGameKey(row) {
  const sport = text(row?.sport).toUpperCase();
  const player = normalizePlayerName(row?.playerName);
  const start = roundedStart(row);
  return sport && player && start !== null ? [sport, player, start].join('|') : null;
}

function periodIdentity(row) {
  const raw = text(row?.period || 'game').toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw || ['game','full','full_game','fullgame','match'].includes(raw)) return 'game';
  return raw;
}

function quoteSlot(row) {
  const playerGame = basePlayerGameKey(row);
  const market = text(row?.marketId || row?.market).toLowerCase();
  const book = text(row?.sportsbookKey).toLowerCase();
  const side = text(row?.side).toUpperCase();
  if (!playerGame || !market || !book || !['OVER','UNDER'].includes(side)) return null;
  return [playerGame, market, periodIdentity(row), book, side].join('|');
}

function sameQuote(left, right) {
  const a = Number(left?.line);
  const b = Number(right?.line);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a !== b) return false;
  const ap = left?.price === null || left?.price === undefined || left?.price === '' ? null : Number(left.price);
  const bp = right?.price === null || right?.price === undefined || right?.price === '' ? null : Number(right.price);
  if (!Number.isFinite(ap) || !Number.isFinite(bp)) return true;
  return ap === bp;
}

function rebaseRows(supplementRows, baseRows) {
  const byPlayerGame = new Map();
  for (const row of baseRows) {
    const key = basePlayerGameKey(row);
    if (!key) continue;
    if (!byPlayerGame.has(key)) byPlayerGame.set(key, row);
    else if (byPlayerGame.get(key)?.eventId !== row.eventId) byPlayerGame.set(key, null);
  }

  return supplementRows.map((row) => {
    const base = byPlayerGame.get(basePlayerGameKey(row));
    if (!base) return row;
    return {
      ...row,
      eventId: base.eventId || row.eventId,
      playerId: base.playerId || row.playerId,
      team: base.team || row.team,
      position: base.position || row.position,
      homeTeam: base.homeTeam || row.homeTeam,
      awayTeam: base.awayTeam || row.awayTeam,
      gameStartTime: base.gameStartTime || row.gameStartTime,
    };
  });
}

const SPORTRADAR_METADATA = Object.freeze([
  'sportradarEventId',
  'sportradarPlayerId',
  'sportradarMarketId',
  'sportradarBookId',
  'sportradarOutcomeId',
  'externalOutcomeId',
  'externalMarketId',
  'externalEventId',
  'openPrice',
  'openLine',
  'trend',
]);

function overlayMetadata(row, source) {
  if (!source) return row;
  const merged = { ...row };
  for (const key of SPORTRADAR_METADATA) {
    const value = source[key];
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
  }
  if (source.observedAt) {
    merged.observedAt = source.observedAt;
    merged.ingestedAt = source.observedAt;
    merged.presenceSource = 'sportradar';
  }
  return merged;
}

function prioritizeQuote(row, source) {
  const merged = overlayMetadata({
    ...row,
    source: 'Sportradar',
    provider: 'sportradar',
    line: source.line,
    price: source.price,
    impliedProbability: source.impliedProbability ?? row.impliedProbability ?? null,
    sportsbook: source.sportsbook || row.sportsbook,
    sportsbookKey: source.sportsbookKey || row.sportsbookKey,
    providerUpdatedAt: source.providerUpdatedAt || row.providerUpdatedAt || null,
    updatedAt: source.updatedAt || source.observedAt || row.updatedAt || null,
    isAlternate: false,
  }, source);
  return merged;
}

export function mergeCachedSportradar(board, sport, {
  now = Date.now,
  primary = providerIsPrimary('sportradar'),
} = {}) {
  const selected = text(sport).toUpperCase();
  const supplement = state.boards.get(selected);
  if (!supplement?.props?.length || supplement?.meta?.stale === true) return board;

  const fetched = Date.parse(supplement?.meta?.fetchedAt || supplement?.meta?.ingestionTimestamp || '');
  if (!Number.isFinite(fetched) || now() - fetched > customerPropMaxAgeMs()) return board;

  const rawBaseProps = Array.isArray(board?.props) ? board.props : [];
  const rebased = rebaseRows(supplement.props, rawBaseProps);

  const uniqueBySlot = new Map();
  for (const row of rebased) {
    if (row?.isAlternate === true) continue;
    const slot = quoteSlot(row);
    if (!slot) continue;
    if (!uniqueBySlot.has(slot)) uniqueBySlot.set(slot, row);
    else if (!sameQuote(uniqueBySlot.get(slot), row)) uniqueBySlot.set(slot, null);
  }

  let prioritized = 0;
  let enriched = 0;
  const baseProps = rawBaseProps.map((row) => {
    const source = uniqueBySlot.get(quoteSlot(row));
    if (!source) return row;
    if (primary && !sameQuote(row, source)) {
      prioritized += 1;
      return prioritizeQuote(row, source);
    }
    if (sameQuote(row, source)) {
      enriched += 1;
      return overlayMetadata(row, source);
    }
    return row;
  });

  const occupied = new Set(baseProps.map(quoteSlot).filter(Boolean));
  const accepted = [];
  for (const row of rebased) {
    if (row?.isAlternate === true) continue;
    if (Date.parse(row?.gameStartTime || '') <= now() && row?.live !== true) continue;
    const slot = quoteSlot(row);
    if (!slot || occupied.has(slot)) continue;
    occupied.add(slot);
    accepted.push(row);
  }

  if (!accepted.length && prioritized === 0 && enriched === 0) {
    return {
      ...board,
      meta: {
        ...(board?.meta || {}),
        sportradarSupplement: {
          cached: true,
          primary,
          added: 0,
          prioritized: 0,
          enriched: 0,
          fetchedAt: supplement.meta?.fetchedAt || null,
        },
      },
    };
  }

  const props = [...baseProps, ...accepted];
  const data = normalizedDataFromBoardRows(props);
  const books = [...new Set(props.map((row) => text(row?.sportsbookKey).toLowerCase()).filter(Boolean))].sort();

  return {
    ...board,
    props,
    data,
    meta: {
      ...(board?.meta || {}),
      provider: primary ? 'Sportradar + public feeds' : board?.meta?.provider,
      supplemental: true,
      sportsbooks: books,
      sportsbookCount: books.length,
      lineCount: props.filter((row) => row?.isAlternate !== true).length,
      propCount: data.props.length,
      events: data.events.length,
      sportradarSupplement: {
        cached: true,
        primary,
        added: accepted.length,
        prioritized,
        enriched,
        fetchedAt: supplement.meta?.fetchedAt || null,
      },
    },
  };
}

export function sportradarSupplementHealth() {
  const policy = sportradarSupplementPolicy();
  return {
    configured: sportradarConfigured(),
    enabled: sportradarSupplementEnabled(),
    mode: propProviderMode(),
    role: providerIsPrimary('sportradar') ? 'primary-current-quote' : 'fallback',
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
    provider: sportradarHealth(),
  };
}

export function __resetSportradarSupplement() {
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
  state.refreshedAt.clear();
}
