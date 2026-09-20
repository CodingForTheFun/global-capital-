import type { PropGroup, PropRow } from './types';
import { knownNflTeam, sameExplicitTeam } from './player-identity';
import { isDfs, quotePeriod, quoteVariant, variantKey } from './prop-signals';

const clean = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const id = (group: PropGroup) => clean(group.providerPlayerId);
// Presentation identity only; original player names and provider IDs stay on quotes.
const name = (group: PropGroup) => clean(group.player).replace(/[.’']/g, '').replace(/\s+(?:jr|sr|ii|iii|iv)$/i, '').trim();
const gameTeam = (value: unknown, sport: string) => clean(sport) === 'nfl' ? knownNflTeam(value) || teamLabel(value) : teamLabel(value);


/** A game, not merely a matchup. Doubleheaders and separate dates stay separate. */
export function playerGameKey(group: PropGroup): string {
  const at = group.startsAt ? Date.parse(group.startsAt) : NaN;
  const home = gameTeam(group.homeTeam, group.sport), away = gameTeam(group.awayTeam, group.sport);
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
  const home = gameTeam(group.homeTeam, group.sport), away = gameTeam(group.awayTeam, group.sport);
  const team = gameTeam(group.team, group.sport), opponent = gameTeam(group.opponent, group.sport);
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
const knownMarketLabels: Record<string, RegExp> = {
  player_pass_yds: /^(?:pass|passing) (?:yards|yds)$/,
  player_rush_yds: /^(?:rush|rushing) (?:yards|yds)$/,
  player_reception_yds: /^(?:rec|receiving|reception) (?:yards|yds)$/,
  player_receptions: /^receptions$/,
  player_pass_attempts: /^(?:pass|passing) attempts$/,
  player_rush_attempts: /^(?:rush|rushing) attempts$/,
  player_pass_tds: /^(?:pass|passing) (?:tds|touchdowns)$/,
  player_rush_tds: /^(?:rush|rushing) (?:tds|touchdowns)$/,
  player_rush_reception_yds: /^(?:rush\s*\+\s*rec) (?:yards|yds)$/,
};
export function playerMarketKey(group: PropGroup): string {
  const row = group.quotes[0], key = clean(group.marketId || group.market), label = clean(group.market);
  // Only audited label aliases share a category. Unknown same-ID labels stay distinct.
  return JSON.stringify([key, knownMarketLabels[key]?.test(label) ? key : label, clean(group.period || quotePeriod(row)), variantKey(row)]);
}
export type PlayerCard = { key: string; variants: PropGroup[]; aliases?: string[] };
export type PlayerCardGroup = PropGroup & { playerCardKey: string; cardAliases: string[]; categoryCount: number; bookCount: number; bookNames: string[]; specialVariants: PropGroup[] };

/** One card per athlete per game; source-local IDs never create duplicate player cards by themselves. */
export function groupPlayerCards(groups: PropGroup[]): PlayerCard[] {
  groups = groups.filter(group => name(group) && clean(group.market) && Number.isFinite(group.line));
  const games = resolvedGameKeys(groups);

  // Provider IDs are quote-source identities, not reliable athlete identities.
  // Inside one verified game, collapse by normalized player name. The only
  // namesake split we make is when the same name is explicitly attached to
  // both sides of the same matchup. A side-less row stays isolated in that
  // rare ambiguous case rather than being attached to the wrong athlete.
  const sideOf = (group: PropGroup) => {
    const team = gameTeam(group.team, group.sport), home = gameTeam(group.homeTeam, group.sport), away = gameTeam(group.awayTeam, group.sport);
    if (!team) return '';
    if (home && (team === home || sameExplicitTeam(group.team, group.homeTeam, group.sport))) return 'home';
    if (away && (team === away || sameExplicitTeam(group.team, group.awayTeam, group.sport))) return 'away';
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
  const rawCards = [...cards.values()];

  // A few providers describe the same game differently (for example DAL/PHX
  // versus Dallas Wings @ Phoenix Mercury) or round the scheduled timestamp by
  // a few minutes. That metadata must not create a second card for the same
  // athlete. Reconcile only within one sport + exact normalized player, within
  // a very small kickoff window, and only when the matchup evidence is
  // compatible. Conflicting full opponents and same-name athletes on opposite
  // sides remain separate.
  const KICKOFF_TOLERANCE_MS = 10 * 60 * 1000;
  const cardStart = (card: PlayerCard) => {
    const values = [...new Set(card.variants.map(startOf).filter(Number.isFinite))] as number[];
    return values.length === 1 ? values[0] : NaN;
  };
  const cardSport = (card: PlayerCard) => clean(card.variants[0]?.sport);
  const cardName = (card: PlayerCard) => name(card.variants[0]);
  const codeLikeTeam = (label: string) => !label.includes(' ') && /^[a-z0-9.-]{1,5}$/.test(label);
  const teamCompatible = (a: string, b: string) => (
    a === b ||
    codeLikeTeam(a) ||
    codeLikeTeam(b) ||
    (a.length >= 3 && b.startsWith(a)) ||
    (b.length >= 3 && a.startsWith(b))
  );
  const pairParts = (group: PropGroup): [string, string] | null => {
    const pair = teamPair(group);
    if (!pair) return null;
    try {
      const parsed = JSON.parse(pair);
      return Array.isArray(parsed) && parsed.length === 2 ? [String(parsed[0]), String(parsed[1])] : null;
    } catch {
      return null;
    }
  };
  const pairCompatible = (a: [string, string], b: [string, string]) => (
    (teamCompatible(a[0], b[0]) && teamCompatible(a[1], b[1])) ||
    (teamCompatible(a[0], b[1]) && teamCompatible(a[1], b[0]))
  );
  const cardsByPlayer = new Map<string, PlayerCard[]>();
  for (const card of rawCards) {
    const key = JSON.stringify([cardSport(card), cardName(card)]);
    const found = cardsByPlayer.get(key) || [];
    found.push(card);
    cardsByPlayer.set(key, found);
  }

  const reconciled: PlayerCard[] = [];
  for (const playerCards of cardsByPlayer.values()) {
    const dated = playerCards
      .filter(card => Number.isFinite(cardStart(card)))
      .map((card, order) => ({ card, at: cardStart(card), order }))
      .sort((a, b) => a.at - b.at || a.order - b.order);
    const undated = playerCards.filter(card => !Number.isFinite(cardStart(card)));
    let cluster: PlayerCard[] = [];
    let anchor = NaN;

    const flush = () => {
      if (!cluster.length) return;
      if (cluster.length === 1) {
        reconciled.push(cluster[0]);
        cluster = [];
        return;
      }
      const explicitSides = new Set(
        cluster.flatMap(card => card.variants.map(sideOf)).filter(Boolean),
      );
      const pairs = cluster
        .flatMap(card => card.variants.map(pairParts))
        .filter((pair): pair is [string, string] => Boolean(pair));
      const matchupConflict = pairs.some((pair, index) =>
        pairs.slice(index + 1).some(other => !pairCompatible(pair, other)),
      );

      if (explicitSides.size > 1 || matchupConflict) {
        reconciled.push(...cluster);
      } else {
        const variants = cluster.flatMap(card => card.variants);
        const key = cluster.map(card => card.key).sort()[0];
        reconciled.push({ key, variants });
      }
      cluster = [];
    };

    for (const item of dated) {
      if (!cluster.length) {
        cluster = [item.card];
        anchor = item.at;
        continue;
      }
      if (Math.abs(item.at - anchor) <= KICKOFF_TOLERANCE_MS) {
        cluster.push(item.card);
      } else {
        flush();
        cluster = [item.card];
        anchor = item.at;
      }
    }
    flush();
    reconciled.push(...undated);
  }

  // Retain previously emitted deep links after presentation identity repair.
  return reconciled.map(card => ({...card, aliases: [...new Set(card.variants.flatMap(group => {
    const at = startOf(group), home = clean(group.homeTeam), away = clean(group.awayTeam);
    const previousGame = home && away && Number.isFinite(at)
      ? JSON.stringify([clean(group.sport), home, away, at]) : playerGameKey(group);
    const names = [group.player, ...group.quotes.map(quote => quote.playerName).filter(Boolean)];
    return [previousGame, playerGameKey(group)].flatMap(game => names.map(player => JSON.stringify([game, clean(player)])));
  }))]}));
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
  const period = group.period || quotePeriod(group.quotes[0]) || /(?:^|[\s_·])(?:[1-4][HQ]|[HQ][1-4]|half|quarter|inning|period)(?:$|[\s_·])/i.test(`${group.market} ${group.marketId || ''}`);
  const pricedQuotes = group.quotes.filter(row => {
    if (isDfs(row)) return false;
    if (row.price === null || row.price === undefined || String(row.price).trim() === '') return false;
    const price = Number(row.price);
    return Number.isFinite(price) && price !== 0;
  }).length;
  const books = new Set(group.quotes.map(bookKey).filter(Boolean)).size;
  return (
    (quoteVariant(group.quotes[0]) === 'standard' ? 100 : 0) +
    // Lead with an ordinary box-score market, not alphabetical exotic markets.
    (/^(?:player_(?:pass_yds|rush_yds|reception_yds|receptions|points|rebounds|assists|shots_on_goal)|pitcher_strikeouts|batter_(?:hits|total_bases))$/.test(group.marketId || '') ? 90 : 0) +
    (period ? 0 : 40) +
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
    const exactRows = (matchesByCard.get(card.key) || [preview]).filter(row => playerMarketKey(row) === playerMarketKey(preview) && row.line === preview.line);
    const books = quotedBooks(exactRows);
    const combined = restrictBook({ ...preview, quotes: exactRows.flatMap(row => row.quotes) }, null);
    rows.push({
      ...combined,
      playerCardKey: card.key,
      cardAliases: card.aliases || [],
      categoryCount: new Set(card.variants.map(playerMarketKey)).size,
      bookCount: books.length,
      bookNames: books.map(book => book.label),
      specialVariants: (matchesByCard.get(card.key) || []).filter(row => quoteVariant(row.quotes[0]) !== 'standard'),
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

/** Old local-device saves keep matching after a presentation identity repair. */
export function isSavedCard(card: Pick<PlayerCardGroup, 'playerCardKey' | 'cardAliases'>, saved: string[]): boolean {
  return saved.some(key => key === card.playerCardKey || card.cardAliases.includes(key));
}
export function toggleSavedCard(card: Pick<PlayerCardGroup, 'playerCardKey' | 'cardAliases'>, saved: string[]): string[] {
  const remaining = saved.filter(key => key !== card.playerCardKey && !card.cardAliases.includes(key));
  return isSavedCard(card, saved) ? remaining : [...remaining, card.playerCardKey].slice(-200);
}
