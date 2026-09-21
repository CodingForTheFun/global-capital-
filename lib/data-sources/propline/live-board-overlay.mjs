const text = (value) => String(value ?? '').trim();
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const norm = (value) => text(value).toLowerCase();
function proplineOverlayEnabled() {
  const mode = text(process.env.OBLIGE_PROP_PROVIDER_MODE || process.env.PROP_PROVIDER_MODE || 'auto').toLowerCase();
  return !['sportradar','radar','sr','sportsgameodds','sgo','sports-game-odds','mesh','ultimate','all'].includes(mode);
}
const MAX_AGE_MS = 20 * 60_000;
const MAX_MOVES = 5_000;
const moves = new Map();
const suspensions = new Map();
let latestAt = null;
let latestSequence = 0;

function impliedProbability(price) {
  const n = num(price);
  if (n === null || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function playerTokens(data = {}) {
  return [...new Set([
    norm(data.player_id || data.providerPlayerId),
    norm(data.subject || data.player_name || data.playerName),
  ].filter(Boolean))];
}
function eventToken(data = {}) {
  const event = data.event && typeof data.event === 'object' ? data.event : {};
  return text(event.id || data.event_id || data.providerEventId || data.eventId);
}
function bookToken(data = {}) { return norm(data.bookmaker_key || data.book_key || data.sportsbookKey); }
function marketToken(data = {}) { return norm(data.market_key || data.marketId || data.market); }
function sideToken(data = {}) { return text(data.outcome_name || data.side).toUpperCase(); }
function suspensionKey({ eventId, book, player, market }) {
  return [text(eventId), norm(book), norm(player), norm(market)].join('|');
}
function rememberMove(data, { type, sequence, receivedAt }) {
  const outcomeId = text(data?.outcome_id || data?.providerOutcomeId);
  if (!outcomeId) return false;
  const current = data?.current && typeof data.current === 'object' ? data.current : {};
  const row = {
    type,
    outcomeId,
    sportKey: norm(data?.sport_key),
    eventId: eventToken(data),
    book: bookToken(data),
    players: playerTokens(data),
    market: marketToken(data),
    side: sideToken(data),
    point: num(current.point ?? data?.point ?? data?.line),
    price: num(current.price_american ?? current.price ?? data?.price_american ?? data?.price),
    updatedAt: text(data?.timestamp || data?.created_at || receivedAt) || receivedAt,
    receivedAt,
    sequence: Number.isFinite(Number(sequence)) ? Number(sequence) : null,
  };
  moves.delete(outcomeId);
  moves.set(outcomeId, row);
  while (moves.size > MAX_MOVES) moves.delete(moves.keys().next().value);
  if (row.eventId && row.book && row.market) {
    for (const player of row.players) suspensions.delete(suspensionKey({ eventId: row.eventId, book: row.book, player, market: row.market }));
  }
  return true;
}
function rememberSuspension(data, { sequence, receivedAt }) {
  const eventId = eventToken(data), book = bookToken(data), players = playerTokens(data);
  if (!eventId || !book || !players.length) return 0;
  const markets = Array.isArray(data?.markets) ? data.markets : [];
  let recorded = 0;
  for (const marketRow of markets) {
    const market = norm(marketRow?.key || marketRow?.market_key);
    if (!market) continue;
    const at = text(data?.suspended_at || marketRow?.suspended_at || data?.timestamp || receivedAt) || receivedAt;
    for (const player of players) {
      suspensions.set(suspensionKey({ eventId, book, player, market }), {
        eventId, book, player, market, at,
        sequence: Number.isFinite(Number(sequence)) ? Number(sequence) : null,
      });
      recorded += 1;
    }
  }
  return recorded;
}

function eachPayload(event = {}) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  if (payload.batch === true && Array.isArray(payload.events)) {
    return payload.events.map((item) => ({
      type: text(item?.event_type || payload.event_type || event.type),
      data: item?.data && typeof item.data === 'object' ? item.data : {},
      sequence: item?.seq ?? event.sequence,
      receivedAt: text(item?.created_at) || new Date().toISOString(),
    }));
  }
  return [{
    type: text(event.type || payload.event_type || payload.event),
    data: payload,
    sequence: event.sequence,
    receivedAt: new Date().toISOString(),
  }];
}

function prune(now = Date.now()) {
  for (const [key, row] of moves) if (now - (Date.parse(row.receivedAt || row.updatedAt || '') || 0) > MAX_AGE_MS) moves.delete(key);
  for (const [key, row] of suspensions) if (now - (Date.parse(row.at || '') || 0) > MAX_AGE_MS) suspensions.delete(key);
}

export function recordProplineLiveBoardEvent(event = {}) {
  if (!proplineOverlayEnabled()) return { recorded: 0, latestSequence, disabled: true };
  let recorded = 0;
  for (const item of eachPayload(event)) {
    if (item.type === 'line_movement') recorded += rememberMove(item.data, item) ? 1 : 0;
    else if (item.type === 'market_suspended') recorded += rememberSuspension(item.data, item);
    const seq = Number(item.sequence);
    if (Number.isFinite(seq)) latestSequence = Math.max(latestSequence, seq);
    if (item.receivedAt && (!latestAt || Date.parse(item.receivedAt) >= Date.parse(latestAt))) latestAt = item.receivedAt;
  }
  prune();
  return { recorded, latestSequence };
}

function propEventId(row) { return text(row?.providerEventId || row?.eventId); }
function propPlayers(row) { return [...new Set([norm(row?.providerPlayerId || row?.playerId), norm(row?.playerName)].filter(Boolean))]; }
function propBook(row) { return norm(row?.sportsbookKey || row?.bookmakerKey); }
function propMarket(row) { return norm(row?.marketId || row?.statId || row?.marketKey || row?.market); }
function propSuspended(row) {
  const eventId = propEventId(row), book = propBook(row), players = propPlayers(row), market = propMarket(row);
  if (!eventId || !book || !players.length || !market) return null;
  for (const player of players) {
    const hit = suspensions.get(suspensionKey({ eventId, book, player, market }));
    if (hit) return hit;
  }
  return null;
}

function applyMove(row) {
  const move = moves.get(text(row?.providerOutcomeId));
  if (!move) return row;
  return {
    ...row,
    line: move.point ?? row.line,
    price: move.price ?? row.price,
    impliedProbability: move.price === null ? row.impliedProbability : impliedProbability(move.price),
    providerUpdatedAt: move.updatedAt || row.providerUpdatedAt,
    updatedAt: move.updatedAt || row.updatedAt,
    realtimeSequence: move.sequence,
    realtime: true,
  };
}

export function applyProplineLiveBoardOverlay(board, sport = '') {
  if (!proplineOverlayEnabled()) return board;
  prune();
  if (!board || typeof board !== 'object' || (!moves.size && !suspensions.size)) return board;
  const selected = text(sport).toUpperCase();
  let applied = 0, suspended = 0;

  const props = (Array.isArray(board.props) ? board.props : []).flatMap((row) => {
    if (selected && text(row?.sport).toUpperCase() !== selected) return [row];
    if (norm(row?.provider) !== 'propline' && norm(row?.source) !== 'propline') return [row];
    const block = propSuspended(row);
    if (block) { suspended += 1; return []; }
    const next = applyMove(row);
    if (next !== row) applied += 1;
    return [next];
  });

  const data = board.data && typeof board.data === 'object' ? board.data : {};
  const eventById = new Map((Array.isArray(data.events) ? data.events : []).map((row) => [text(row?.id), row]));
  const playerById = new Map((Array.isArray(data.players) ? data.players : []).map((row) => [text(row?.id), row]));
  const propById = new Map((Array.isArray(data.props) ? data.props : []).map((row) => [text(row?.id), row]));
  const lines = (Array.isArray(data.lines) ? data.lines : []).flatMap((row) => {
    const prop = propById.get(text(row?.propId));
    if (!prop) return [row];
    const event = eventById.get(text(prop?.eventId)) || {};
    const player = playerById.get(text(prop?.playerId)) || {};
    const logical = {
      provider: 'propline',
      providerEventId: event?.providerEventId,
      eventId: prop?.eventId,
      providerPlayerId: player?.providerPlayerId,
      playerId: prop?.playerId,
      playerName: prop?.playerName || player?.name,
      marketId: prop?.marketKey,
      sportsbookKey: row?.bookmakerKey,
      providerOutcomeId: row?.providerOutcomeId,
      line: row?.line,
      price: row?.price,
      impliedProbability: row?.impliedProbability,
      providerUpdatedAt: row?.providerUpdatedAt,
      updatedAt: row?.providerUpdatedAt,
    };
    if (propSuspended(logical)) return [];
    const next = applyMove(logical);
    if (next === logical) return [row];
    return [{
      ...row,
      line: next.line,
      price: next.price,
      impliedProbability: next.impliedProbability,
      providerUpdatedAt: next.providerUpdatedAt,
      realtimeSequence: next.realtimeSequence,
      realtime: true,
    }];
  });

  return {
    ...board,
    props,
    data: { ...data, lines },
    meta: {
      ...(board.meta || {}),
      lineCount: props.length,
      realtimeOverlay: {
        applied,
        suspended,
        latestAt,
        latestSequence,
      },
    },
  };
}

export function proplineLiveBoardOverlayHealth() {
  prune();
  return { active: proplineOverlayEnabled(), moves: moves.size, suspensions: suspensions.size, latestAt, latestSequence, maxAgeMs: MAX_AGE_MS };
}
export function __resetProplineLiveBoardOverlay() {
  moves.clear(); suspensions.clear(); latestAt = null; latestSequence = 0;
}
