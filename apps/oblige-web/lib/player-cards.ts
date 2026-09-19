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

/** Placeholder labels are missing evidence, not distinct opponents. */
const teamLabel = (value: unknown) => {
  const label = clean(value);
  return /^(?:tbd|tba|unknown|unavailable|team [ab]|matchup unavailable)$/.test(label) ? '' : label;
};
function teamPair(group: PropGroup): string | null {
  const home = teamLabel(group.homeTeam), away = teamLabel(group.awayTeam);
  const team = teamLabel(group.team), opponent = teamLabel(group.opponent);
  const pair = home && away ? [home, away] : team && opponent ? [team, opponent] : null;
  return pair && pair[0] !== pair[1] ? JSON.stringify(pair.sort()) : null;
}
const eventIds = (group: PropGroup) => [...new Set(group.quotes.map(q => String(q.eventId ?? '').trim()).filter(Boolean))];
const startOf = (group: PropGroup) => group.startsAt ? Date.parse(group.startsAt) : NaN;

/**
 * Reconcile book-local game IDs against evidence in this board snapshot only.
 * Exact player + kickoff can attach incomplete metadata to one known matchup.
 * An undated offer needs a shared event ID. No nearest-game/name-only guessing,
 * recursive union, provider requests, or mutation of the underlying quotes.
 */
function resolvedGameKeys(groups: PropGroup[]): Map<PropGroup, string> {
  const resolved = new Map(groups.map(group => [group, playerGameKey(group)]));
  const facts = new Map(groups.map(group => [group, {
    sport: clean(group.sport), id: id(group), name: name(group), at: startOf(group),
    pair: teamPair(group), events: eventIds(group),
    full: Boolean(teamLabel(group.homeTeam) && teamLabel(group.awayTeam)),
  }]));
  type Index = Map<string, Set<PropGroup>>;
  const byStart: Index = new Map(), byEvent: Index = new Map();
  const tokens = (group: PropGroup, evidence: string) => {
    const f = facts.get(group)!;
    // Sportsbooks and DFS feeds can assign different provider-local IDs to the
    // same athlete. Exact normalized name + exact game evidence is the stable
    // presentation identity; only fall back to an ID when a name is missing.
    return [
      ...(f.name ? [JSON.stringify([f.sport, 'name', f.name, evidence])] : []),
      ...(!f.name && f.id ? [JSON.stringify([f.sport, 'id', f.id, evidence])] : []),
    ];
  };
  const add = (index: Index, group: PropGroup, evidence: string) => {
    for (const token of tokens(group, evidence)) {
      const entries = index.get(token) || new Set<PropGroup>();
      entries.add(group); index.set(token, entries);
    }
  };
  const lookup = (index: Index, group: PropGroup, evidence: string) => {
    const found = new Set<PropGroup>(), own = facts.get(group)!;
    for (const token of tokens(group, evidence)) for (const candidate of index.get(token) || []) {
      const peer = facts.get(candidate)!;
      if ((own.name && own.name === peer.name) || (!own.name && own.id && own.id === peer.id)) found.add(candidate);
    }
    return [...found];
  };
  const timed = groups.filter(group => Number.isFinite(facts.get(group)!.at));
  for (const group of timed) add(byStart, group, String(facts.get(group)!.at));

  type Anchor = { key: string; full: boolean; events: Set<string> };
  type Evidence = { anchors: Map<string, Anchor> };
  // Once per player/start, not once per market/line: dense boards must stay responsive.
  const contexts = new Map<string, Evidence>();
  for (const group of timed) {
    const own = facts.get(group)!;
    const contextKey = JSON.stringify([own.sport, own.name || `id:${own.id}`, own.at]);
    let context = contexts.get(contextKey);
    if (!context) {
      context = { anchors: new Map() };
      for (const peer of lookup(byStart, group, String(own.at))) {
        const f = facts.get(peer)!;
        if (!f.pair) continue;
        const key = f.full ? playerGameKey(peer) : JSON.stringify([f.sport, 'matchup', f.pair, f.at]);
        const anchor = context.anchors.get(f.pair) || { key, full: f.full, events: new Set<string>() };
        if ((f.full && !anchor.full) || (f.full === anchor.full && key < anchor.key)) { anchor.key = key; anchor.full = f.full; }
        for (const event of f.events) anchor.events.add(event);
        context.anchors.set(f.pair, anchor);
      }
      contexts.set(contextKey, context);
    }
    let anchors = own.pair ? [context.anchors.get(own.pair)!] : [...context.anchors.values()];
    if (!own.pair && anchors.length > 1) {
      const linked = anchors.filter(anchor => own.events.some(event => anchor.events.has(event)));
      // Ambiguous partial rows must never join two verified matchups transitively.
      anchors = linked.length === 1 ? linked : [];
    }
    if (anchors.length === 1) {
      // Keep full-matchup deep links when present; books/lines never enter the key.
      resolved.set(group, anchors[0].key);
    } else if (context.anchors.size === 0 && (own.name || own.id)) {
      resolved.set(group, JSON.stringify([own.sport, 'player-start', own.at]));
    }
  }

  // Only originally dated rows are anchors. An inferred date is never reused as evidence.
  for (const group of timed) for (const event of facts.get(group)!.events) add(byEvent, group, event);
  for (const group of groups) {
    const own = facts.get(group)!;
    if (Number.isFinite(own.at)) continue;
    const candidates = new Set<string>();
    for (const event of own.events) for (const peer of lookup(byEvent, group, event)) {
      const peerPair = facts.get(peer)!.pair;
      if (own.pair && peerPair && own.pair !== peerPair) continue;
      candidates.add(resolved.get(peer)!);
    }
    if (candidates.size === 1) resolved.set(group, [...candidates][0]);
  }
  return resolved;
}

/** Lines and books are choices within a category. Periods remain different categories. */
export function playerMarketKey(group: PropGroup): string {
  const row = group.quotes[0] as (PropRow & { period?: string; periodKey?: string; dfsOddsType?: string; dfs_odds_type?: string }) | undefined;
  return JSON.stringify([clean(group.marketId || group.market), clean(group.market), clean(row?.period || row?.periodKey), clean(row?.dfsOddsType || row?.dfs_odds_type)]);
}
export type PlayerCard = { key: string; variants: PropGroup[] };
export type PlayerCardGroup = PropGroup & { playerCardKey: string; categoryCount: number; bookCount: number; bookNames: string[] };

/** Resolve missing IDs only when the exact normalized name has one known ID in that game. */
export function groupPlayerCards(groups: PropGroup[]): PlayerCard[] {
  groups = groups.filter(group => name(group) && clean(group.market) && Number.isFinite(group.line));
  const games = resolvedGameKeys(groups);

  // Provider IDs are quote-source identities, not reliable athlete identities.
  // Inside one verified game, collapse by normalized player name. The only
  // namesake split we make is when the same name is explicitly attached to
  // both sides of the same matchup. A side-less row stays isolated in that
  // rare ambiguous case rather than being attached to the wrong athlete.
  const sideOf = (group: PropGroup) => {
    const team = teamLabel(group.team), home = teamLabel(group.homeTeam), away = teamLabel(group.awayTeam);
    if (!team) return '';
    if (home && team === home) return 'home';
    if (away && team === away) return 'away';
    return '';
  };
  const sides = new Map<string, Set<string>>();
  for (const group of groups) {
    const base = JSON.stringify([games.get(group)!, name(group)]);
    const side = sideOf(group);
    if (!side) continue;
    const found = sides.get(base) || new Set<string>();
    found.add(side);
    sides.set(base, found);
  }

  const cards = new Map<string, PlayerCard>();
  for (const group of groups) {
    const game = games.get(group)!;
    const playerName = name(group);
    const base = JSON.stringify([game, playerName]);
    const contested = (sides.get(base)?.size || 0) > 1;
    const side = sideOf(group);
    const identity = contested
      ? side ? `${playerName}|side:${side}` : `${playerName}|unresolved:${group.key}`
      : playerName;
    const key = JSON.stringify([game, identity]);
    const card = cards.get(key) || { key, variants: [] };
    card.variants.push(group);
    cards.set(key, card);
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

function previewScore(group: PropGroup): number {
  const pricedQuotes = group.quotes.filter(row => {
    if (row.price === null || row.price === undefined || String(row.price).trim() === '') return false;
    const price = Number(row.price);
    return Number.isFinite(price) && price !== 0;
  }).length;
  const books = new Set(group.quotes.map(bookKey).filter(Boolean)).size;
  return (
    (Number.isFinite(group.line) ? 100 : 0) +
    Math.min(pricedQuotes, 4) * 12 +
    Math.min(books, 4) * 4 +
    (group.bestOver || group.bestUnder ? 8 : 0) +
    (group.providerPlayerId ? 5 : 0) +
    (group.marketId ? 5 : 0) +
    (group.startsAt ? 3 : 0) +
    (teamPair(group) ? 2 : 0)
  );
}

/** Filter/rank first, collapse before pagination. Preserve every other market in research. */
export function collapsePlayerCards(matching: PropGroup[], universe: PropGroup[]): PlayerCardGroup[] {
  const cards = groupPlayerCards(universe), owners = new Map<string, PlayerCard>();
  for (const card of cards) for (const variant of card.variants) owners.set(variant.key, card);

  // Matching rows can be book-restricted clones, so retain those exact clones
  // when choosing the one preview shown on the board.
  const matchesByCard = new Map<string, PropGroup[]>();
  for (const row of matching) {
    const card = owners.get(row.key);
    if (!card) continue;
    const rows = matchesByCard.get(card.key) || [];
    rows.push(row);
    matchesByCard.set(card.key, rows);
  }

  const seen = new Set<string>(), rows: PlayerCardGroup[] = [];
  for (const firstMatch of matching) {
    const card = owners.get(firstMatch.key);
    if (!card || seen.has(card.key)) continue;
    seen.add(card.key);
    const preview = [...(matchesByCard.get(card.key) || [firstMatch])]
      .sort((a, b) => previewScore(b) - previewScore(a) || a.key.localeCompare(b.key))[0];
    const books = quotedBooks(card.variants);
    rows.push({
      ...preview,
      playerCardKey: card.key,
      categoryCount: new Set(card.variants.map(playerMarketKey)).size,
      bookCount: books.length,
      bookNames: books.map(book => book.label),
    });
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
