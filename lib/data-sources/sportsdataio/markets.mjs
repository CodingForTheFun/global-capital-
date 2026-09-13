// Canonical prop-market -> historical stat field mapping.
// A market absent from this table produces no history. Missing combo components
// remain unavailable rather than being treated as zero.

import { toNumberOrNull } from '../../props/model.mjs';

const BASKETBALL_MARKETS = Object.freeze({
  'points': ['Points'], 'rebounds': ['Rebounds'], 'assists': ['Assists'],
  'steals': ['Steals'], 'blocks': ['BlockedShots'], 'blocked shots': ['BlockedShots'],
  'turnovers': ['Turnovers'], '3-pt made': ['ThreePointersMade'],
  'three pointers': ['ThreePointersMade'], 'threes': ['ThreePointersMade'],
  '3 pointers made': ['ThreePointersMade'],
  'pts+reb+ast': ['Points', 'Rebounds', 'Assists'], 'pts+rebs+asts': ['Points', 'Rebounds', 'Assists'],
  'points+rebounds+assists': ['Points', 'Rebounds', 'Assists'],
  'points + rebounds + assists': ['Points', 'Rebounds', 'Assists'],
  'pra': ['Points', 'Rebounds', 'Assists'],
  'points rebounds assists': ['Points', 'Rebounds', 'Assists'],
  'points rebounds': ['Points', 'Rebounds'], 'points assists': ['Points', 'Assists'],
  'rebounds assists': ['Rebounds', 'Assists'],
  'blocks steals': ['BlockedShots', 'Steals'], 'steals blocks': ['Steals', 'BlockedShots'],
  'points+rebounds': ['Points', 'Rebounds'], 'points + rebounds': ['Points', 'Rebounds'],
  'pts+reb': ['Points', 'Rebounds'], 'pts+rebs': ['Points', 'Rebounds'],
  'points+assists': ['Points', 'Assists'], 'points + assists': ['Points', 'Assists'],
  'pts+ast': ['Points', 'Assists'], 'pts+asts': ['Points', 'Assists'],
  'rebounds+assists': ['Rebounds', 'Assists'], 'rebounds + assists': ['Rebounds', 'Assists'],
  'reb+ast': ['Rebounds', 'Assists'], 'rebs+asts': ['Rebounds', 'Assists'],
  'steals+blocks': ['Steals', 'BlockedShots'], 'steals + blocks': ['Steals', 'BlockedShots'],
  'blocks+steals': ['BlockedShots', 'Steals'], 'stl+blk': ['Steals', 'BlockedShots'],
  'fantasy score': ['FantasyPoints'],
});

const FOOTBALL_MARKETS = Object.freeze({
  'passing yards': ['PassingYards'], 'pass yards': ['PassingYards'],
  'passing tds': ['PassingTouchdowns'], 'passing touchdowns': ['PassingTouchdowns'], 'pass tds': ['PassingTouchdowns'],
  'pass attempts': ['PassingAttempts'], 'passing attempts': ['PassingAttempts'],
  'pass completions': ['PassingCompletions'], 'passing completions': ['PassingCompletions'],
  'completion percentage': ['CompletionPercentage'],
  'interceptions': ['PassingInterceptions'], 'passing interceptions': ['PassingInterceptions'], 'int': ['PassingInterceptions'],
  'rushing yards': ['RushingYards'], 'rush yards': ['RushingYards'],
  'rush attempts': ['RushingAttempts'], 'rushing attempts': ['RushingAttempts'],
  'rush yards per carry': ['RushingYardsPerCarry'],
  'rushing tds': ['RushingTouchdowns'], 'rushing touchdowns': ['RushingTouchdowns'], 'rush tds': ['RushingTouchdowns'],
  'receiving yards': ['ReceivingYards'], 'rec yards': ['ReceivingYards'], 'reception yards': ['ReceivingYards'],
  'receptions': ['Receptions'], 'targets': ['ReceivingTargets'], 'rec targets': ['ReceivingTargets'],
  'longest reception': ['ReceivingLongest'], 'longest rush': ['RushingLongest'], 'longest completion': ['PassingLongestCompletion'],
  'receiving tds': ['ReceivingTouchdowns'], 'receiving touchdowns': ['ReceivingTouchdowns'], 'reception tds': ['ReceivingTouchdowns'],
  'rush+rec yards': ['RushingYards', 'ReceivingYards'], 'rush+rec yds': ['RushingYards', 'ReceivingYards'],
  'rush + rec yards': ['RushingYards', 'ReceivingYards'], 'rushing + receiving yards': ['RushingYards', 'ReceivingYards'],
  'pass+rush yards': ['PassingYards', 'RushingYards'], 'pass+rush yds': ['PassingYards', 'RushingYards'],
  'passing + rushing yards': ['PassingYards', 'RushingYards'],
  'sacks': ['Sacks'], 'tackles assists': ['TacklesAssists'], 'tackles+ast': ['TacklesAssists'], 'tackles + assists': ['TacklesAssists'],
  'field goals made': ['FieldGoalsMade'], 'field goals': ['FieldGoalsMade'], 'fg made': ['FieldGoalsMade'],
  'punts': ['Punts'], 'punts inside 20': ['PuntsInside20'],
  'fantasy score': ['FantasyPoints'],
});

const TENNIS_MARKETS = Object.freeze({
  'aces': ['Aces'], 'ace': ['Aces'],
  'aces allowed': ['AcesAllowed'],
  'double faults': ['DoubleFaults'], 'double fault': ['DoubleFaults'], 'df': ['DoubleFaults'],
  'games': ['GamesWon', 'GamesLost'], 'total games': ['GamesWon', 'GamesLost'],
  'games won': ['GamesWon'], 'total games won': ['GamesWon'],
  'games lost': ['GamesLost'], 'total games lost': ['GamesLost'],
  'sets won': ['SetsWon'], 'sets lost': ['SetsLost'], 'total sets won': ['SetsWon'],
  'total sets': ['SetsWon', 'SetsLost'],
  'break points won': ['BreakPointsWon'], 'break points converted': ['BreakPointsWon'], 'bp won': ['BreakPointsWon'],
  'break points served': ['BreakPointsServed'], 'bp served': ['BreakPointsServed'],
  'break points saved': ['BreakPointsSaved'], 'bp saved': ['BreakPointsSaved'],
  'break points given up': ['BreakPointsGivenUp'], 'bp given up': ['BreakPointsGivenUp'],
  'points': ['PointsWon'], 'points won': ['PointsWon'], 'total points won': ['PointsWon'],
  'first serve points won': ['FirstServePointsWon'], '1st serve points won': ['FirstServePointsWon'],
  'second serve points won': ['SecondServePointsWon'], '2nd serve points won': ['SecondServePointsWon'],
  'first serve percentage': ['FirstServePct'], '1st serve percentage': ['FirstServePct'], '1st serve %': ['FirstServePct'],
  'second serve percentage': ['SecondServePct'], '2nd serve percentage': ['SecondServePct'], '2nd serve %': ['SecondServePct'],
  'service games won': ['ServiceGamesWon'], 'return games won': ['ReturnGamesWon'],
  'return points won': ['ReturnPointsWon'], 'ret points won': ['ReturnPointsWon'],
  'return points won percentage': ['ReturnPointsWonPct'], 'return points won %': ['ReturnPointsWonPct'], 'ret points w%': ['ReturnPointsWonPct'],
});

export const MARKETS = Object.freeze({
  NBA: BASKETBALL_MARKETS, WNBA: BASKETBALL_MARKETS, NCAAB: BASKETBALL_MARKETS, CBB: BASKETBALL_MARKETS,
  NFL: FOOTBALL_MARKETS, NCAAF: FOOTBALL_MARKETS, CFB: FOOTBALL_MARKETS,
  TENNIS: TENNIS_MARKETS,
  MLB: {
    'hits': ['Hits'], 'runs': ['Runs'], 'rbis': ['RunsBattedIn'], 'runs batted in': ['RunsBattedIn'],
    'hits+runs+rbis': ['Hits', 'Runs', 'RunsBattedIn'], 'hits + runs + rbis': ['Hits', 'Runs', 'RunsBattedIn'],
    'hits + runs + rbi': ['Hits', 'Runs', 'RunsBattedIn'], 'hits runs rbis': ['Hits', 'Runs', 'RunsBattedIn'],
    'home runs': ['HomeRuns'], 'hits allowed': ['PitchingHits'], 'pitching hits allowed': ['PitchingHits'],
    'total bases': ['TotalBases'], 'strikeouts': ['Strikeouts'], 'pitching strikeouts': ['Strikeouts'],
    'batter strikeouts': ['Strikeouts'], 'singles': ['Singles'], 'doubles': ['Doubles'], 'triples': ['Triples'],
    'stolen bases': ['StolenBases'], 'walks': ['Walks'], 'batter walks': ['Walks'],
    'walks allowed': ['PitchingWalks'], 'pitcher walks': ['PitchingWalks'], 'earned runs': ['EarnedRuns'], 'earned runs allowed': ['EarnedRuns'],
    'pitching outs': ['PitchingOuts'], 'outs recorded': ['PitchingOuts'],
    'innings pitched': ['InningsPitched'], 'ip': ['InningsPitched'],
    'pitches': ['PitchesThrown'], 'total pitches': ['PitchesThrown'], 'pitches thrown': ['PitchesThrown'],
    'batters faced': ['BattersFaced'], 'bf': ['BattersFaced'],
    'fantasy score': ['FantasyPoints'],
  },
  NHL: {
    'shots on goal': ['ShotsOnGoal'], 'shots': ['ShotsOnGoal'], 'goals': ['Goals'], 'assists': ['Assists'],
    'points': ['Goals', 'Assists'], 'hits': ['Hits'], 'saves': ['Saves'], 'goals against': ['GoalsAgainst'],
    'blocked shots': ['BlockedShots'], 'power play points': ['PowerPlayPoints'], 'fantasy score': ['FantasyPoints'],
  },
});

export const PROVIDER_MARKET_KEYS = Object.freeze({
  player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists', player_steals: 'steals',
  player_blocks: 'blocks', player_turnovers: 'turnovers', player_threes: 'threes',
  player_points_rebounds_assists: 'points rebounds assists', player_points_rebounds: 'points rebounds',
  player_points_assists: 'points assists', player_rebounds_assists: 'rebounds assists', player_blocks_steals: 'blocks steals',
  player_pts_rebs_asts: 'pts+rebs+asts', player_pts_rebs: 'pts+rebs', player_pts_asts: 'pts+asts', player_rebs_asts: 'rebs+asts',
  player_fantasy_points: 'fantasy score',
  player_pass_yds: 'passing yards', player_pass_tds: 'passing tds', player_pass_attempts: 'pass attempts',
  player_pass_completions: 'pass completions', player_pass_interceptions: 'interceptions', player_int: 'int',
  player_completion_percentage: 'completion percentage', player_longest_completion: 'longest completion',
  player_rush_yds: 'rushing yards', player_rush_attempts: 'rush attempts', player_rush_tds: 'rushing tds',
  player_rush_yards_per_carry: 'rush yards per carry', player_longest_rush: 'longest rush',
  player_reception_yds: 'receiving yards', player_receptions: 'receptions', player_reception_tds: 'receiving tds',
  player_targets: 'targets', player_rec_targets: 'rec targets', player_longest_reception: 'longest reception',
  player_rush_reception_yds: 'rush+rec yards', player_rush_rec_yds: 'rush+rec yds', player_pass_rush_yds: 'pass+rush yds', player_sacks: 'sacks',
  player_tackles_assists: 'tackles assists', player_tackles_ast: 'tackles+ast', player_field_goals: 'field goals made', player_fg_made: 'fg made',
  player_punts: 'punts', player_punts_inside_20: 'punts inside 20',
  batter_hits: 'hits', batter_runs: 'runs', batter_rbis: 'rbis', batter_total_bases: 'total bases',
  batter_doubles: 'doubles', batter_singles: 'singles', batter_triples: 'triples', batter_home_runs: 'home runs', batter_stolen_bases: 'stolen bases',
  batter_walks: 'walks', batter_strikeouts: 'batter strikeouts', batter_hits_runs_rbis: 'hits runs rbis',
  pitcher_strikeouts: 'pitching strikeouts', pitcher_hits_allowed: 'hits allowed', pitcher_earned_runs: 'earned runs allowed',
  pitcher_walks: 'walks allowed', pitcher_outs: 'pitching outs', pitcher_outs_recorded: 'pitching outs',
  pitcher_innings_pitched: 'innings pitched', pitcher_pitches: 'pitches', pitcher_pitches_thrown: 'pitches thrown', pitcher_batters_faced: 'batters faced',
  player_shots_on_goal: 'shots on goal', player_goals: 'goals', player_total_saves: 'saves', player_saves: 'saves',
  player_goals_against: 'goals against', player_power_play_points: 'power play points',
  player_aces: 'aces', player_ace: 'aces', player_aces_allowed: 'aces allowed', player_double_faults: 'double faults',
  player_games: 'games', player_games_won: 'games won', player_games_lost: 'games lost',
  player_sets_won: 'sets won', player_sets_lost: 'sets lost', player_total_sets: 'total sets',
  player_break_points_won: 'break points won', player_break_points_served: 'break points served', player_break_points_saved: 'break points saved', player_break_points_given_up: 'break points given up',
  player_points_won: 'points won', player_total_points_won: 'total points won',
  player_first_serve_points_won: 'first serve points won', player_second_serve_points_won: 'second serve points won',
  player_first_serve_percentage: 'first serve percentage', player_second_serve_percentage: 'second serve percentage',
  player_service_games_won: 'service games won', player_return_games_won: 'return games won',
  player_return_points_won: 'return points won', player_return_points_won_percentage: 'return points won percentage',
});

export function marketFromProviderKey(providerKey) {
  const key = String(providerKey || '').trim().toLowerCase();
  return PROVIDER_MARKET_KEYS[key] || null;
}

export function marketKey(market) {
  return String(market || '').toLowerCase().replace(/\s*\+\s*/g, '+').replace(/[^a-z0-9+% ]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^player\s+/, '');
}

export function fieldsFor(sport, market, providerKey = null) {
  const table = MARKETS[String(sport || '').toUpperCase()];
  if (!table) return null;
  const fromProvider = marketFromProviderKey(providerKey);
  if (fromProvider) {
    const mapped = table[fromProvider] || table[fromProvider.replace(/\+/g, ' + ')];
    if (mapped) return mapped;
  }
  const key = marketKey(market);
  return table[key] || table[key.replace(/\+/g, ' + ')] || null;
}

export function statFromRow(sport, market, row, providerKey = null) {
  const fields = fieldsFor(sport, market, providerKey);
  if (!fields || !row) return null;
  let total = 0;
  for (const field of fields) {
    const value = toNumberOrNull(row[field]);
    if (value === null) return null;
    total += value;
  }
  return Number(total.toFixed(2));
}
