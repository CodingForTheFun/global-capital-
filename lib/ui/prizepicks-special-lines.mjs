const finite = value => typeof value === 'number' && Number.isFinite(value);
const date = value => typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const SPECIAL_FRESHNESS_MS = 15 * 60_000;

export function verifiedPrizePicksSpecial(offer, now = Date.now()) {
  if (!offer || offer.sportsbookKey !== 'prizepicks' || offer.isAlternate !== true || offer.specialVerified !== true ||
      !['goblin','demon'].includes(offer.specialType) || !['OVER','UNDER'].includes(offer.side) || !finite(offer.line) ||
      typeof offer.specialSourceId !== 'string' || !offer.specialSourceId.trim() || offer.archived === true || offer.stale === true ||
      offer.live === true || offer.completed === true || !finite(now)) return null;
  const seen = date(offer.ingestedAt), game = date(offer.gameStartTime);
  if (!Number.isFinite(seen) || !Number.isFinite(game) || seen > now || game <= now || now - seen >= SPECIAL_FRESHNESS_MS) return null;
  return { type: offer.specialType, side: offer.side, line: offer.line, sourceId: offer.specialSourceId, validUntil: Math.min(game, seen + SPECIAL_FRESHNESS_MS) };
}

function demonSvg() {
  return '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M6.2 8.7 2.8 3.4c-.4-.7.4-1.5 1.1-1.1l6 3.1A11 11 0 0 1 14 4.6a11 11 0 0 1 4.1.8l6-3.1c.7-.4 1.5.4 1.1 1.1l-3.4 5.3a10.7 10.7 0 1 1-15.6 0Z" fill="currentColor"/><path d="m8.3 12.2 4 1.1-3.1 2.1m10.5-3.2-4 1.1 3.1 2.1M9.5 19.1c2.6 1.9 6.4 1.9 9 0" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function goblinSvg() {
  return '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4.9 10.1.9 8.7c-.8-.3-1.3.7-.7 1.3l4 3.7a10.1 10.1 0 0 0-.2 2 10 10 0 0 0 20 0 10.1 10.1 0 0 0-.2-2l4-3.7c.6-.6.1-1.6-.7-1.3l-4 1.4A10 10 0 0 0 14 5.7a10 10 0 0 0-9.1 4.4Z" fill="currentColor"/><path d="m8 13 4.3 1-3.1 2m10.8-3-4.3 1 3.1 2M9.5 19.4c2.7 1.3 6.3 1.3 9 0" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export function prizePicksSpecialFaceHtml(offer, now = Date.now()) {
  const special = verifiedPrizePicksSpecial(offer, now);
  if (!special) return '';
  const demon = special.type === 'demon';
  const label = demon ? 'PrizePicks Demon' : 'PrizePicks Goblin';
  return '<span class="asPpFace '+(demon?'demon':'goblin')+'" data-pp-special-until="'+special.validUntil+'" data-pp-special-id="'+esc(special.sourceId)+'" role="img" aria-label="'+label+'" title="'+label+' · source-verified '+(special.side==='OVER'?'More':'Less')+' variant">'+(demon?demonSvg():goblinSvg())+'</span>';
}

export function removeExpiredPrizePicksSpecials(root, now = Date.now()) {
  root?.querySelectorAll('[data-pp-special-until]').forEach(node => {
    const until = Number(node.dataset.ppSpecialUntil);
    if (!Number.isFinite(until) || until <= now) node.remove();
  });
}
