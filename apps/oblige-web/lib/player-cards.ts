import type { PropGroup, PropRow } from './types';

const clean = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const id = (group: PropGroup) => clean(group.providerPlayerId);
const name = (group: PropGroup) => clean(group.player);

/** A game, not merely a matchup. Doubleheaders and separate dates stay separate. */
export function playerGameKey(group: PropGroup): string {
  const at = group.startsAt ? Date.parse(group.startsAt) : NaN;
  const home = clean(group.homeTeam), away = clean(group.awayTeam);
  if (home && away && Number.isFinite(at)) return JSON.stringify([clean(group.sport), home, away, at]);
  const event = group.quotes.map(q => q.eventId).find(Boolean);
  if (event) return JSON.stringify([clean(group.sport), 'event', event]);
  if (Number.isFinite(at) && group.matchup !== 'Matchup unavailable') return JSON.stringify([clean(group.sport), clean(group.matchup), at]);
  // Missing identity is not permission to combine unrelated games.
  return JSON.stringify([clean(group.sport), 'unverified-game', group.key]);
}

/** Lines and books are choices within a category. Periods remain different categories. */
export function playerMarketKey(group: PropGroup): string {
  const row = group.quotes[0] as (PropRow & { period?: string; periodKey?: string; dfsOddsType?: string; dfs_odds_type?: string }) | undefined;
  return JSON.stringify([clean(group.marketId || group.market), clean(group.market), clean(row?.period || row?.periodKey), clean(row?.dfsOddsType || row?.dfs_odds_type)]);
}
export type PlayerCard = { key: string; variants: PropGroup[] };
export type PlayerCardGroup = PropGroup & { playerCardKey: string; categoryCount: number; bookCount: number };

/** Resolve missing IDs only when the exact normalized name has one known ID in that game. */
export function groupPlayerCards(groups: PropGroup[]): PlayerCard[] {
  const known = new Map<string, Set<string>>();
  for (const group of groups) {
    if (!name(group) || !id(group)) continue;
    const k = JSON.stringify([playerGameKey(group), name(group)]);
    const ids = known.get(k) || new Set<string>(); ids.add(id(group)); known.set(k, ids);
  }
  const cards = new Map<string, PlayerCard>();
  for (const group of groups) {
    if (!name(group) || !clean(group.market) || !Number.isFinite(group.line)) continue;
    const game = playerGameKey(group), ids = known.get(JSON.stringify([game, name(group)]));
    const identity = id(group) || (ids?.size === 1 ? [...ids][0] : `name:${name(group)}`);
    const key = JSON.stringify([game, identity]);
    const card = cards.get(key) || { key, variants: [] };
    card.variants.push(group); cards.set(key, card);
  }
  return [...cards.values()];
}

export function bookKey(row: PropRow): string { return clean(row.sportsbookKey || row.sportsbook); }
export function bookLabel(row: PropRow): string { return String(row.sportsbook || row.sportsbookKey || '').trim(); }
export function quotedBooks(groups: PropGroup[]): { key: string; label: string }[] {
  const books = new Map<string, string>();
  for (const group of groups) for (const row of group.quotes) if (bookKey(row)) books.set(bookKey(row), bookLabel(row));
  return [...books].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}
export function restrictBook(group: PropGroup, book: string | null): PropGroup {
  const rows = group.quotes.filter(q => !book || bookKey(q) === clean(book) || clean(bookLabel(q)) === clean(book));
  // Repeated ingestion rows are not repeated quote choices.
  const quotes = [...new Map(rows.map(q => [JSON.stringify([bookKey(q), clean(q.side), q.line, q.price]), q])).values()];
  const best = (side: string) => quotes.filter(q => clean(q.side) === side && q.price !== undefined && q.price !== null && String(q.price).trim() !== '' && Number.isFinite(Number(q.price)) && Number(q.price) !== 0).sort((a, b) => Number(b.price) - Number(a.price))[0] || null;
  return { ...group, quotes, bestOver: best('over'), bestUnder: best('under') };
}

/** Filter/rank first, collapse before pagination. Preserve every other market in research. */
export function collapsePlayerCards(matching: PropGroup[], universe: PropGroup[]): PlayerCardGroup[] {
  const cards = groupPlayerCards(universe), owners = new Map<string, PlayerCard>();
  for (const card of cards) for (const variant of card.variants) owners.set(variant.key, card);
  const seen = new Set<string>(), rows: PlayerCardGroup[] = [];
  for (const preview of matching) {
    const card = owners.get(preview.key);
    if (!card || seen.has(card.key)) continue;
    seen.add(card.key);
    rows.push({ ...preview, playerCardKey: card.key, categoryCount: new Set(card.variants.map(playerMarketKey)).size, bookCount: quotedBooks(card.variants).length });
  }
  return rows;
}

export function playerResearchHref(group: PropGroup, cardKey?: string, book?: string | null): string {
  const params = new URLSearchParams({ sport: group.sport, player: group.player, market: group.market, category: playerMarketKey(group), line: String(group.line) });
  const card = cardKey || (group as Partial<PlayerCardGroup>).playerCardKey;
  if (card) params.set('card', card);
  if (book) params.set('book', book);
  return `/research?${params}`;
}

export function playerCategories(groups: PropGroup[]): { key: string; label: string; variants: PropGroup[] }[] {
  const categories = new Map<string, { key: string; label: string; variants: PropGroup[] }>();
  for (const group of groups) {
    const key = playerMarketKey(group), category = categories.get(key) || { key, label: group.market, variants: [] };
    category.variants.push(group); categories.set(key, category);
  }
  return [...categories.values()];
}
export function postedSelection(groups: PropGroup[], category: string, book: string | null, line: number | null, market = ''): PropGroup | null {
  const categoryRows = groups.filter(g => playerMarketKey(g) === category);
  const marketRows = categoryRows.length ? categoryRows : groups.filter(g => g.market === market);
  const candidates = marketRows.length ? marketRows : groups;
  const inBook = book ? candidates.filter(g => g.quotes.some(q => bookKey(q) === clean(book) || clean(bookLabel(q)) === clean(book))) : candidates;
  // An explicit book with no offer is unavailable, never another book's quote.
  if (!inBook.length) return null;
  const selected = inBook.find(g => g.line === line) || inBook[0];
  return selected ? restrictBook(selected, book) : null;
}
