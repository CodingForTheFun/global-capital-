import {verifiedTacoChannelOffer} from '../../ui/offer-promotion.mjs';
// Only explicit provider-supplied Taco metadata can become a Taco offer.
// No inference from line size, +100 prices, Goblins, Demons or a Tuesday date.
const num = x => x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null;
export function tacoOffer(outcome, { book, sport, event, market, now = Date.now() } = {}) {
  if (book?.key !== 'prizepicks' || !event?.id || !market || !sport ||
      ['isGoblin','isDemon','is_goblin','is_demon','live','completed'].some(key=>outcome?.[key]===true)) return null;
  const promo = outcome?.promotion;
  if (!promo || String(promo.type || '').toLowerCase() !== 'taco') return null;
  const expires = Date.parse(promo.expires_at || '');
  const original = num(promo.original_line), line = num(outcome.point);
  const start = Date.parse(event?.commenceTime || '');
  const player = typeof outcome.description === 'string' ? outcome.description.trim() : '';
  const side = String(outcome.name || '').toUpperCase();
  if (!player || !['OVER','UNDER'].includes(side) || line === null || original === null || line >= original ||
      !Number.isFinite(expires) || expires <= now || !Number.isFinite(start) || start <= now || outcome.available === false) return null;
  return { id: ['taco',event.id,market,player,side,line].join('|'), sport, eventId: event.id, marketId: market, playerName: player,
    observedAt: new Date(now).toISOString(),
    market, side, line, originalLine: original, promotionType: 'taco', promotional: true,
    sportsbook: 'PrizePicks', sportsbookKey: 'prizepicks', gameStartTime: event.commenceTime,
    homeTeam: event.homeTeam, awayTeam: event.awayTeam, expiresAt: new Date(expires).toISOString(),
    source: 'Explicit sportsbook promotion metadata', verified: true };
}
export function activeTacos(rows = [], now = Date.now()) {
  return rows.filter(row => verifiedTacoChannelOffer(row, row?.sport, now));
}
