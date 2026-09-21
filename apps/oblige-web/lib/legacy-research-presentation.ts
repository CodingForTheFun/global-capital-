import type { PropGroup, PropRow, Side } from './types';
import type { WorkspacePlayer, WorkspaceMarket, WorkspaceOffer } from './workspace';
import { quotePeriod, quoteVariant, variantKey } from './prop-signals';

export type LegacyCategory = { key: string; label: string; variants: PropGroup[] };
type QuoteMetadata = PropRow & { period?: string; periodKey?: string; dfs?: boolean; dfsOddsType?: string; dfs_odds_type?: string; multiplier?: number | string; payoutMultiplier?: number | string; conflict?: boolean };
const clean = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const numeric = (value: unknown): number | null => value == null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const dataProviderBook = (value: unknown) => ['espn','sportsdataio','sportsgameodds','propline','clearsports','sportradar'].includes(clean(value).replace(/[^a-z0-9]/g, ''));
const validPosition = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  return !raw || /^(?:position\s*)?(?:unavailable|unknown|not\s+available|n\/?a|none|null|-)$/i.test(raw) ? null : raw;
};

/** Parse only explicit period evidence. These display fields never enter an API request. */
export function legacyPeriod(group: PropGroup): { period: string | null; label: string } {
  const row = group.quotes[0] as QuoteMetadata | undefined;
  const label = group.market.trim();
  const suffix = label.match(/\s*[·|]\s*(?:Period\s+)?(h1|h2|q1|q2|q3|q4|1h|2h|1q|2q|3q|4q|first half|second half|first quarter|second quarter|third quarter|fourth quarter)$/i);
  const rawSuffix = label.match(/_(h1|h2|q1|q2|q3|q4|1h|2h|1q|2q|3q|4q)$/i);
  const supplied = String(quotePeriod(row) || suffix?.[1] || rawSuffix?.[1] || '').trim().toLowerCase();
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
    outcomeId: row.providerOutcomeId || row.id || row.propId || null,
    book, bookName: String(row.sportsbook || row.sportsbookKey || '').trim(),
    line, choice: rawSide || 'Outcome as posted', side, price, multiplier,
    updatedAt: row.lastSeenAt || row.providerUpdatedAt || row.bookUpdatedAt || row.updatedAt || null,
    dfsOddsType: quoteVariant(row),
    lineGap: numeric(row.lineGap), liquidity: numeric(row.liquidity),
    liquidityUpdatedAt: row.liquidityUpdatedAt || null,
    lastChangeAt: row.lastChangeAt || null,
    bookOutcomeId: row.bookOutcomeId || null,
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
    const allOffers = category.variants.flatMap(variant => variant.quotes.map(quote => offerFor(category.key, variant, quote)).filter((offer): offer is WorkspaceOffer => offer !== null));
    const sportsbookOffers = allOffers.filter(offer => !dataProviderBook(offer.book) && !dataProviderBook(offer.bookName));
    const offers = sportsbookOffers.length ? sportsbookOffers : allOffers;
    return {
      key: category.key,
      marketKey: first.marketId || scope.label,
      // Preserve differently named categories sharing an ID. Only explicit
      // period suffixes are removed from the family display identity.
      variant: JSON.stringify([clean(scope.label), variantKey(row)]),
      label: scope.label, period: scope.period,
      offers: [...new Map(offers.map(offer => [offer.key, offer])).values()],
    };
  });
  const market = markets.find(candidate => candidate.key === categoryKey) || null;
  const requestedQuote = side === 'UNDER' ? group.bestUnder : group.bestOver;
  const quote = requestedQuote || group.quotes.find(candidate => String(candidate.side).toUpperCase() === side) || group.quotes[0];
  const target = quote ? offerFor(categoryKey, group, quote) : null;
  const direct = target && market ? market.offers.find(offer => offer.key === target.key) || null : null;
  const exactSide = quote && market
    ? market.offers
        .filter(offer => !offer.conflict && offer.line === group.line && (offer.side === side || offer.side === null))
        .sort((a, b) => (b.price ?? -1e9) - (a.price ?? -1e9))
    : [];
  const selected = direct || exactSide[0] || null;
  const categoryPosition = categories.flatMap(category => category.variants).map(variant => validPosition(variant.position)).find(Boolean) || null;
  const player: WorkspacePlayer = {
    key: cardKey || group.key, playerId: group.providerPlayerId, name: group.player,
    position: validPosition(group.position) || categoryPosition,
    aliases: [group.player], sport: group.sport,
    eventId: String(group.quotes.find(row => row.eventId)?.eventId || ''),
    startsAt: group.startsAt, homeTeam: group.homeTeam, awayTeam: group.awayTeam, markets,
  };
  return { player, market, selected };
}
