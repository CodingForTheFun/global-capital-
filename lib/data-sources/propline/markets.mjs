// PropLine identifiers, mapped onto the sports and books this product already
// speaks. Anything not listed here is not a failure - it is simply a market
// Oblige Props does not show, and the normalizer drops it rather than inventing
// a mapping.
export const SPORT_KEYS = Object.freeze({
  NFL: 'football_nfl',
  NCAAF: 'football_ncaaf',
  NBA: 'basketball_nba',
  NCAAB: 'basketball_ncaab',
  WNBA: 'basketball_wnba',
  MLB: 'baseball_mlb',
  NHL: 'hockey_nhl',
  TENNIS: 'tennis',
  // PropLine documents soccer_mls as the canonical MLS sport key. Older
  // aliases may be accepted upstream, but using the canonical key keeps event
  // discovery and market discovery on the same namespace.
  MLS: 'soccer_mls',
  EPL: 'soccer_epl',
  UCL: 'soccer_uefa_champs_league',
});

// The static map above is a floor, not a ceiling. PropLine reports 56 sports
// and this product maps eleven of them by hand, which means anything they add -
// a soccer league, a new competition - stays invisible until somebody edits
// this file. Worse, a hand-written key that is subtly wrong does not error: the
// event list simply comes back empty and the sport looks out of season.
//
// So keys are recognised by shape rather than transcribed. PropLine namespaces
// them as `<discipline>_<competition>`, which is enough to place a key on one of
// this product's sports without knowing the exact spelling in advance.
// Verified against a live /v1/sports response: 56 keys, all active. Several of
// these are sports this product already serves from a single DFS book, so
// mapping them is what turns a PrizePicks-only line into a comparable one.
const DISCIPLINE_SPORT = Object.freeze({
  football_nfl: 'NFL',
  football_ncaaf: 'NCAAF',
  basketball_nba: 'NBA',
  basketball_ncaab: 'NCAAB',
  basketball_wnba: 'WNBA',
  baseball_mlb: 'MLB',
  hockey_nhl: 'NHL',
  tennis: 'TENNIS',
  golf: 'PGA',
  mma_ufc: 'MMA',
  boxing: 'BOXING',
  cricket: 'CRICKET',
  darts: 'DARTS',
  esports: 'ESPORTS',
  football_cfl: 'CFL',
  aussie_rules_afl: 'AFL',
  motorsport_racing: 'F1',
  table_tennis: 'TABLETENNIS',
  volleyball: 'VOLLEYBALL',
  badminton: 'BADMINTON',
  snooker: 'SNOOKER',
  cycling: 'CYCLING',
  rugby_league: 'RUGBYLEAGUE',
  rugby_union: 'RUGBYUNION',
  baseball_ncaa: 'NCAABASEBALL',
  basketball_nba_summer_league: 'NBASUMMER',
});

// Soccer competitions this product models separately. Everything else under
// `soccer_` still counts - it lands on the generic SOCCER board rather than
// being dropped, which is what the league-agnostic soccer research already
// expects.
// soccer_uefa_champions_league is the live key; the champs spelling is kept so a
// rename in either direction cannot silently empty the board.
const SOCCER_COMPETITIONS = Object.freeze({
  soccer_mls: 'MLS',
  soccer_usa_mls: 'MLS',
  soccer_epl: 'EPL',
  soccer_england_premier_league: 'EPL',
  soccer_uefa_champs_league: 'UCL',
  soccer_uefa_champions_league: 'UCL',
  soccer_fifa_world_cup: 'FIFA',
});

/**
 * Place a PropLine sport key on one of this product's sports.
 *
 * Returns null when the key belongs to something this product does not model -
 * darts, snooker, cycling - rather than inventing a home for it.
 */
export function matchProplineSport(key) {
  const raw = String(key ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (DISCIPLINE_SPORT[raw]) return DISCIPLINE_SPORT[raw];
  if (SOCCER_COMPETITIONS[raw]) return SOCCER_COMPETITIONS[raw];
  // Any other soccer competition is still soccer.
  if (raw.startsWith('soccer_') || raw === 'soccer') return 'SOCCER';
  if (raw.startsWith('tennis')) return 'TENNIS';
  return null;
}

/**
 * Build the sport map from a live /v1/sports response, falling back to the
 * static map for anything the response does not cover.
 *
 * A sport PropLine marks inactive is left out: asking for events on a league
 * that is not running spends requests to be told nothing.
 */
export function sportMapFromCatalog(catalog = []) {
  const rows = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.sports) ? catalog.sports : [];
  const discovered = new Map();
  for (const row of rows) {
    const key = String(row?.key ?? row?.sport_key ?? row ?? '').trim().toLowerCase();
    if (!key) continue;
    if (row && typeof row === 'object' && row.active === false) continue;
    const sport = matchProplineSport(key);
    if (!sport) continue;
    // First key wins, so the static canonical choice is not displaced by an
    // alias that happens to sort earlier.
    if (!discovered.has(sport)) discovered.set(sport, key);
  }
  return Object.freeze({ ...SPORT_KEYS, ...Object.fromEntries(discovered) });
}

export const SPORT_BY_KEY = Object.freeze(Object.fromEntries(Object.entries(SPORT_KEYS).map(([sport, key]) => [key, sport])));
export function proplineSportKey(sport) { return SPORT_KEYS[String(sport ?? '').toUpperCase()] || null; }
export function sportFromProplineKey(key) { return SPORT_BY_KEY[String(key ?? '').toLowerCase()] || null; }

// PropLine explicitly recommends always sending markets= on odds requests.
// These defaults contain only Over/Under-style player markets that the Oblige
// Props board can normalize without fabricating a side or a player. Operators
// can override them globally with PROPLINE_MARKETS or per sport with
// PROPLINE_MARKETS_<SPORT>.
const BASKETBALL_MARKETS = Object.freeze([
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_steals',
  'player_blocks',
  'player_turnovers',
  'player_points_assists',
  'player_points_rebounds',
  'player_points_rebounds_assists',
  'player_rebounds_assists',
]);

const FOOTBALL_MARKETS = Object.freeze([
  'player_pass_yds',
  'player_pass_tds',
  'player_pass_interceptions',
  'player_pass_completions',
  'player_pass_attempts',
  'player_longest_completion',
  'player_rush_yds',
  'player_rush_tds',
  'player_rush_attempts',
  'player_rush_longest',
  'player_reception_yds',
  'player_receptions',
  'player_reception_tds',
  'player_reception_longest',
  'player_pass_rush_yds',
  'player_rush_reception_yds',
  'player_sacks',
  'player_field_goals_made',
  'player_extra_points_made',
  'player_kicking_points',
  'player_fumbles_lost',
  'player_solo_tackles',
  'player_tackles_assists',
]);

export const DEFAULT_PLAYER_PROP_MARKETS = Object.freeze({
  MLB: Object.freeze([
    'pitcher_strikeouts',
    'pitcher_earned_runs',
    'pitcher_hits_allowed',
    'pitcher_outs',
    'batter_hits',
    'batter_total_bases',
    'batter_walks',
    'batter_home_runs',
    'batter_stolen_bases',
    'batter_singles',
    'batter_rbis',
    'batter_doubles',
    'batter_runs',
    'batter_hits_runs_rbis',
    'batter_strikeouts',
  ]),
  NBA: BASKETBALL_MARKETS,
  WNBA: BASKETBALL_MARKETS,
  NCAAB: BASKETBALL_MARKETS,
  NHL: Object.freeze([
    'player_shots_on_goal',
    'goalie_saves',
    'player_blocked_shots',
    'player_power_play_points',
  ]),
  NFL: FOOTBALL_MARKETS,
  NCAAF: FOOTBALL_MARKETS,
  TENNIS: Object.freeze([
    'player_aces',
    'player_double_faults',
    'player_games_won',
    'player_break_points_won',
  ]),
  // The published soccer set is dominated by yes/no scorer outcomes and other
  // shapes that this board intentionally refuses. Leave soccer opt-in until an
  // exact comparable O/U mapping is configured instead of guessing one.
  MLS: Object.freeze([]),
  EPL: Object.freeze([]),
  UCL: Object.freeze([]),
});

export function defaultPlayerPropMarkets(sport) {
  return [...(DEFAULT_PLAYER_PROP_MARKETS[String(sport ?? '').toUpperCase()] || [])];
}

// PropLine's book keys are already close to the ones in the bookmakers table.
// Only the genuine spelling differences are listed; everything else passes
// through unchanged so a book PropLine adds later still works.
const BOOK_ALIASES = Object.freeze({
  onexbet: '1xbet',
  hardrock: 'hardrockbet',
  betonlineag: 'betonlineag',
  lowvig: 'lowvigag',
  polymarket_us: 'polymarket',
  tab_au: 'tab',
});
export function bookKey(key) {
  const raw = String(key ?? '').trim().toLowerCase();
  return BOOK_ALIASES[raw] || raw;
}

// PropLine publishes PrizePicks' Goblin/Demon flavour as a first-class field
// rather than something to infer from pricing. This product already represents
// those as alternates that stay out of Best Line and consensus, so the mapping
// is direct and no side is ever guessed.
export function specialFromOddsType(oddsType) {
  const value = String(oddsType ?? '').trim().toLowerCase();
  return value === 'goblin' || value === 'demon' ? value : null;
}
export function isAlternateOutcome(outcome) {
  if (specialFromOddsType(outcome?.dfs_odds_type)) return true;
  const multiplier = Number(outcome?.payout_multiplier);
  return Number.isFinite(multiplier) && multiplier !== 1;
}

// An Over/Under prop is the only thing the board renders. PropLine also returns
// yes/no and "3+ strikeouts" style outcomes, which carry no line and cannot be
// compared across books the way this board compares them.
export function sideFromOutcome(outcome) {
  const name = String(outcome?.name ?? outcome?.outcome_name ?? '').trim().toLowerCase();
  if (name === 'over' || name.startsWith('over ')) return 'OVER';
  if (name === 'under' || name.startsWith('under ')) return 'UNDER';
  return null;
}
