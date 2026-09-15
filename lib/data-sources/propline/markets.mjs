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
  MLS: 'soccer_usa_mls',
  EPL: 'soccer_epl',
  UCL: 'soccer_uefa_champs_league',
});

export const SPORT_BY_KEY = Object.freeze(Object.fromEntries(Object.entries(SPORT_KEYS).map(([sport, key]) => [key, sport])));
export function proplineSportKey(sport) { return SPORT_KEYS[String(sport ?? '').toUpperCase()] || null; }
export function sportFromProplineKey(key) { return SPORT_BY_KEY[String(key ?? '').toLowerCase()] || null; }

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
