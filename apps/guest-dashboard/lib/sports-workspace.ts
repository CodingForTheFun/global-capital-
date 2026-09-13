// Presentation only. The existing Auto Scout API owns qualification and pricing.
export type Quote = {
  id: string; sport: string; eventId: string; playerId: string; playerName: string;
  market: string; marketId: string; line: number; side: 'OVER' | 'UNDER';
  price: number | null; sportsbookKey: string; sportsbook: string;
  team: string; homeTeam: string; awayTeam: string; gameStartTime: string;
  live: boolean; entityType: string;
};
export type Group = { key: string; player: string; market: string; sport: string; matchup: string; quotes: Quote[] };
const text = (x: unknown) => typeof x === 'string' ? x : '';
export function quotesFromPayload(payload: unknown): Quote[] {
  if (!payload || typeof payload !== 'object') return [];
  const input = (payload as { props?: unknown }).props;
  if (!Array.isArray(input)) return [];
  return input.filter(r => r && typeof r === 'object' && !r.isAlternate &&
    typeof r.playerName === 'string' && r.playerName.trim() && typeof r.market === 'string' &&
    typeof r.line === 'number' && Number.isFinite(r.line) && ['OVER', 'UNDER'].includes(r.side) &&
    typeof r.sportsbookKey === 'string' && r.sportsbookKey).map(r => ({
    id: text(r.id) || [r.eventId, r.playerId || r.playerName, r.marketId || r.market, r.sportsbookKey, r.side, r.line].join('|'),
    sport: text(r.sport), eventId: text(r.eventId), playerId: text(r.playerId), playerName: text(r.playerName),
    market: text(r.market), marketId: text(r.marketId), line: r.line, side: r.side,
    price: typeof r.price === 'number' && Number.isFinite(r.price) && Math.abs(r.price) >= 100 ? r.price : null,
    sportsbookKey: text(r.sportsbookKey), sportsbook: text(r.sportsbook) || text(r.sportsbookName) || text(r.sportsbookKey),
    team: text(r.team), homeTeam: text(r.homeTeam), awayTeam: text(r.awayTeam), gameStartTime: text(r.gameStartTime),
    live: r.live === true, entityType: text(r.entityType) || 'player',
  }));
}
export function groupQuotes(quotes: Quote[]): Group[] {
  const groups = new Map<string, Group>();
  for (const quote of quotes) {
    const key = [quote.sport, quote.eventId, quote.playerId || quote.playerName, quote.marketId || quote.market].join('|');
    if (!groups.has(key)) groups.set(key, { key, player: quote.playerName, market: quote.market, sport: quote.sport,
      matchup: quote.awayTeam && quote.homeTeam ? `${quote.awayTeam} @ ${quote.homeTeam}` : 'Matchup unavailable', quotes: [] });
    const group = groups.get(key)!;
    if (!group.quotes.some(q => q.id === quote.id)) group.quotes.push(quote);
  }
  return [...groups.values()];
}
export function implied(american: number): number | null {
  if (!Number.isFinite(american) || Math.abs(american) < 100) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
export function decimalOdds(american: number): number | null {
  if (implied(american) === null) return null;
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}
export const displayPrice = (price: number | null) => price === null ? 'No odds quoted' : price > 0 ? `+${price}` : String(price);
export function exportCsv(quotes: Quote[]): string {
  const cell = (x: string | number | null) => {
    let value = x === null ? '' : String(x);
    if (typeof x === 'string' && /^[\s]*[=+@-]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  return [['Sport', 'Player / entity', 'Market', 'Side', 'Line', 'American odds', 'Book', 'Scheduled start'],
    ...quotes.map(q => [q.sport, q.playerName, q.market, q.side, q.line, q.price, q.sportsbook, q.gameStartTime])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
