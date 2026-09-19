import type { PropGroup, PropRow, Side } from './types';
import type { WorkspacePlayer, WorkspaceMarket, WorkspaceOffer } from './workspace';

export type LegacyCategory = { key: string; label: string; variants: PropGroup[] };
type QuoteMetadata = PropRow & { period?: string; periodKey?: string; dfs?: boolean; dfsOddsType?: string; dfs_odds_type?: string; multiplier?: number | string; payoutMultiplier?: number | string; conflict?: boolean };
const clean = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const numeric = (value: unknown): number | null => value == null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);

/** Parse only explicit period evidence. These display fields never enter an API request. */
export function legacyPeriod(group: PropGroup): { period: string | null; label: string } {
  const row = group.quotes[0] as QuoteMetadata | undefined;
  const label = group.market.trim();
  const suffix = label.match(/\s*[·|]\s*(?:Period\s+)?(h1|h2|q1|q2|q3|q4|1h|2h|1q|2q|3q|4q|first half|second half|first quarter|second quarter|third quarter|fourth quarter)$/i);
  const rawSuffix = label.match(/_(h1|h2|q1|q2|q3|q4|1h|2h|1q|2q|3q|4q)$/i);
  const supplied = String(row?.period || row?.periodKey || suffix?.[1] || rawSuffix?.[1] || '').trim().toLowerCase();
  const known: Record<string, string> = { 'first half': 'h1', 'second half': 'h2', 'first quarter': 'q1', 'second quarter': 'q2', 'third quarter': 'q3', 'fourth quarter': 'q4' };
  return {
    period: supplied ? known[supplied] || supplied : /(?:\b(?:half|quarter|inning|period)\b)/i.test(label) ? 'as_posted' : null,
    label: suffix ? label.slice(0, suffix.index).trim() : rawSuffix ? label.slice(0, rawSuffix.index).trim() : label,
  };
}
function offerFor(category: string, group: PropGroup, row: PropRow): WorkspaceOffer | null {
  const metadata = row as QuoteMetadata;
  const book = clean(row.sportsbookKey || row.sportsbook);
  if (!book) return null;
  const rawSide = String(row.side || '').trim().toUpperCase();
  const side: Side | null = rawSide === 'OVER' || rawSide === 'UNDER' ? rawSide : null;
  const line = numeric(row.line) ?? group.line;
  const price = numeric(row.price);
  const multiplier = numeric(metadata.multiplier ?? metadata.payoutMultiplier);
  return {
    key: JSON.stringify([category, book, line, rawSide, price, multiplier]),
    outcomeId: row.id || row.propId || null,
    book, bookName: String(row.sportsbook || row.sportsbookKey || '').trim(),
    line, choice: rawSide || 'Outcome as posted', side, price, multiplier,
    updatedAt: row.providerUpdatedAt || row.updatedAt || null,
    dfs: metadata.dfs === true || ['prizepicks', 'underdog', 'underdog_fantasy'].includes(book),
    conflict: metadata.conflict === true,
  };
}

/**
 * Presentation-only adapter for /research?sport=...&player=... links emitted by
 * TerminalBoard. Canonical workspace IDs are NOT fabricated or requested.
 * Keep the existing category, game, sportsbook and quote identity exactly.
 */
export function legacyPresentation(categories: LegacyCategory[], group: PropGroup, categoryKey: string, cardKey: string, side: Side) {
  const markets: WorkspaceMarket[] = categories.map(category => {
    const first = category.variants[0];
    const scope = legacyPeriod(first);
    const row = first.quotes[0] as QuoteMetadata | undefined;
    const offers = category.variants.flatMap(variant => variant.quotes.map(quote => offerFor(category.key, variant, quote)).filter((offer): offer is WorkspaceOffer => offer !== null));
    return {
      key: category.key,
      marketKey: first.marketId || scope.label,
      // Preserve differently named categories sharing an ID. Only explicit
      // period suffixes are removed from the family display identity.
      variant: JSON.stringify([clean(scope.label), clean(row?.dfsOddsType || row?.dfs_odds_type)]),
      label: scope.label, period: scope.period,
      offers: [...new Map(offers.map(offer => [offer.key, offer])).values()],
    };
  });
  const market = markets.find(candidate => candidate.key === categoryKey) || null;
  const requestedQuote = side === 'UNDER' ? group.bestUnder : group.bestOver;
  const quote = requestedQuote || group.quotes.find(candidate => String(candidate.side).toUpperCase() === side) || group.quotes[0];
  const target = quote ? offerFor(categoryKey, group, quote) : null;
  const selected = target && market ? market.offers.find(offer => offer.key === target.key) || null : null;
  const player: WorkspacePlayer = {
    key: cardKey || group.key, playerId: group.providerPlayerId, name: group.player,
    aliases: [group.player], sport: group.sport,
    eventId: String(group.quotes.find(row => row.eventId)?.eventId || ''),
    startsAt: group.startsAt, homeTeam: group.homeTeam, awayTeam: group.awayTeam, markets,
  };
  return { player, market, selected };
}
