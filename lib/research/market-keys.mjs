// The live board labels markets the way The Odds API does ("player_points",
// "Points"). The stat mapping in lib/data-sources/sportsdataio/markets.mjs is
// keyed by canonical product names. This translates between them.
//
// An unmapped market returns null, and the caller reports "market not
// supported" rather than researching the wrong statistic.

const ODDS_API_MARKETS = Object.freeze({
  // NBA / WNBA
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_steals: 'steals',
  player_blocks: 'blocks',
  player_turnovers: 'turnovers',
  player_threes: 'threes',
  player_points_rebounds_assists: 'pra',
  player_points_rebounds: 'points + rebounds',
  player_points_assists: 'points + assists',
  player_rebounds_assists: 'rebounds + assists',
  player_blocks_steals: 'steals + blocks',
  player_fantasy_points: 'fantasy score',
  // NFL
  player_pass_yds: 'passing yards',
  player_pass_tds: 'passing tds',
  player_pass_attempts: 'pass attempts',
  player_pass_completions: 'pass completions',
  player_pass_interceptions: 'interceptions',
  player_rush_yds: 'rushing yards',
  player_rush_attempts: 'rush attempts',
  player_rush_tds: 'rushing tds',
  player_reception_yds: 'receiving yards',
  player_receptions: 'receptions',
  player_reception_tds: 'receiving tds',
  player_targets: 'targets',
  player_rush_reception_yds: 'rush+rec yards',
});

// Display labels the board may send instead of a provider key.
const DISPLAY_ALIASES = Object.freeze({
  pts: 'points',
  reb: 'rebounds',
  rebs: 'rebounds',
  ast: 'assists',
  asts: 'assists',
  stl: 'steals',
  blk: 'blocks',
  '3pm': 'threes',
  '3-pt made': 'threes',
  'three pointers made': 'threes',
  'pts+reb+ast': 'pra',
  'points+rebounds+assists': 'pra',
  'pts+reb': 'points + rebounds',
  'pts+ast': 'points + assists',
  'reb+ast': 'rebounds + assists',
  stocks: 'steals + blocks',
  'stl+blk': 'steals + blocks',
});

/**
 * Resolve whatever the board calls a market into the canonical key used by the
 * stat mapping. Returns null when nothing maps — never a guess.
 */
export function canonicalMarket({ marketId, statId, market } = {}) {
  for (const candidate of [marketId, statId]) {
    const key = String(candidate ?? '').trim().toLowerCase();
    if (key && ODDS_API_MARKETS[key]) return ODDS_API_MARKETS[key];
  }

  const label = String(market ?? '').trim().toLowerCase();
  if (!label) return null;
  if (ODDS_API_MARKETS[label]) return ODDS_API_MARKETS[label];
  if (DISPLAY_ALIASES[label]) return DISPLAY_ALIASES[label];

  // A display label that is already canonical ("points", "rushing yards").
  const collapsed = label.replace(/\s+/g, ' ');
  if (DISPLAY_ALIASES[collapsed.replace(/\s/g, '')]) return DISPLAY_ALIASES[collapsed.replace(/\s/g, '')];
  return collapsed;
}

export { ODDS_API_MARKETS, DISPLAY_ALIASES };
