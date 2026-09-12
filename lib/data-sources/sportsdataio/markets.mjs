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
  'pts+reb+ast': ['Points', 'Rebounds', 'Assists'],
  'points + rebounds + assists': ['Points', 'Rebounds', 'Assists'],
  'pra': ['Points', 'Rebounds', 'Assists'],
  'points rebounds assists': ['Points', 'Rebounds', 'Assists'],
  'points rebounds': ['Points', 'Rebounds'], 'points assists': ['Points', 'Assists'],
  'rebounds assists': ['Rebounds', 'Assists'],
  'blocks steals': ['BlockedShots', 'Steals'], 'steals blocks': ['Steals', 'BlockedShots'],
  'points + rebounds': ['Points', 'Rebounds'], 'pts+reb': ['Points', 'Rebounds'],
  'points + assists': ['Points', 'Assists'], 'pts+ast': ['Points', 'Assists'],
  'rebounds + assists': ['Rebounds', 'Assists'], 'reb+ast': ['Rebounds', 'Assists'],
  'steals + blocks': ['Steals', 'BlockedShots'], 'stl+blk': ['Steals', 'BlockedShots'],
  'fantasy score': ['FantasyPoints'],
});

const FOOTBALL_MARKETS = Object.freeze({
  'passing yards': ['PassingYards'], 'pass yards': ['PassingYards'],
  'passing tds': ['PassingTouchdowns'], 'passing touchdowns': ['PassingTouchdowns'], 'pass tds': ['PassingTouchdowns'],
  'pass attempts': ['PassingAttempts'], 'passing attempts': ['PassingAttempts'],
  'pass completions': ['PassingCompletions'], 'passing completions': ['PassingCompletions'],
  'interceptions': ['PassingInterceptions'], 'passing interceptions': ['PassingInterceptions'],
  'rushing yards': ['RushingYards'], 'rush yards': ['RushingYards'],
  'rush attempts': ['RushingAttempts'], 'rushing attempts': ['RushingAttempts'],
  'rushing tds': ['RushingTouchdowns'], 'rushing touchdowns': ['RushingTouchdowns'], 'rush tds': ['RushingTouchdowns'],
  'receiving yards': ['ReceivingYards'], 'rec yards': ['ReceivingYards'], 'reception yards': ['ReceivingYards'],
  'receptions': ['Receptions'], 'targets': ['ReceivingTargets'],
  'receiving tds': ['ReceivingTouchdowns'], 'receiving touchdowns': ['ReceivingTouchdowns'], 'reception tds': ['ReceivingTouchdowns'],
  'rush+rec yards': ['RushingYards', 'ReceivingYards'], 'rush + rec yards': ['RushingYards', 'ReceivingYards'],
  'rushing + receiving yards': ['RushingYards', 'ReceivingYards'],
  'pass+rush yards': ['PassingYards', 'RushingYards'], 'passing + rushing yards': ['PassingYards', 'RushingYards'],
  'sacks': ['Sacks'], 'tackles assists': ['TacklesAssists'], 'tackles + assists': ['TacklesAssists'],
  'field goals made': ['FieldGoalsMade'], 'field goals': ['FieldGoalsMade'],
  'fantasy score': ['FantasyPoints'],
});

export const MARKETS = Object.freeze({
  NBA: BASKETBALL_MARKETS, WNBA: BASKETBALL_MARKETS, NCAAB: BASKETBALL_MARKETS, CBB: BASKETBALL_MARKETS,
  NFL: FOOTBALL_MARKETS, NCAAF: FOOTBALL_MARKETS, CFB: FOOTBALL_MARKETS,
  MLB: {
    'hits': ['Hits'], 'runs': ['Runs'], 'rbis': ['RunsBattedIn'], 'runs batted in': ['RunsBattedIn'],
    'hits+runs+rbis': ['Hits', 'Runs', 'RunsBattedIn'], 'hits + runs + rbis': ['Hits', 'Runs', 'RunsBattedIn'],
    'hits + runs + rbi': ['Hits', 'Runs', 'RunsBattedIn'], 'hits runs rbis': ['Hits', 'Runs', 'RunsBattedIn'],
    'home runs': ['HomeRuns'], 'hits allowed': ['PitchingHits'], 'pitching hits allowed': ['PitchingHits'],
    'total bases': ['TotalBases'], 'strikeouts': ['Strikeouts'], 'pitching strikeouts': ['Strikeouts'],
    'singles': ['Singles'], 'doubles': ['Doubles'], 'stolen bases': ['StolenBases'], 'walks': ['Walks'],
    'walks allowed': ['PitchingWalks'], 'earned runs': ['EarnedRuns'], 'earned runs allowed': ['EarnedRuns'],
    'pitching outs': ['PitchingOuts'], 'outs recorded': ['PitchingOuts'], 'fantasy score': ['FantasyPoints'],
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
  player_fantasy_points: 'fantasy score',
  player_pass_yds: 'passing yards', player_pass_tds: 'passing tds', player_pass_attempts: 'pass attempts',
  player_pass_completions: 'pass completions', player_pass_interceptions: 'interceptions',
  player_rush_yds: 'rushing yards', player_rush_attempts: 'rush attempts', player_rush_tds: 'rushing tds',
  player_reception_yds: 'receiving yards', player_receptions: 'receptions', player_reception_tds: 'receiving tds',
  player_targets: 'targets', player_rush_reception_yds: 'rush+rec yards', player_sacks: 'sacks',
  player_tackles_assists: 'tackles assists', player_field_goals: 'field goals made',
  batter_hits: 'hits', batter_runs: 'runs', batter_rbis: 'rbis', batter_total_bases: 'total bases',
  batter_doubles: 'doubles', batter_singles: 'singles', batter_home_runs: 'home runs', batter_stolen_bases: 'stolen bases',
  batter_walks: 'walks', batter_hits_runs_rbis: 'hits runs rbis',
  pitcher_strikeouts: 'pitching strikeouts', pitcher_hits_allowed: 'hits allowed', pitcher_earned_runs: 'earned runs allowed',
  pitcher_walks: 'walks allowed', pitcher_outs: 'pitching outs', pitcher_outs_recorded: 'pitching outs',
  player_shots_on_goal: 'shots on goal', player_goals: 'goals', player_total_saves: 'saves', player_saves: 'saves',
  player_goals_against: 'goals against', player_power_play_points: 'power play points',
});

export function marketFromProviderKey(providerKey) {
  const key = String(providerKey || '').trim().toLowerCase();
  return PROVIDER_MARKET_KEYS[key] || null;
}

export function marketKey(market) {
  return String(market || '').toLowerCase().replace(/\s*\+\s*/g, '+').replace(/[^a-z0-9+ ]/g, ' ')
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
