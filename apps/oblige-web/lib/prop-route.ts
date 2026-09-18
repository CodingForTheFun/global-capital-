import type { PropGroup, PropRow, Side } from './types';

type Query = { get(name: string): string | null };
const text = (value: unknown): string => String(value ?? '').trim();
const normalizedName = (value: unknown): string => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean' || text(value) === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function bookKey(quote: PropRow | null | undefined): string {
  return text(quote?.sportsbookKey || quote?.sportsbook);
}
export function eventIdFor(group: PropGroup): string {
  return text(group.quotes.find((quote) => text(quote.eventId))?.eventId);
}

/** A shareable address for the exact board offer; no cross-origin state or cookies. */
export function researchHref(group: PropGroup, side: Side = 'OVER', book: string | null = null): string {
  const quote = side === 'UNDER' ? group.bestUnder : group.bestOver;
  const params = new URLSearchParams({
    sport: group.sport, player: group.player, market: group.market,
    line: String(group.line), side, groupKey: group.key,
  });
  const fields: Record<string, unknown> = {
    propId: group.propId, eventId: eventIdFor(group),
    providerPlayerId: group.providerPlayerId, marketId: group.marketId,
    book: book || bookKey(quote), team: group.team, opponent: group.opponent,
    homeTeam: group.homeTeam, awayTeam: group.awayTeam, gameStartTime: group.startsAt,
  };
  for (const [key, value] of Object.entries(fields)) if (text(value)) params.set(key, text(value));
  return `/research?${params}`;
}

/** Stable IDs win. Never strip Sr/Jr or choose a namesake from a different event. */
export function playerMarkets(groups: PropGroup[], query: Query): PropGroup[] {
  const id = text(query.get('providerPlayerId'));
  const name = normalizedName(query.get('player'));
  const sport = text(query.get('sport')).toUpperCase();
  const event = text(query.get('eventId'));
  const start = text(query.get('gameStartTime'));
  return groups.filter((candidate) => {
    if (sport && candidate.sport.toUpperCase() !== sport) return false;
    if (id ? text(candidate.providerPlayerId) !== id : normalizedName(candidate.player) !== name) return false;
    if (event && !candidate.quotes.some((quote) => text(quote.eventId) === event)) return false;
    if (!event && start && candidate.startsAt !== start) return false;
    return true;
  });
}

/** A removed/moved selected line must not silently open a different market or game. */
export function selectedProp(markets: PropGroup[], query: Query): PropGroup | null {
  const key = text(query.get('groupKey'));
  const marketId = text(query.get('marketId'));
  const market = text(query.get('market'));
  const line = optionalNumber(query.get('line'));
  const matches = markets.filter((candidate) => {
    if (key && candidate.key !== key) return false;
    if (marketId && candidate.marketId !== marketId) return false;
    if (market && candidate.market !== market) return false;
    if (line !== null && candidate.line !== line) return false;
    return true;
  });
  // Old links with no market may select only when the result is unambiguous.
  return matches.length === 1 ? matches[0] : null;
}

/** Display policy, not a substitute for repairing or supplying verified game logs. */
export function historyMessage(message: unknown): string {
  return text(message).replace(/Auto\s*Scout(?:\s*Pro)?/gi, 'Oblige Props');
}
