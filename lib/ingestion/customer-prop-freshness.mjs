const text = (value) => String(value ?? '').trim();
const DEFAULT_MAX_AGE_SECONDS = 600;
const MAX_ALLOWED_AGE_SECONDS = 600;
const FUTURE_SKEW_MS = 60_000;

function parsedTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? at : null;
}

export function customerPropMaxAgeMs() {
  const configured = Number(process.env.AUTOSCOUT_CUSTOMER_PROP_MAX_AGE_SECONDS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_AGE_SECONDS * 1000;
  // This setting may make the customer gate stricter, never looser. Internal
  // recovery retention can be longer; customer-visible prices cannot.
  return Math.min(MAX_ALLOWED_AGE_SECONDS, Math.max(60, Math.floor(configured))) * 1000;
}

export function customerPropObservationAt(row) {
  // Realtime events are the newest trusted observation when present. Otherwise
  // ingestedAt is the provider/snapshot observation used by every normalized
  // board path, including persisted active_props payloads.
  const candidates = row?.realtime === true
    ? [row?.updatedAt, row?.providerUpdatedAt, row?.receivedAt, row?.ingestedAt, row?.observedAt, row?.observed_at]
    : [row?.ingestedAt, row?.observedAt, row?.observed_at, row?.ingestionTimestamp, row?.recordedAt, row?.lastSeenAt, row?.providerUpdatedAt, row?.updatedAt];
  for (const value of candidates) {
    const at = parsedTime(value);
    if (at !== null) return at;
  }
  return null;
}

export function classifyCustomerPropFreshness(row, { now = Date.now(), maxAgeMs = customerPropMaxAgeMs() } = {}) {
  const current = typeof now === 'function' ? Number(now()) : Number(now);
  const ageLimit = Math.min(customerPropMaxAgeMs(), Math.max(1, Number(maxAgeMs) || customerPropMaxAgeMs()));

  if (!row || typeof row !== 'object') return { fresh: false, reason: 'invalid_row', observedAt: null, ageMs: null };
  if (row.cacheFallback === true || row.stale === true) return { fresh: false, reason: 'last_good_fallback', observedAt: null, ageMs: null };
  if (row.completed === true) return { fresh: false, reason: 'completed', observedAt: null, ageMs: null };

  const expiresAt = parsedTime(row.expiresAt ?? row.expires_at);
  if (expiresAt !== null && expiresAt <= current) return { fresh: false, reason: 'expired', observedAt: null, ageMs: null };

  const gameStart = parsedTime(row.gameStartTime ?? row.commenceTime ?? row.commence_time);
  if (gameStart !== null && gameStart <= current && row.live !== true) {
    return { fresh: false, reason: 'game_started', observedAt: null, ageMs: null };
  }

  const observedAt = customerPropObservationAt(row);
  if (observedAt === null || observedAt > current + FUTURE_SKEW_MS) {
    return { fresh: false, reason: 'unverified_timestamp', observedAt, ageMs: null };
  }

  const ageMs = Math.max(0, current - observedAt);
  if (ageMs > ageLimit) return { fresh: false, reason: 'stale', observedAt, ageMs };
  return { fresh: true, reason: null, observedAt, ageMs };
}

export function isCustomerObservationFresh(value, { now = Date.now(), maxAgeMs = customerPropMaxAgeMs() } = {}) {
  const current = typeof now === 'function' ? Number(now()) : Number(now);
  const at = parsedTime(value);
  if (at === null || at > current + FUTURE_SKEW_MS) return false;
  return current - at <= Math.min(customerPropMaxAgeMs(), Math.max(1, Number(maxAgeMs) || customerPropMaxAgeMs()));
}

function entityKey(row) {
  return [
    text(row?.eventId),
    text(row?.playerId),
    text(row?.marketId || row?.marketKey),
    text(row?.period || 'game'),
  ].join('|');
}

export function filterCustomerBoardFreshness(board, { now = Date.now(), maxAgeMs = customerPropMaxAgeMs() } = {}) {
  if (!board || typeof board !== 'object') return board;
  const current = typeof now === 'function' ? Number(now()) : Number(now);
  const input = Array.isArray(board.props) ? board.props : [];
  const kept = [];
  const dropped = {};

  for (const row of input) {
    const check = classifyCustomerPropFreshness(row, { now: current, maxAgeMs });
    if (check.fresh) kept.push(row);
    else dropped[check.reason] = (dropped[check.reason] || 0) + 1;
  }

  const keepLineIds = new Set(kept.map((row) => text(row?.id)).filter(Boolean));
  const keepEntityKeys = new Set(kept.map(entityKey));
  const originalData = board.data && typeof board.data === 'object' ? board.data : {};
  const originalLines = Array.isArray(originalData.lines) ? originalData.lines : [];
  const lines = originalLines.filter((row) => keepLineIds.has(text(row?.id)));

  const propIds = new Set(lines.map((row) => text(row?.propId)).filter(Boolean));
  const originalProps = Array.isArray(originalData.props) ? originalData.props : [];
  const props = originalProps.filter((row) => propIds.has(text(row?.id)) || keepEntityKeys.has(entityKey(row)));

  const playerIds = new Set([
    ...kept.map((row) => text(row?.playerId)),
    ...props.map((row) => text(row?.playerId)),
  ].filter(Boolean));
  const eventIds = new Set([
    ...kept.map((row) => text(row?.eventId)),
    ...props.map((row) => text(row?.eventId)),
  ].filter(Boolean));

  const players = (Array.isArray(originalData.players) ? originalData.players : [])
    .filter((row) => playerIds.has(text(row?.id)));
  const events = (Array.isArray(originalData.events) ? originalData.events : [])
    .filter((row) => eventIds.has(text(row?.id)));

  const books = [...new Set(kept.map((row) => text(row?.sportsbookKey).toLowerCase()).filter(Boolean))].sort();
  const distinctProps = new Set(kept.map(entityKey).filter(Boolean));

  return {
    ...board,
    props: kept,
    data: { ...originalData, events, players, props, lines },
    meta: {
      ...(board.meta || {}),
      stale: false,
      sportsbooks: books,
      sportsbookCount: books.length,
      lineCount: kept.filter((row) => row?.isAlternate !== true).length,
      propCount: distinctProps.size,
      events: eventIds.size,
      customerFreshness: {
        maxAgeSeconds: Math.floor(Math.min(customerPropMaxAgeMs(), Math.max(1, Number(maxAgeMs) || customerPropMaxAgeMs())) / 1000),
        checkedAt: new Date(current).toISOString(),
        inputRows: input.length,
        outputRows: kept.length,
        dropped,
      },
    },
  };
}
