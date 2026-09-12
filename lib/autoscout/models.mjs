import crypto from 'node:crypto';
import { normalizePlayerName } from '../data-sources/contract.mjs';

export const NORMALIZED_SCHEMA_VERSION = 1;
export const AUTOMATIC_SPORTS = Object.freeze(['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB']);
// New soccer leagues are opt-in page requests; do not enlarge automatic paid polling.
export const SUPPORTED_SPORTS = Object.freeze([...AUTOMATIC_SPORTS,'MLS','EPL','UCL']);
export const PROP_SIDES = Object.freeze(['OVER','UNDER']);

const text = (value) => String(value ?? '').trim();
export const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function stableId(parts = []) {
  return crypto.createHash('sha256').update(parts.map((part) => text(part).toLowerCase()).join('|')).digest('hex').slice(0, 32);
}

export function normalizedEvent(input = {}) {
  const sport = text(input.sport).toUpperCase();
  const providerEventId = text(input.providerEventId || input.id);
  if (!sport || !providerEventId) throw new Error('NormalizedEvent requires sport and providerEventId.');
  const ingestedAt = input.ingestedAt || new Date().toISOString();
  return {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    id: input.id && input.providerEventId ? text(input.id) : stableId(['event', sport, providerEventId]),
    provider: text(input.provider),
    providerEventId,
    sport,
    league: text(input.league || sport).toUpperCase(),
    homeTeam: text(input.homeTeam),
    awayTeam: text(input.awayTeam),
    commenceTime: input.commenceTime || null,
    status: text(input.status || 'SCHEDULED').toUpperCase(),
    homeScore: numberOrNull(input.homeScore),
    awayScore: numberOrNull(input.awayScore),
    providerUpdatedAt: input.providerUpdatedAt || null,
    ingestedAt,
  };
}

export function normalizedPlayer(input = {}) {
  const sport = text(input.sport).toUpperCase();
  const name = text(input.name || input.playerName);
  if (!sport || !name) throw new Error('NormalizedPlayer requires sport and name.');
  const canonicalName = normalizePlayerName(name);
  return {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    id: text(input.id) || stableId(['player', sport, canonicalName]),
    provider: text(input.provider),
    providerPlayerId: text(input.providerPlayerId),
    sport,
    name,
    canonicalName,
    entityType: input.entityType === 'team' ? 'team' : 'player',
    team: text(input.team),
    position: text(input.position),
    headshotUrl: input.headshotUrl || null,
    ingestedAt: input.ingestedAt || new Date().toISOString(),
  };
}

export function normalizedProp(input = {}) {
  const eventId = text(input.eventId);
  const playerId = text(input.playerId);
  const playerName = text(input.playerName);
  const marketKey = text(input.marketKey || input.marketId).toLowerCase();
  const sport = text(input.sport).toUpperCase();
  if (!eventId || !playerId || !playerName || !marketKey || !sport) {
    throw new Error('NormalizedProp requires eventId, playerId, playerName, marketKey and sport.');
  }
  return {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    id: text(input.id) || stableId(['prop', sport, eventId, playerId, marketKey, input.period || 'game']),
    sport,
    league: text(input.league || sport).toUpperCase(),
    eventId,
    playerId,
    playerName,
    entityType: input.entityType === 'team' ? 'team' : 'player',
    team: text(input.team),
    marketKey,
    marketName: text(input.marketName || input.market || marketKey),
    period: text(input.period || 'game').toLowerCase(),
    isAlternate: input.isAlternate === true,
    provider: text(input.provider),
    ingestedAt: input.ingestedAt || new Date().toISOString(),
  };
}

export function normalizedBookmakerLine(input = {}) {
  const propId = text(input.propId);
  const bookmakerKey = text(input.bookmakerKey).toLowerCase();
  const side = text(input.side).toUpperCase();
  const line = numberOrNull(input.line);
  if (!propId || !bookmakerKey || !PROP_SIDES.includes(side) || line === null) {
    throw new Error('NormalizedBookmakerLine requires propId, bookmakerKey, OVER/UNDER side and numeric line.');
  }
  const price = numberOrNull(input.price);
  return {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    id: text(input.id) || stableId(['line', propId, bookmakerKey, side, line]),
    propId,
    provider: text(input.provider),
    bookmakerKey,
    bookmakerName: text(input.bookmakerName || bookmakerKey),
    side,
    line,
    price,
    impliedProbability: numberOrNull(input.impliedProbability),
    deeplink: input.deeplink || null,
    providerUpdatedAt: input.providerUpdatedAt || null,
    ingestedAt: input.ingestedAt || new Date().toISOString(),
  };
}

export function validateNormalizedBoard(board) {
  const problems = [];
  if (!board || typeof board !== 'object') return ['board is not an object'];
  for (const key of ['events','players','props','lines']) {
    if (!Array.isArray(board[key])) problems.push(`${key} must be an array`);
  }
  for (const row of board?.lines || []) {
    if (!PROP_SIDES.includes(row.side)) problems.push(`invalid line side: ${row.side}`);
    if (numberOrNull(row.line) === null) problems.push('line is not numeric');
  }
  return problems;
}
