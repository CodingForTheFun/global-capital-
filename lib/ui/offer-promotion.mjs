/** Offer-scoped presentation contract. Unknown promotion metadata never means Taco.
 * Only a trusted ingestion adapter may set verified=true after reading a source
 * Taco designation. This does not infer promotions from a line, date or player.
 * Upstream Taco availability is unverified; absent metadata never becomes a Taco.
 */
export const TACO_FRESHNESS_MS = 15 * 60_000;
export const SPECIAL_FRESHNESS_MS = 15 * 60_000;
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

/** Source-verified PrizePicks alternate projection marker.
 * A badge is only customer-visible when PrizePicks explicitly binds the
 * Goblin/Demon designation to this exact More/Over or Less/Under outcome.
 * Projection-level metadata without a verified side is retained upstream for
 * diagnostics, but is intentionally not rendered as a customer-facing badge.
 */
export function verifiedPrizePicksSpecial(offer, now=Date.now()) {
  if (!offer || offer.sportsbookKey !== 'prizepicks' || offer.isAlternate !== true || offer.specialVerified !== true ||
      !['goblin','demon'].includes(offer.specialType) || !finite(offer.line) || !id(offer.specialSourceId) ||
      offer.archived === true || offer.stale === true || offer.live === true || offer.completed === true || !finite(now)) return null;
  if (!['OVER','UNDER'].includes(offer.side) || offer.specialTypeSource !== 'outcome_metadata' || offer.specialSideVerified !== true) return null;
  const seen=date(offer.ingestedAt), game=date(offer.gameStartTime);
  if (!Number.isFinite(seen) || !Number.isFinite(game) || seen>now || game<=now || now-seen>=SPECIAL_FRESHNESS_MS) return null;
  return {type:offer.specialType,side:offer.side,line:offer.line,sourceId:offer.specialSourceId,validUntil:Math.min(game,seen+SPECIAL_FRESHNESS_MS)};
}
function demonFaceSvg(){
  return '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M6.2 8.7 2.8 3.4c-.4-.7.4-1.5 1.1-1.1l6 3.1A11 11 0 0 1 14 4.6a11 11 0 0 1 4.1.8l6-3.1c.7-.4 1.5.4 1.1 1.1l-3.4 5.3a10.7 10.7 0 1 1-15.6 0Z" fill="currentColor"/><path d="m8.3 12.2 4 1.1-3.1 2.1m10.5-3.2-4 1.1 3.1 2.1M9.5 19.1c2.6 1.9 6.4 1.9 9 0" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function goblinFaceSvg(){
  return '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4.9 10.1.9 8.7c-.8-.3-1.3.7-.7 1.3l4 3.7a10.1 10.1 0 0 0-.2 2 10 10 0 0 0 20 0 10.1 10.1 0 0 0-.2-2l4-3.7c.6-.6.1-1.6-.7-1.3l-4 1.4A10 10 0 0 0 14 5.7a10 10 0 0 0-9.1 4.4Z" fill="currentColor"/><path d="m8 13 4.3 1-3.1 2m10.8-3-4.3 1 3.1 2M9.5 19.4c2.7 1.3 6.3 1.3 9 0" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
export function prizePicksSpecialFaceHtml(offer,now=Date.now()) {
  const special=verifiedPrizePicksSpecial(offer,now);
  if(!special)return '';
  const demon=special.type==='demon', label=demon?'PrizePicks Demon':'PrizePicks Goblin';
  const detail=special.side==='OVER'?'source-verified More variant':'source-verified Less variant';
  return '<span class="asPpFace '+(demon?'demon':'goblin')+'" data-pp-special-until="'+special.validUntil+'" data-pp-special-id="'+esc(special.sourceId)+'" role="img" aria-label="'+label+'" title="'+label+' · '+detail+'">'+(demon?demonFaceSvg():goblinFaceSvg())+'</span>';
}
export function removeExpiredPrizePicksSpecials(root,now=Date.now()) {
  root?.querySelectorAll('[data-pp-special-until]').forEach(node=>{
    const until=Number(node.dataset.ppSpecialUntil);
    if(!Number.isFinite(until)||until<=now)node.remove();
  });
}
