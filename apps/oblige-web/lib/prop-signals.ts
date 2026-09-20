import type { PropRow } from './types';

const clean = (value: unknown) => String(value ?? '').trim().toLowerCase();
export function finiteNumber(value: unknown): number | null {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function isDfs(row: PropRow | null | undefined): boolean {
  const book = clean(row?.sportsbookKey || row?.sportsbook).replace(/[^a-z0-9]/g, '');
  return row?.dfs === true || ['prizepicks', 'underdog', 'underdogfantasy', 'sleeper', 'dabble'].includes(book);
}
/** Only provider-reported metadata can identify a promotion; line size never does. */
export function quoteVariant(row: PropRow | null | undefined): string {
  const supplied = clean(row?.dfsOddsType || row?.dfs_odds_type);
  if (supplied && supplied !== 'standard') return supplied;
  const special = clean(row?.specialType);
  if (row?.specialVerified === true && special && special !== 'standard') return special;
  const multiplier = finiteNumber(row?.payoutMultiplier ?? row?.multiplier);
  const book = clean(row?.sportsbookKey || row?.sportsbook).replace(/[^a-z0-9]/g, '');
  if (book.startsWith('underdog') && multiplier !== null && multiplier > 0 && multiplier !== 1) return multiplier > 1 ? 'boost' : 'discount';
  return row?.isAlternate ? 'alternate' : 'standard';
}
export function variantKey(row: PropRow | null | undefined): string {
  const variant = quoteVariant(row);
  const multiplier = finiteNumber(row?.payoutMultiplier ?? row?.multiplier);
  return multiplier !== null && multiplier > 0 && multiplier !== 1 ? `${variant}:${multiplier}` : variant;
}
export function variantLabel(row: PropRow | null | undefined): string {
  const variant = quoteVariant(row);
  const label = ({ goblin: 'Goblin', demon: 'Demon', boost: 'Boost', discount: 'Discount', alternate: 'Alternate' } as Record<string, string>)[variant] || (variant === 'standard' ? '' : variant);
  const multiplier = finiteNumber(row?.payoutMultiplier ?? row?.multiplier);
  return [label, multiplier !== null && multiplier > 0 && multiplier !== 1 ? `${multiplier}×` : ''].filter(Boolean).join(' · ');
}
export function quotePriceLabel(row: PropRow | null | undefined): string {
  if (row?.conflict) return 'Unverified';
  if (isDfs(row)) return variantLabel(row) || 'DFS';
  const price = finiteNumber(row?.price);
  return price === null || price === 0 ? 'No odds' : `${price > 0 ? '+' : ''}${price}`;
}
export function quotePeriod(row: PropRow | null | undefined): string | null {
  const period = clean(row?.period || row?.periodKey);
  // PrizePicks single_stat identifies its projection category, not a game period.
  return ['', 'game', 'full', 'full_game', 'match', 'single_stat'].includes(period) ? null : period;
}
export function quoteSeenLabel(row: PropRow | null | undefined, now = Date.now()): string | null {
  const at = Date.parse(row?.lastSeenAt || row?.providerUpdatedAt || row?.updatedAt || '');
  if (!Number.isFinite(at) || at > now) return null;
  const seconds = Math.floor((now - at) / 1000);
  const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
  return `${row?.lastSeenAt ? 'Seen' : 'Updated'} ${age} ago`;
}
