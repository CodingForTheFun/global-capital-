// Canonical prop-market -> SportsDataIO stat field mapping.
//
// A market absent from this table produces NO projection/history. A combo market
// missing any component produces none either. Scout Pro would rather show a prop
// with no metric than fabricate analysis from a partial mapping.

import { toNumberOrNull } from '../../props/model.mjs';

export const MARKETS = Object.freeze({
  NBA: {
    'points': ['Points'], 'rebounds': ['Rebounds'], 'assists': ['Assists'],
    'steals': ['Steals'], 'blocks': ['BlockedShots'], 'blocked shots': ['BlockedShots'],
    'turnovers': ['Turnovers'], '3-pt made': ['ThreePointersMade'],
    'three pointers': ['ThreePointersMade'], 'threes': ['ThreePointersMade'],
    '3 pointers made': ['ThreePointersMade'],
    'pts+reb+ast': ['Points', 'Rebounds', 'Assists'],
    'points + rebounds + assists': ['Points', 'Rebounds', 'Assists'],
    'pra': ['Points', 'Rebounds', 'Assists'],
    'points + rebounds': ['Points', 'Rebounds'], 'pts+reb': ['Points', 'Rebounds'],
    'points + assists': ['Points', 'Assists'], 'pts+ast': ['Points', 'Assists'],
    'rebounds + assists': ['Rebounds', 'Assists'], 'reb+ast': ['Rebounds', 'Assists'],
    'steals + blocks': ['Steals', 'BlockedShots'], 'stl+blk': ['Steals', 'BlockedShots'],
    'fantasy score': ['FantasyPoints'],
  },
  WNBA: null,
  NFL: {
    'passing yards': ['PassingYards'], 'pass yards': ['PassingYards'],
    'passing tds': ['PassingTouchdowns'], 'passing touchdowns': ['PassingTouchdowns'],
    'pass attempts': ['PassingAttempts'], 'passing attempts': ['PassingAttempts'],
    'pass completions': ['PassingCompletions'], 'passing completions': ['PassingCompletions'],
    'interceptions': ['PassingInterceptions'], 'passing interceptions': ['PassingInterceptions'],
    'rushing yards': ['RushingYards'], 'rush yards': ['RushingYards'],
    'rush attempts': ['RushingAttempts'], 'rushing attempts': ['RushingAttempts'],
    'rushing tds': ['RushingTouchdowns'], 'rushing touchdowns': ['RushingTouchdowns'],
    'receiving yards': ['ReceivingYards'], 'rec yards': ['ReceivingYards'],
    'receptions': ['Receptions'], 'targets': ['ReceivingTargets'],
    'receiving tds': ['ReceivingTouchdowns'], 'receiving touchdowns': ['ReceivingTouchdowns'],
    'rush+rec yards': ['RushingYards', 'ReceivingYards'],
    'rush + rec yards': ['RushingYards', 'ReceivingYards'],
    'rushing + receiving yards': ['RushingYards', 'ReceivingYards'],
    'pass+rush yards': ['PassingYards', 'RushingYards'],
    'passing + rushing yards': ['PassingYards', 'RushingYards'],
    'fantasy score': ['FantasyPoints'],
  },
  MLB: {
    'hits': ['Hits'], 'runs': ['Runs'], 'rbis': ['RunsBattedIn'],
    'runs batted in': ['RunsBattedIn'],
    'hits+runs+rbis': ['Hits', 'Runs', 'RunsBattedIn'],
    'hits + runs + rbis': ['Hits', 'Runs', 'RunsBattedIn'],
    'hits + runs + rbi': ['Hits', 'Runs', 'RunsBattedIn'],
    'total bases': ['TotalBases'], 'strikeouts': ['Strikeouts'],
    'pitching strikeouts': ['Strikeouts'], 'singles': ['Singles'], 'doubles': ['Doubles'],
    'stolen bases': ['StolenBases'], 'walks': ['Walks'],
    'earned runs': ['EarnedRuns'], 'fantasy score': ['FantasyPoints'],
  },
  NHL: {
    'shots on goal': ['ShotsOnGoal'], 'shots': ['ShotsOnGoal'], 'goals': ['Goals'],
    'assists': ['Assists'], 'points': ['Goals', 'Assists'], 'hits': ['Hits'],
    'saves': ['Saves'], 'blocked shots': ['BlockedShots'],
    'power play points': ['PowerPlayPoints'], 'fantasy score': ['FantasyPoints'],
  },
});

/** Normalize sportsbook/provider market labels to the canonical stat-market key. */
export function marketKey(market) {
  return String(market || '')
    .toLowerCase()
    .replace(/\s*\+\s*/g, '+')
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // SportsDataIO commonly prefixes its BetType with "Player" (for example
    // "Player Receptions" / "Player Passing Yards"). That prefix describes
    // the market class, not a different statistic.
    .replace(/^player\s+/, '');
}

/** Field names for a market, or null when Scout Pro has no mapping for it. */
export function fieldsFor(sport, market) {
  const table = MARKETS[String(sport || '').toUpperCase()];
  if (!table) return null;
  const key = marketKey(market);
  return table[key] || table[key.replace(/\+/g, ' + ')] || null;
}

/** Sum mapped fields; missing/unmapped components stay null, never zero. */
export function statFromRow(sport, market, row) {
  const fields = fieldsFor(sport, market);
  if (!fields || !row) return null;
  let total = 0;
  for (const field of fields) {
    const value = toNumberOrNull(row[field]);
    if (value === null) return null;
    total += value;
  }
  return Number(total.toFixed(2));
}
