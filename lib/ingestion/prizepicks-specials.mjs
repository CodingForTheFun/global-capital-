import { record } from './normalize.mjs';
import { normalizePlayerName } from '../data-sources/contract.mjs';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
const variant = value => {
  const normalized = text(value).toLowerCase();
  return normalized === 'goblin' ? 'goblin' : normalized === 'demon' ? 'demon' : null;
};
const side = value => {
  const normalized = text(value).toLowerCase();
  if (['more','over','higher','better'].includes(normalized)) return 'OVER';
  if (['less','under','lower','worse'].includes(normalized)) return 'UNDER';
  return null;
};
const active = value => value && value.active !== false && value.is_active !== false && !/^(?:suspended|closed|settled|removed|in_progress|unavailable)$/i.test(text(value.status));
const marketKey = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const time = value => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};

function entityIndex(payload) {
  const map = new Map();
  for (const row of [...list(payload?.data), ...list(payload?.included)]) {
    if (row?.type != null && row?.id != null) map.set(`${row.type}:${row.id}`, row);
  }
  return map;
}

function related(row, entities, ...keys) {
  for (const key of keys) {
    const ref = row?.relationships?.[key]?.data;
    if (!ref) continue;
    const found = entities.get(`${ref.type}:${ref.id}`);
    if (found) return found;
  }
  return {};
}

function explicitSideVariants(attributes) {
  const result = new Map();
  const fieldPairs = [
    ['more_odds_type','OVER'], ['over_odds_type','OVER'], ['higher_odds_type','OVER'],
    ['less_odds_type','UNDER'], ['under_odds_type','UNDER'], ['lower_odds_type','UNDER'],
    ['more_type','OVER'], ['over_type','OVER'], ['less_type','UNDER'], ['under_type','UNDER'],
  ];
  for (const [key, direction] of fieldPairs) {
    const type = variant(attributes?.[key]);
    if (type) result.set(direction, type);
  }
  for (const container of [attributes?.odds_types, attributes?.pick_types, attributes?.side_types]) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    for (const [key, value] of Object.entries(container)) {
      const direction = side(key), type = variant(value);
      if (direction && type) result.set(direction, type);
    }
  }
  for (const rows of [attributes?.outcomes, attributes?.options, attributes?.selections, attributes?.picks]) {
    for (const option of list(rows)) {
      const direction = side(option?.side ?? option?.choice ?? option?.label ?? option?.name);
      const type = variant(option?.odds_type ?? option?.pick_type ?? option?.type ?? option?.variant);
      if (direction && type) result.set(direction, type);
    }
  }
  return result;
}

/**
 * Parse source-labelled PrizePicks alternate projections without inferring a
 * directional payout. If the payload explicitly binds Goblin/Demon to a side,
 * preserve it. Otherwise preserve only the projection-level variant and line;
 * the UI may show that sourced fact but must not call it More or Less.
 */
export function normalizePrizePicksSpecials(payload) {
  if (!Array.isArray(payload?.data) || !Array.isArray(payload?.included)) throw new Error('INVALID_PRIZEPICKS_SCHEMA');
  const entities = entityIndex(payload), out = [];
  for (const row of payload.data) {
    if (!['projection','projections'].includes(row?.type)) continue;
    const a = row.attributes || {};
    const projectionVariant = variant(a.odds_type ?? a.pick_type ?? a.variant);
    const explicit = explicitSideVariants(a);
    if (!projectionVariant && !explicit.size) continue;
    if (!active(a) || a.is_live === true || a.live === true) continue;
    if (a.flash_sale_line_score != null || /taco|flash[ _-]?sale|discount|promo|boost/i.test([a.promotion,a.promo,a.label,a.type].filter(Boolean).join(' '))) continue;

    const player = related(row, entities, 'new_player', 'player'), pa = player.attributes || {};
    const game = related(row, entities, 'game'), ga = game.attributes || {};
    const league = related(row, entities, 'league').attributes || related(player, entities, 'league').attributes || {};
    if (!active(pa) || !active(ga)) continue;
    const base = record({
      sourceId: text(row.id), book: 'prizepicks', nativePlayerId: text(player.id),
      playerName: pa.name || pa.display_name, sport: league.name || league.abbreviation || a.sport || pa.sport,
      market: a.stat_type || related(row, entities, 'stat_type').attributes?.name, line: a.line_score,
      period: a.period || a.projection_type || null, team: pa.team || '', opponent: a.opponent || pa.opponent || '',
      nativeEventId: text(game.id || a.game_id), homeTeam: ga.home_team || '', awayTeam: ga.away_team || '',
      gameStartTime: ga.start_time || a.start_time, updatedAt: a.updated_at || payload.meta?.updated_at,
      headshot: pa.image_url, position: pa.position, sides: [],
    });
    if (!base) continue;

    if (explicit.size) {
      for (const [direction, type] of explicit) {
        out.push({ ...base, side: direction, specialType: type, isAlternate: true, specialVerified: true,
          specialSideVerified: true, specialSourceId: text(row.id), specialTypeSource: 'outcome_metadata' });
      }
    } else if (projectionVariant) {
      out.push({ ...base, side: null, specialType: projectionVariant, isAlternate: true, specialVerified: true,
        specialSideVerified: false, specialSourceId: text(row.id), specialTypeSource: 'projection_odds_type' });
    }
  }
  return out;
}

function identityKey(row) {
  const start = time(row?.gameStartTime);
  return JSON.stringify([String(row?.sport || '').toUpperCase(), normalizePlayerName(row?.playerName || ''), marketKey(row?.market), start]);
}

/**
 * Attach verified alternates to an already-normalized board without putting
 * them into normalized lines/props, active_props, Best Line, or consensus.
 * At most one closest line per Goblin/Demon + directional class is attached to
 * a card so a provider with many alternates cannot flood the customer board.
 */
export function attachPrizePicksSpecialRows(board, specials, ingestedAt = new Date().toISOString()) {
  const regular = Array.isArray(board?.props) ? board.props : [];
  const index = new Map();
  for (const row of regular) {
    if (row?.isAlternate === true || row?.sportsbookKey !== 'prizepicks') continue;
    const key = identityKey(row);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  const attached = new Map();
  for (const special of list(specials)) {
    const validSide = special?.side == null || ['OVER','UNDER'].includes(special?.side);
    const validSource = special?.specialTypeSource === 'outcome_metadata' || special?.specialTypeSource === 'projection_odds_type';
    if (special?.specialVerified !== true || special?.isAlternate !== true || !validSource || !validSide ||
        !['goblin','demon'].includes(special?.specialType)) continue;
    if (special.specialTypeSource === 'outcome_metadata' && !['OVER','UNDER'].includes(special.side)) continue;
    if (special.specialTypeSource === 'projection_odds_type' && special.side != null) continue;
    const candidates = index.get(identityKey(special)) || [];
    const identities = new Map(candidates.map(row => [[row.eventId,row.playerId,row.marketId].join('|'), row]));
    if (identities.size !== 1) continue;
    const base = identities.values().next().value;
    const directionKey = special.side || 'LINE';
    const row = { ...base,
      id: `prizepicks-special:${special.specialSourceId}:${directionKey}`,
      side: special.side, line: special.line, price: null, sportsbook: 'PrizePicks', sportsbookKey: 'prizepicks', provider: 'prizepicks',
      isAlternate: true, specialType: special.specialType, specialVerified: true, specialSideVerified: special.specialSideVerified === true,
      specialSourceId: special.specialSourceId, specialTypeSource: special.specialTypeSource,
      providerUpdatedAt: special.updatedAt || null, updatedAt: special.updatedAt || null, ingestedAt,
    };
    const key = [base.eventId,base.playerId,base.marketId,special.specialType,directionKey].join('|');
    const current = attached.get(key);
    const baseLine = Number(base.line), nextLine = Number(row.line), currentLine = Number(current?.line);
    const nextDistance = Number.isFinite(baseLine) && Number.isFinite(nextLine) ? Math.abs(nextLine-baseLine) : Infinity;
    const currentDistance = Number.isFinite(baseLine) && Number.isFinite(currentLine) ? Math.abs(currentLine-baseLine) : Infinity;
    if (!current || nextDistance < currentDistance) attached.set(key,row);
  }
  if (!attached.size) return board;
  return { ...board, props: [...regular, ...attached.values()] };
}