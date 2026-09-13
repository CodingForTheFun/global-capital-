/** Offer-scoped presentation contract. Unknown promotion metadata never means Taco.
 * Only a trusted ingestion adapter may set verified=true after reading a source
 * Taco designation. This does not infer promotions from a line, date or player.
 * Upstream Taco availability is unverified; absent metadata never becomes a Taco.
 */
export const TACO_FRESHNESS_MS = 15 * 60_000;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const date = v => typeof v === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
const id = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function verifiedTaco(offer, now=Date.now()) {
  const p = offer?.promotion;
  if (!p || p.type !== 'taco' || p.verified !== true || p.status !== 'active' ||
      p.source !== 'prizepicks' || offer.sportsbookKey !== 'prizepicks' ||
      offer.archived === true || offer.stale === true || offer.live === true || offer.completed === true ||
      offer.isGoblin === true || offer.isDemon === true || !finite(offer.line) ||
      !id(p.sourceRecordId) || !finite(now) || !['OVER','UNDER'].includes(offer.side)) return null;
  // Binding includes the exact offer, sport, game, athlete, market, side and line.
  const pairs = [['offerId','id'],['sport','sport'],['eventId','eventId'],['playerId','playerId'],['marketId','marketId'],['side','side']];
  if (pairs.some(([key,field])=>!id(offer[field]) || p[key] !== offer[field]) || p.line !== offer.line) return null;
  const observed=date(p.observedAt), starts=date(p.startsAt), expires=date(p.expiresAt), game=date(offer.gameStartTime);
  if (![observed,starts,expires,game].every(Number.isFinite) || observed>now || observed>expires ||
      starts>now || starts>=expires || expires<=now || now-observed>=TACO_FRESHNESS_MS || game<=now) return null;
  if (p.originalLine != null && (!finite(p.originalLine) || p.originalLine<=p.line)) return null;
  return {offerId:offer.id, expiresAt:p.expiresAt, validUntil:Math.min(expires,observed+TACO_FRESHNESS_MS,game)};
}
export function tacoBadgeHtml(offer,now=Date.now()) {
  const p=verifiedTaco(offer,now);
  return p ? '<span class="asTacoBadge" data-taco-until="'+p.validUntil+'" data-taco-offer="'+esc(p.offerId)+'" role="img" aria-label="Verified PrizePicks Taco offer" title="PrizePicks Taco: this exact promotional line only">🌮</span>' : '';
}
export function removeExpiredTacoBadges(root,now=Date.now()) {
  root?.querySelectorAll('[data-taco-until]').forEach(node=>{
    const until=Number(node.dataset.tacoUntil);
    if(!Number.isFinite(until)||until<=now)node.remove();
  });
}

/** The separate Taco-only endpoint has an offer record, never a player-level flag. */
export function verifiedTacoChannelOffer(offer, sport, now=Date.now()) {
  if (!offer || offer.sportsbookKey !== 'prizepicks' || offer.promotionType !== 'taco' ||
      offer.promotional !== true || offer.verified !== true || offer.sport !== sport ||
      ![offer.id,offer.sport,offer.eventId,offer.playerName,offer.marketId,offer.market].every(id) ||
      offer.marketId !== offer.market || !['OVER','UNDER'].includes(offer.side) ||
      !finite(offer.line) || offer.line < 0 || !finite(offer.originalLine) || offer.originalLine <= offer.line ||
      ['isGoblin','isDemon','archived','stale','live','completed'].some(key=>offer[key]===true) || !finite(now)) return null;
  if (offer.id !== ['taco',offer.eventId,offer.market,offer.playerName,offer.side,offer.line].join('|')) return null;
  const observed=date(offer.observedAt), expires=date(offer.expiresAt), game=date(offer.gameStartTime);
  if (![observed,expires,game].every(Number.isFinite) || observed>now || observed>=expires ||
      expires<=now || game<=now || now-observed>=TACO_FRESHNESS_MS) return null;
  return {offerId:offer.id,validUntil:Math.min(expires,game,observed+TACO_FRESHNESS_MS)};
}
