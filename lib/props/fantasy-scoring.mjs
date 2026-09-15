const num = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : null;

function rawCount(raw, ...keys) {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of keys) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    if (String(value ?? '').trim() === '-') return 0;
    return num(value);
  }
  return null;
}

const BASKETBALL_WEIGHTS = Object.freeze({ points: 1, rebounds: 1.2, assists: 1.5, blocks: 3, steals: 3, turnovers: -1 });
const NFL_OFFENSE_WEIGHTS = Object.freeze({
  passingYards: 0.04, passingTouchdowns: 4, interceptions: -1,
  rushingYards: 0.1, rushingTouchdowns: 6,
  receptions: 1, receivingYards: 0.1, receivingTouchdowns: 6,
  fumblesLost: -1, twoPointConversions: 2,
  offensiveFumbleRecoveryTouchdowns: 6, returnTouchdowns: 6,
});

const basketballSpec = sport => Object.freeze({
  id: `basketball_${sport.toLowerCase()}`, sport, platform: 'prizepicks',
  label: 'Fantasy Score (PrizePicks scoring)', proxyMarket: 'Points', proxyMarketKey: 'player_points',
  weights: BASKETBALL_WEIGHTS,
});

const SPECS = Object.freeze({
  nba: basketballSpec('NBA'),
  wnba: basketballSpec('WNBA'),
  ncaab: basketballSpec('NCAAB'),
  nfl_offense: Object.freeze({
    id: 'nfl_offense', sport: 'NFL', platform: 'prizepicks', label: 'Fantasy Score (PrizePicks scoring)',
    proxyCandidates: Object.freeze([
      Object.freeze({ market: 'Passing Yards', providerMarketKey: 'player_pass_yds' }),
      Object.freeze({ market: 'Rushing Yards', providerMarketKey: 'player_rush_yds' }),
      Object.freeze({ market: 'Receiving Yards', providerMarketKey: 'player_reception_yds' }),
    ]),
    weights: NFL_OFFENSE_WEIGHTS,
  }),
  ncaaf_offense: Object.freeze({
    id: 'ncaaf_offense', sport: 'NCAAF', platform: 'prizepicks', label: 'Fantasy Score (PrizePicks scoring)',
    proxyCandidates: Object.freeze([
      Object.freeze({ market: 'Passing Yards', providerMarketKey: 'player_pass_yds' }),
      Object.freeze({ market: 'Rushing Yards', providerMarketKey: 'player_rush_yds' }),
      Object.freeze({ market: 'Receiving Yards', providerMarketKey: 'player_reception_yds' }),
    ]),
    weights: NFL_OFFENSE_WEIGHTS,
  }),
  nfl_kicker: Object.freeze({
    id: 'nfl_kicker', sport: 'NFL', platform: 'prizepicks', label: 'Kicker Fantasy Score (PrizePicks scoring)',
    proxyMarket: 'Field Goals Made', proxyMarketKey: 'player_field_goals',
    weights: Object.freeze({ fieldGoal0to39: 3, fieldGoal40to49: 4, fieldGoal50plus: 5, patMade: 1, missedFieldGoal: -1, missedPat: -1 }),
  }),
  mlb_hitter: Object.freeze({
    id: 'mlb_hitter', sport: 'MLB', platform: 'prizepicks', label: 'Hitter Fantasy Score (PrizePicks scoring)', proxyMarket: 'Hits', proxyMarketKey: 'batter_hits', category: 'batting',
    weights: Object.freeze({ singles: 3, doubles: 5, triples: 8, homeRuns: 10, runs: 2, runsBattedIn: 2, walks: 2, hitByPitch: 2, stolenBases: 5 }),
  }),
  mlb_pitcher: Object.freeze({
    id: 'mlb_pitcher', sport: 'MLB', platform: 'prizepicks', label: 'Pitcher Fantasy Score (PrizePicks scoring)', proxyMarket: 'Strikeouts', proxyMarketKey: 'pitcher_strikeouts', category: 'pitching',
    weights: Object.freeze({ pitcherWin: 6, qualityStart: 4, earnedRuns: -3, strikeouts: 3, pitchingOuts: 1 }),
  }),
  soccer_goalie: Object.freeze({
    id: 'soccer_goalie', sport: 'SOCCER', platform: 'prizepicks', label: 'Goalie Fantasy Score (PrizePicks scoring)',
    proxyMarket: 'Saves', proxyMarketKey: 'player_goalie_saves',
    weights: Object.freeze({ startingScore: 5, saves: 2, goalsConceded: -2, cleanSheet: 5 }),
  }),
});

function sourceAndKey(providerMarketKey) {
  const raw = String(providerMarketKey || '').trim().toLowerCase();
  const split = raw.indexOf(':');
  return split > 0 ? { source: raw.slice(0, split), key: raw.slice(split + 1) } : { source: null, key: raw };
}

/**
 * Return only formulas whose platform, sport and market identity have been
 * independently verified. An unqualified Fantasy Score is intentionally not
 * enough: another book can settle the same label with different weights.
 */
export function fantasySpec({ sport, market, providerMarketKey } = {}) {
  const league = String(sport || '').trim().toUpperCase();
  const { source, key } = sourceAndKey(providerMarketKey);
  if (source !== 'prizepicks') return null;
  const label = String(market || '').trim().toLowerCase();
  if (key === 'player_fantasy_score' && ['NBA','WNBA','NCAAB'].includes(league)) return SPECS[league.toLowerCase()];
  if (['NFL','NCAAF'].includes(league) && key === 'player_fantasy_score') return league === 'NFL' ? SPECS.nfl_offense : SPECS.ncaaf_offense;
  if (league === 'NFL' && (key === 'player_kicker_fantasy_score' || /\bkicker\s+fantasy\s+score\b/.test(label))) return SPECS.nfl_kicker;
  if (league === 'MLB' && (key === 'player_hitter_fantasy_score' || /hitter\s+fantasy\s+score/.test(label))) return SPECS.mlb_hitter;
  if (league === 'MLB' && (key === 'player_pitcher_fantasy_score' || /pitcher\s+fantasy\s+score/.test(label))) return SPECS.mlb_pitcher;
  if (['SOCCER','MLS','EPL','UCL'].includes(league) && (key === 'player_goalie_fantasy_score' || /\bgoal(?:ie|keeper)\s+fantasy\s+score\b/.test(label))) return SPECS.soccer_goalie;
  return null;
}

export const fantasyScoringSupported = params => Boolean(fantasySpec(params));

export function scoreFantasyRow(row, spec, raw = null) {
  if (!spec || !row || !raw) return null;
  if (spec.id.startsWith('basketball_')) {
    const values = {
      points: rawCount(raw, 'points'),
      rebounds: rawCount(raw, 'totalRebounds', 'rebounds'),
      assists: rawCount(raw, 'assists'),
      blocks: rawCount(raw, 'blocks', 'blockedShots'),
      steals: rawCount(raw, 'steals'),
      turnovers: rawCount(raw, 'turnovers'),
    };
    if (Object.values(values).some(value => value === null)) return null;
    return Number(Object.entries(spec.weights).reduce((sum, [key, weight]) => sum + values[key] * weight, 0).toFixed(2));
  }
  if (spec.id === 'nfl_offense' || spec.id === 'ncaaf_offense') {
    const values = Object.fromEntries(Object.keys(spec.weights).map(key => [key, rawCount(raw, key)]));
    if (Object.values(values).some(value => value === null)) return null;
    return Number(Object.entries(spec.weights).reduce((sum, [key, weight]) => sum + values[key] * weight, 0).toFixed(2));
  }
  if (spec.id === 'nfl_kicker') {
    const values = Object.fromEntries(Object.keys(spec.weights).map(key => [key, rawCount(raw, key)]));
    if (Object.values(values).some(value => value === null)) return null;
    return Number(Object.entries(spec.weights).reduce((sum, [key, weight]) => sum + values[key] * weight, 0).toFixed(2));
  }
  if (spec.id === 'soccer_goalie') {
    if (row.started !== true) return null;
    const saves = rawCount(raw, 'saves'), goalsConceded = rawCount(raw, 'goalsConceded', 'goalsAgainst');
    const cleanSheet = rawCount(raw, 'cleanSheets', 'cleanSheet', 'clean_sheets');
    if ([saves, goalsConceded, cleanSheet].some(value => value === null)) return null;
    return Number((5 + saves*2 - goalsConceded*2 + cleanSheet*5).toFixed(2));
  }
  if (spec.id === 'mlb_hitter') {
    const hits = rawCount(raw, 'hits'), doubles = rawCount(raw, 'doubles'), triples = rawCount(raw, 'triples'), homeRuns = rawCount(raw, 'homeRuns');
    const runs = rawCount(raw, 'runs'), rbi = rawCount(raw, 'RBIs', 'runsBattedIn'), walks = rawCount(raw, 'walks');
    const hitByPitch = rawCount(raw, 'hitByPitch'), stolenBases = rawCount(raw, 'stolenBases');
    if ([hits,doubles,triples,homeRuns,runs,rbi,walks,hitByPitch,stolenBases].some(value => value === null)) return null;
    const singles = hits - doubles - triples - homeRuns;
    if (singles < 0) return null;
    return Number((singles*3 + doubles*5 + triples*8 + homeRuns*10 + runs*2 + rbi*2 + walks*2 + hitByPitch*2 + stolenBases*5).toFixed(2));
  }
  if (spec.id === 'mlb_pitcher') {
    const outs = num(row.pitchingOuts), earnedRuns = rawCount(raw, 'earnedRuns'), strikeouts = rawCount(raw, 'strikeouts');
    if (!Object.hasOwn(raw, 'wins-losses')) return null;
    const decision = String(raw['wins-losses'] ?? '').trim();
    if ([outs,earnedRuns,strikeouts].some(value => value === null) || !decision) return null;
    const pitcherWin = /^W(?:\(|$)/i.test(decision) ? 1 : 0;
    const qualityStart = outs >= 18 && earnedRuns <= 3 ? 1 : 0;
    return Number((pitcherWin*6 + qualityStart*4 - earnedRuns*3 + strikeouts*3 + outs).toFixed(2));
  }
  return null;
}

export function fantasyScoringMeta(spec) {
  if (!spec) return null;
  return {
    platform: 'PrizePicks',
    formula: spec.id,
    label: spec.label,
    exact: true,
    note: 'Historical fantasy scores are reconstructed only from verified scoring components. If the historical source cannot prove every component for a game, Auto Scout withholds that fantasy history instead of assuming zero.',
  };
}
