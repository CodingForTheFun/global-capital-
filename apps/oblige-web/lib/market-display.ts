import type { WorkspaceMarket, WorkspaceOffer } from './workspace';

/** Display text only. Never change provider keys, request parameters or grouping identity. */
const MARKET_NAMES: Record<string, string> = {
  player_rush_longest: 'Longest Rush', player_longest_rush: 'Longest Rush',
  player_reception_longest: 'Longest Reception', player_rec_longest: 'Longest Reception',
  player_pass_longest: 'Longest Completion', player_pass_longest_completion: 'Longest Completion', player_pass_yds: 'Passing Yards',
  player_rush_yds: 'Rushing Yards', player_reception_yds: 'Receiving Yards',
  player_receiving_yds: 'Receiving Yards', player_rec_yds: 'Receiving Yards',
  player_receptions: 'Receptions', player_targets: 'Targets',
  player_pass_attempts: 'Pass Attempts', player_pass_completions: 'Completions',
  player_rush_attempts: 'Rush Attempts', player_pass_tds: 'Passing Touchdowns',
  player_rush_tds: 'Rushing Touchdowns', player_reception_tds: 'Receiving Touchdowns',
  player_anytime_td: 'Anytime Touchdown', player_pass_interceptions: 'Interceptions',
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
  player_threes: 'Three-Pointers', player_steals: 'Steals', player_blocks: 'Blocks',
  player_turnovers: 'Turnovers', player_points_rebounds_assists: 'Points + Rebounds + Assists',
  player_points_rebounds: 'Points + Rebounds', player_points_assists: 'Points + Assists',
  player_rebounds_assists: 'Rebounds + Assists', player_fantasy_points: 'Fantasy Points',
  batter_hits: 'Hits', batter_total_bases: 'Total Bases', batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs', batter_runs_scored: 'Runs', batter_strikeouts: 'Batter Strikeouts',
  pitcher_strikeouts: 'Pitcher Strikeouts', pitcher_outs: 'Pitching Outs',
  pitcher_hits_allowed: 'Hits Allowed', pitcher_earned_runs: 'Earned Runs',
  player_shots_on_goal: 'Shots on Goal', player_goals: 'Goals',
  player_saves: 'Saves', player_shots: 'Shots', player_aces: 'Aces',
  player_double_faults: 'Double Faults', player_kills: 'Kills',
  player_deaths: 'Deaths', player_headshots: 'Headshots',
};
const WORDS: Record<string, string> = { yds: 'Yards', pts: 'Points', ast: 'Assists', reb: 'Rebounds', rbis: 'RBIs', rbi: 'RBIs', td: 'TD', tds: 'TDs', fg: 'Field Goals', fg3: 'Three-Pointers', ot: 'OT', h2h: 'H2H' };
/** Exact audited labels, also used to reconcile readable and raw-key categories. */
export const canonicalMarketLabel = (key: string): string | null => MARKET_NAMES[key] || null;
export function humanize(value: string): string {
  return String(value || '').trim().replace(/^player[_\s]+/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').split(' ').filter(Boolean).map(word => WORDS[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
export function marketName(market: Pick<WorkspaceMarket, 'label' | 'marketKey'>): string {
  const supplied = String(market.label || '').trim().replace(/\s*[·|]\s*Period\s+[^·|]+$/i, '').trim();
  // Preserve a provider's already readable label (including a sport-specific meaning).
  if (supplied && !supplied.includes('_')) return supplied;
  const raw = (supplied || market.marketKey || '').toLowerCase();
  return MARKET_NAMES[raw] || MARKET_NAMES[market.marketKey?.toLowerCase()] || humanize(supplied || market.marketKey) || 'Player Prop';
}
export function marketFamily(market: WorkspaceMarket): string {
  // The canonical API supplies period separately. No fuzzy identity merging.
  return JSON.stringify([market.marketKey, market.variant]);
}
export function periodName(period: string | null): string {
  const key = String(period || '').trim().toLowerCase();
  const known: Record<string, string> = { '': 'Full game', full: 'Full game', full_game: 'Full game', game: 'Full game', h1: '1H', '1h': '1H', first_half: '1H', h2: '2H', '2h': '2H', second_half: '2H', q1: '1Q', '1q': '1Q', q2: '2Q', '2q': '2Q', q3: '3Q', '3q': '3Q', q4: '4Q', '4q': '4Q', p1: '1st period', p2: '2nd period', p3: '3rd period', i1: '1st inning', first_inning: '1st inning' };
  return known[key] || humanize(key);
}
export function marketOptionName(market: WorkspaceMarket): string {
  const name = marketName(market);
  const flavor = offerVariantLabel(market.offers[0]);
  return [name, flavor && !name.toLowerCase().includes(flavor.toLowerCase()) ? flavor : '', market.period ? periodName(market.period) : ''].filter(Boolean).join(' · ');
}
export function offerVariantLabel(offer: WorkspaceOffer | null | undefined): string {
  const value = offer?.dfsOddsType || '';
  const flavor = ({ goblin: 'Goblin', demon: 'Demon', boost: 'Boost', discount: 'Discount', alternate: 'Alternate' } as Record<string, string>)[value] || '';
  return [flavor, offer?.multiplier != null && offer.multiplier > 0 && offer.multiplier !== 1 ? `${offer.multiplier}×` : ''].filter(Boolean).join(' · ');
}
export function sportName(sport: string): string {
  const names: Record<string, string> = { football_nfl: 'NFL', americanfootball_nfl: 'NFL', football_ncaaf: 'NCAAF', americanfootball_ncaaf: 'NCAAF', basketball_nba: 'NBA', basketball_wnba: 'WNBA', basketball_ncaab: 'NCAAB', baseball_mlb: 'MLB', icehockey_nhl: 'NHL', hockey_nhl: 'NHL', esports_rocket_league: 'Rocket League' };
  return names[sport.toLowerCase()] || (/^[A-Z0-9]+$/.test(sport) ? sport : humanize(sport));
}
export function offerPrice(offer: WorkspaceOffer | null | undefined): string {
  if (!offer) return '—';
  if (offer.conflict) return 'Unverified';
  if (offer.dfs) return offerVariantLabel(offer) || 'DFS';
  return offer.price === null || !Number.isFinite(offer.price) || offer.price === 0 ? '—' : `${offer.price > 0 ? '+' : '−'}${Math.abs(offer.price)}`;
}
