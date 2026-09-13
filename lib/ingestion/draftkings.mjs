import { record } from './normalize.mjs';

const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const numeric = (value) => {
  if (value && typeof value === 'object') value = value.american ?? value.americanOdds ?? value.value;
  const n = Number(String(value ?? '').replace('+', ''));
  return Number.isFinite(n) ? n : null;
};
const slug = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sideOf = (value) => {
  const s = text(value).toUpperCase();
  return s.includes('UNDER') ? 'UNDER' : s.includes('OVER') ? 'OVER' : null;
};

function eventIndex(payload) {
  const group = payload?.eventGroup || payload || {};
  const map = new Map();
  for (const event of [...list(group.events), ...list(payload?.events)]) {
    const id = text(event?.eventId ?? event?.id);
    if (id) map.set(id, event);
  }
  return map;
}

function offerRows(payload) {
  const group = payload?.eventGroup || payload || {};
  const rows = [];
  for (const category of list(group.offerCategories || payload?.offerCategories)) {
    for (const descriptor of list(category?.offerSubcategoryDescriptors || category?.offerSubcategories)) {
      const market = text(descriptor?.name || descriptor?.offerSubcategory?.name || category?.name);
      const groups = list(descriptor?.offerSubcategory?.offers || descriptor?.offers);
      for (const batch of groups) {
        for (const offer of (Array.isArray(batch) ? batch : [batch])) rows.push({ offer, market });
      }
    }
  }
  return rows;
}

/**
 * DraftKings' public event-group document is not a stable public contract, so
 * this adapter is intentionally fail-closed. A player/market is accepted only
 * when exactly one full-game threshold survives; ambiguous alternate ladders
 * are discarded instead of being mislabeled as the main line.
 */
export function normalizeDraftKings(payload, sport) {
  const events = eventIndex(payload);
  const candidates = new Map();
  for (const { offer, market } of offerRows(payload)) {
    if (!offer || offer.isSuspended === true || offer.isOpen === false || offer.isLive === true || offer.isAlternate === true) continue;
    if (/alternate|1st half|first half|quarter|period/i.test(`${market} ${text(offer?.label)}`)) continue;
    const eventId = text(offer?.eventId ?? offer?.event?.id);
    const event = events.get(eventId) || offer?.event || {};
    const gameStartTime = event?.startDate ?? event?.startDateTime ?? event?.startTime ?? offer?.startDate ?? offer?.startTime;
    const homeTeam = text(event?.homeTeamName ?? event?.homeTeam ?? event?.participants?.find?.((p) => p?.venueRole === 'Home')?.name);
    const awayTeam = text(event?.awayTeamName ?? event?.awayTeam ?? event?.participants?.find?.((p) => p?.venueRole === 'Away')?.name);
    for (const outcome of list(offer?.outcomes)) {
      if (!outcome || outcome.isSuspended === true || outcome.isOpen === false) continue;
      const side = sideOf(outcome?.label ?? outcome?.name ?? outcome?.outcomeType);
      const line = numeric(outcome?.line ?? outcome?.points ?? outcome?.point ?? offer?.line ?? offer?.points);
      const participant = outcome?.participant && typeof outcome.participant === 'object' ? outcome.participant : null;
      const playerName = text(outcome?.participantName ?? participant?.name ?? outcome?.playerName ?? outcome?.description);
      if (!side || line === null || !playerName || !market || !eventId || !gameStartTime) continue;
      const playerId = text(outcome?.participantId ?? participant?.id ?? outcome?.playerId) || `name:${slug(playerName)}`;
      const baseKey = JSON.stringify([eventId, playerId, market]);
      const lineKey = String(line);
      if (!candidates.has(baseKey)) candidates.set(baseKey, new Map());
      const thresholds = candidates.get(baseKey);
      if (!thresholds.has(lineKey)) thresholds.set(lineKey, { eventId, playerId, playerName, market, line, gameStartTime, homeTeam, awayTeam, team: text(outcome?.teamName ?? outcome?.team), position: text(outcome?.position), offerId: text(offer?.id ?? offer?.offerId), sides: new Map() });
      thresholds.get(lineKey).sides.set(side, numeric(outcome?.oddsAmerican ?? outcome?.americanOdds ?? outcome?.odds));
    }
  }

  const output = [];
  for (const thresholds of candidates.values()) {
    // Multiple thresholds for the same player/market means an alternate ladder.
    if (thresholds.size !== 1) continue;
    const item = thresholds.values().next().value;
    if (!item?.sides?.size) continue;
    const normalized = record({
      sourceId: `${item.offerId || item.eventId}:${item.playerId}:${slug(item.market)}`,
      book: 'draftkings',
      nativePlayerId: item.playerId,
      playerName: item.playerName,
      sport,
      market: item.market,
      line: item.line,
      team: item.team,
      opponent: '',
      nativeEventId: item.eventId,
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      gameStartTime: item.gameStartTime,
      updatedAt: null,
      position: item.position,
      sides: [...item.sides.keys()],
    });
    if (!normalized) continue;
    normalized.overOdds = item.sides.get('OVER') ?? null;
    normalized.underOdds = item.sides.get('UNDER') ?? null;
    output.push(normalized);
  }
  return output;
}
