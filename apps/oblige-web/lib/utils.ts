import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** American odds always carry their sign, so -110 and +104 line up in a column. */
export function odds(value: number | string | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n > 0 ? `+${n}` : String(n);
}

export function pct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  // The board reports rates both as 0–1 and as 0–100 depending on the window,
  // so normalise before rendering rather than trusting one shape.
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

export function pctValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return Math.round(n <= 1 ? n * 100 : n);
}

export function signed(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

export function initials(name: string) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** A hit rate is good news above 60, a warning in the middle, bad below 45. */
export function rateTone(value: number | null): 'pos' | 'warn' | 'neg' | 'none' {
  if (value === null) return 'none';
  if (value >= 60) return 'pos';
  if (value >= 45) return 'warn';
  return 'neg';
}

export function shortTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function shortDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}


const MARKET_DISPLAY_LABELS: Record<string, string> = {
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3-Pointers Made',
  player_blocks: 'Blocks',
  player_steals: 'Steals',
  player_turnovers: 'Turnovers',
  player_points_rebounds_assists: 'Points + Rebounds + Assists',
  player_points_rebounds: 'Points + Rebounds',
  player_points_assists: 'Points + Assists',
  player_rebounds_assists: 'Rebounds + Assists',
  player_blocks_steals: 'Blocks + Steals',
  player_pass_yds: 'Passing Yards',
  player_pass_tds: 'Passing Touchdowns',
  player_pass_attempts: 'Passing Attempts',
  player_pass_completions: 'Passing Completions',
  player_pass_interceptions: 'Passing Interceptions',
  player_rush_yds: 'Rushing Yards',
  player_rush_attempts: 'Rushing Attempts',
  player_rush_tds: 'Rushing Touchdowns',
  player_reception_yds: 'Receiving Yards',
  player_receptions: 'Receptions',
  player_reception_tds: 'Receiving Touchdowns',
  player_rush_reception_yds: 'Rushing + Receiving Yards',
  player_sacks: 'Sacks',
  player_sacks_taken: 'Sacks Taken',
  player_solo_tackles: 'Solo Tackles',
  player_assisted_tackles: 'Assisted Tackles',
  player_tackles: 'Tackles',
  player_total_tackles: 'Total Tackles',
  player_tackles_assists: 'Tackles + Assists',
  player_tackles_for_loss: 'Tackles for Loss',
  player_defensive_interceptions: 'Defensive Interceptions',
  player_pass_deflections: 'Passes Defended',
  player_qb_hits: 'QB Hits',
  player_forced_fumbles: 'Forced Fumbles',
  player_fumble_recoveries: 'Fumble Recoveries',
  batter_hits: 'Hits',
  batter_total_bases: 'Total Bases',
  batter_home_runs: 'Home Runs',
  batter_runs_scored: 'Runs',
  batter_runs: 'Runs',
  batter_rbis: 'RBIs',
  batter_hits_runs_rbis: 'Hits + Runs + RBIs',
  batter_strikeouts: 'Batter Strikeouts',
  batter_walks: 'Batter Walks',
  pitcher_strikeouts: 'Pitcher Strikeouts',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_earned_runs: 'Earned Runs Allowed',
  pitcher_outs: 'Pitching Outs',
  pitcher_outs_recorded: 'Pitching Outs',
  pitcher_walks: 'Walks Allowed',
  pitcher_innings_pitched: 'Innings Pitched',
  pitcher_pitches: 'Pitches',
  pitcher_pitches_thrown: 'Pitches',
  pitcher_batters_faced: 'Batters Faced',
  player_shots_on_goal: 'Shots on Goal',
  player_goals: 'Goals',
  player_total_saves: 'Saves',
  player_saves: 'Saves',
  player_blocked_shots: 'Blocked Shots',
  player_shots: 'Shots',
  player_shots_on_target: 'Shots on Target',
  player_aces: 'Aces',
  player_double_faults: 'Double Faults',
  player_games: 'Games',
  player_games_won: 'Games Won',
  player_sets_won: 'Sets Won',
  player_total_sets: 'Total Sets',
  fantasy_score: 'Fantasy Score',
};

function displayMarketKey(value?: string | null) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return (raw.split(':').pop() || raw).replace(/^market[_:-]?/, '');
}

function displayNorm(value?: string | null) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function flexiblePlayerPattern(value?: string | null) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('[\\s\\u00a0._-]+');
}

function stripPlayerFromMarket(value?: string | null, playerName?: string | null) {
  let label = String(value || '').normalize('NFKC').replace(/\u00a0/g, ' ').trim();
  if (!label || !playerName) return label;
  const pattern = flexiblePlayerPattern(playerName);
  if (pattern) label = label.replace(new RegExp(pattern + "(?:['’]s)?", 'ig'), ' ');
  if (displayNorm(label) === displayNorm(playerName)) return '';
  return label;
}

function displayMarketFromKey(key: string) {
  const bare = key.replace(/^(?:player|batter|pitcher|team|sgo|propline|sportsgameodds)_/, '');
  if (!bare || !/^[a-z0-9_]+$/.test(bare)) return '';
  const tokens: Record<string, string> = {
    yds: 'Yards',
    tds: 'Touchdowns',
    pts: 'Points',
    reb: 'Rebounds',
    rebs: 'Rebounds',
    ast: 'Assists',
    asts: 'Assists',
    rbi: 'RBI',
    rbis: 'RBIs',
    fg: 'FG',
    ft: 'FT',
    qb: 'QB',
    hr: 'HR',
    hrs: 'HRs',
  };
  return bare
    .split('_')
    .filter(Boolean)
    .map((token) => tokens[token] || token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

/**
 * Customer-facing stat name only. This never changes the raw market value used
 * for routing, provider lookups, grouping, or research requests.
 */
export function marketDisplayLabel(
  market?: string | null,
  playerName?: string | null,
  marketId?: string | null,
  sport?: string | null,
) {
  const marketKey = displayMarketKey(market);
  const key = displayMarketKey(marketId) || marketKey;
  if (['NFL', 'NCAAF'].includes(String(sport || '').toUpperCase()) && key === 'player_assists') {
    return 'Assisted Tackles';
  }
  if (MARKET_DISPLAY_LABELS[key]) return MARKET_DISPLAY_LABELS[key];

  let label = stripPlayerFromMarket(market, playerName);
  label = label
    .replace(/^\s*(?:player|batter|pitcher|team)[\s_:-]+/i, '')
    .replace(/\b(?:over\s*\/\s*under|under\s*\/\s*over|higher\s*\/\s*lower|lower\s*\/\s*higher)\b/gi, ' ')
    .replace(/\b(?:alternate|alt|main line|over|under|higher|lower)\b/gi, ' ')
    .replace(/\b(?:full[- ]game|first half|1st half|second half|2nd half|1q|2q|3q|4q|1h|2h)\b/gi, ' ')
    .replace(/\b(?:o|u)\s*[+-]?\d+(?:\.\d+)?\b/gi, ' ')
    .replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ' ')
    .replace(/[|·:–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const machineFallback = displayMarketFromKey(key || marketKey);
  const rawMarket = String(market || '').trim();
  if (/^[a-z0-9_:.-]+$/i.test(rawMarket) && /[_:-]/.test(rawMarket) && machineFallback) {
    return machineFallback;
  }
  return label || machineFallback || 'Prop';
}
