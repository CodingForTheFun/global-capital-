const num = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : null;

const SPECS = Object.freeze({
  nba: Object.freeze({
    id: 'nba', sport: 'NBA', platform: 'prizepicks', label: 'Fantasy Score (PrizePicks scoring)', proxyMarket: 'Points', proxyMarketKey: 'player_points',
    weights: Object.freeze({ points: 1, rebounds: 1.2, assists: 1.5, blocks: 3, steals: 3, turnovers: -1 }),
  }),
  mlb_hitter: Object.freeze({
    id: 'mlb_hitter', sport: 'MLB', platform: 'prizepicks', label: 'Hitter Fantasy Score (PrizePicks scoring)', proxyMarket: 'Hits', proxyMarketKey: 'batter_hits', category: 'batting',
    weights: Object.freeze({ singles: 3, doubles: 5, triples: 8, homeRuns: 10, runs: 2, runsBattedIn: 2, walks: 2, hitByPitch: 2, stolenBases: 5 }),
  }),
  mlb_pitcher: Object.freeze({
    id: 'mlb_pitcher', sport: 'MLB', platform: 'prizepicks', label: 'Pitcher Fantasy Score (PrizePicks scoring)', proxyMarket: 'Strikeouts', proxyMarketKey: 'pitcher_strikeouts', category: 'pitching',
    weights: Object.freeze({ pitcherWin: 6, qualityStart: 4, earnedRuns: -3, strikeouts: 3, pitchingOuts: 1 }),
  }),
});

function sourceAndKey(providerMarketKey) {
  const raw = String(providerMarketKey || '').trim().toLowerCase();
  const split = raw.indexOf(':');
  return split > 0 ? { source: raw.slice(0, split), key: raw.slice(split + 1) } : { source: null, key: raw };
}

/**
 * Return only formulas whose platform, sport and market identity are verified.
 * An unqualified "Fantasy Score" is intentionally not enough: platforms can
 * settle the same label with different scoring charts.
 */
export function fantasySpec({ sport, market, providerMarketKey } = {}) {
  const league = String(sport || '').trim().toUpperCase();
  const { source, key } = sourceAndKey(providerMarketKey);
  if (source !== 'prizepicks') return null;
  const label = String(market || '').trim().toLowerCase();
  if (league === 'NBA' && key === 'player_fantasy_score') return SPECS.nba;
  if (league === 'MLB' && (key === 'player_hitter_fantasy_score' || /hitter\s+fantasy\s+score/.test(label))) return SPECS.mlb_hitter;
  if (league === 'MLB' && (key === 'player_pitcher_fantasy_score' || /pitcher\s+fantasy\s+score/.test(label))) return SPECS.mlb_pitcher;
  return null;
}

export const fantasyScoringSupported = params => Boolean(fantasySpec(params));

export function scoreFantasyRow(row, spec, raw = null) {
  if (!spec || !row) return null;
  if (spec.id === 'nba') {
    const values = Object.fromEntries(Object.keys(spec.weights).map(key => [key, num(row[key])]));
    if (Object.values(values).some(value => value === null)) return null;
    return Number(Object.entries(spec.weights).reduce((sum, [key, weight]) => sum + values[key] * weight, 0).toFixed(2));
  }
  if (spec.id === 'mlb_hitter') {
    const hits = num(raw?.hits ?? row.hits), doubles = num(raw?.doubles ?? row.doubles), triples = num(raw?.triples ?? row.triples), homeRuns = num(raw?.homeRuns ?? row.homeRuns);
    const runs = num(raw?.runs ?? row.runs), rbi = num(raw?.RBIs ?? raw?.runsBattedIn ?? row.runsBattedIn), walks = num(raw?.walks ?? row.walks);
    const hitByPitch = num(raw?.hitByPitch), stolenBases = num(raw?.stolenBases ?? row.stolenBases);
    if ([hits,doubles,triples,homeRuns,runs,rbi,walks,hitByPitch,stolenBases].some(value => value === null)) return null;
    const singles = hits - doubles - triples - homeRuns;
    if (singles < 0) return null;
    return Number((singles*3 + doubles*5 + triples*8 + homeRuns*10 + runs*2 + rbi*2 + walks*2 + hitByPitch*2 + stolenBases*5).toFixed(2));
  }
  if (spec.id === 'mlb_pitcher') {
    const outs = num(row.pitchingOuts), earnedRuns = num(raw?.earnedRuns ?? row.earnedRuns), strikeouts = num(raw?.strikeouts ?? row.strikeouts);
    const decision = String(raw?.['wins-losses'] ?? '').trim();
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
    note: 'Historical fantasy scores are reconstructed from verified game-log statistics using the platform scoring chart. A game is excluded if every required component cannot be verified.',
  };
}
