import type { WorkspaceMarket, WorkspaceOffer } from './workspace';

/** Display text only. Never change provider keys, request parameters or grouping identity. */
const MARKET_NAMES: Record<string, string> = {
  // Additional exact labels from the shared lib/ui/prop-board.mjs contract.
  player_blocks_steals: "Blocks + Steals",
  player_pass_rush_yds: "Passing + Rushing yards",
  player_rush_reception_yds: "Rushing + Receiving yards",
  player_sacks: "Sacks",
  player_sacks_taken: "Sacks taken",
  player_solo_tackles: "Solo tackles",
  player_tackles_assists: "Tackles + Assists",
  player_defensive_interceptions: "Defensive interceptions",
  player_field_goals: "Field goals made",
  player_pats: "Extra points made",
  player_kicking_points: "Kicking points",
  team_sacks: "Team defensive sacks",
  team_sacks_allowed: "Team sacks allowed",
  team_points_allowed: "Team points allowed",
  batter_runs: "Runs",
  batter_hits_runs_rbis: "Hits + Runs + RBIs",
  batter_walks: "Batter walks",
  batter_triples: "Triples",
  pitcher_outs_recorded: "Pitching outs",
  pitcher_walks: "Walks allowed",
  pitcher_innings_pitched: "Innings pitched",
  pitcher_pitches: "Pitches",
  pitcher_pitches_thrown: "Pitches",
  pitcher_batters_faced: "Batters faced",
  player_total_saves: "Saves",
  player_goals_against: "Goals against",
  player_blocked_shots: "Blocked shots",
  player_shots_on_target: "Shots on target",
  player_passes_attempted: "Passes attempted",
  player_passes_completed: "Passes completed",
  player_ace: "Aces",
  player_aces_allowed: "Aces allowed",
  player_games: "Games",
  player_games_won: "Games won",
  player_games_lost: "Games lost",
  player_sets_won: "Sets won",
  player_sets_lost: "Sets lost",
  player_total_sets: "Total sets",
  player_break_points_won: "Break points won",
  player_break_points_served: "Break points served",
  player_break_points_saved: "Break points saved",
  player_break_points_given_up: "Break points given up",
  player_points_won: "Points won",
  player_total_points_won: "Points won",
  player_first_serve_points_won: "1st serve points won",
  player_second_serve_points_won: "2nd serve points won",
  player_first_serve_percentage: "1st serve %",
  player_second_serve_percentage: "2nd serve %",
  player_service_games_won: "Service games won",
  player_return_games_won: "Return games won",
  player_return_points_won: "Return points won",
  player_return_points_won_percentage: "Return points won %",
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
  batter_hits: 'Hits', batter_total_bases: 'Total Bases', batter_singles: 'Singles', batter_doubles: 'Doubles', batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs', batter_runs_scored: 'Runs', batter_stolen_bases: 'Stolen Bases', batter_strikeouts: 'Batter Strikeouts',
  pitcher_strikeouts: 'Pitcher Strikeouts', pitcher_outs: 'Pitching Outs',
  pitcher_hits_allowed: 'Hits Allowed', pitcher_earned_runs: 'Earned Runs',
  player_shots_on_goal: 'Shots on Goal', player_goals: 'Goals',
  player_saves: 'Saves', player_shots: 'Shots', player_aces: 'Aces',
  player_double_faults: 'Double Faults', player_kills: 'Kills',
  player_deaths: 'Deaths', player_headshots: 'Headshots',
};
const WORDS: Record<string, string> = { yds: 'Yards', pts: 'Points', ast: 'Assists', reb: 'Rebounds', rbis: 'RBIs', rbi: 'RBIs', td: 'TD', tds: 'TDs', fg: 'Field Goals', fg3: 'Three-Pointers', ot: 'OT', h2h: 'H2H' };
const marketKeyTail = (value: unknown) => String(value || '').trim().toLowerCase().split(':').pop() || '';
const displayWords = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const CANONICAL_DISPLAY_LABELS = [...new Set(Object.values(MARKET_NAMES))]
  .sort((a, b) => displayWords(b).length - displayWords(a).length);
function embeddedCanonicalLabel(value: unknown): string | null {
  const haystack = ` ${displayWords(value)} `;
  if (haystack.trim() === '') return null;
  for (const label of CANONICAL_DISPLAY_LABELS) {
    const needle = displayWords(label);
    if (needle && haystack.includes(` ${needle} `)) return label;
  }
  return null;
}
/** Exact audited labels, also used to reconcile readable and raw-key categories. */
export const canonicalMarketLabel = (key: string): string | null => MARKET_NAMES[marketKeyTail(key)] || null;
export function humanize(value: string): string {
  return String(value || '').trim().replace(/^player[_\s]+/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').split(' ').filter(Boolean).map(word => WORDS[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
export function marketName(market: Pick<WorkspaceMarket, 'label' | 'marketKey'>): string {
  const marketKey = String(market.marketKey || '').trim().toLowerCase();
  // A known canonical market key is stronger evidence than a provider display string.
  // Namespaced keys (for example prizepicks:batter_doubles) retain the same
  // audited stat identity. If a provider decorates a label with the player,
  // outcome or line, recover only a known full stat phrase instead of echoing
  // the contaminated label into the stat tabs.
  const canonical = canonicalMarketLabel(marketKey);
  if (canonical) return canonical;
  const supplied = String(market.label || '').trim().replace(/\s*[·|]\s*Period\s+[^·|]+$/i, '').trim();
  const embedded = embeddedCanonicalLabel(supplied);
  if (embedded) return embedded;
  if (supplied && !supplied.includes('_')) return supplied;
  const raw = marketKeyTail(supplied || marketKey);
  return MARKET_NAMES[raw] || humanize(supplied || marketKey) || 'Player Prop';
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
  const raw = String(offer?.dfsOddsType || '').trim().toLowerCase();
  // "Alternate" is only meaningful when the feed proves this quote is offset
  // from the standard DFS line. A bare provider flag is not enough evidence.
  const hasAlternateGap = typeof offer?.lineGap === 'number' && Number.isFinite(offer.lineGap) && offer.lineGap !== 0;
  const value = raw === 'alternate' && !hasAlternateGap ? '' : raw;
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
