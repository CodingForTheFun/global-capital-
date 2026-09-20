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
export function fantasySpec({ sport, market, providerMarketKey, position, period, playerName } = {}) {
  if (/\s+\+\s+/.test(String(playerName || '')) || /\bcombo\b/i.test(String(market || ''))) return null;
  if (period && !['full', 'full_game', 'game', 'match', 'single_stat'].includes(String(period).trim().toLowerCase())) return null;
  const league = String(sport || '').trim().toUpperCase();
  const { source, key } = sourceAndKey(providerMarketKey);
  if (source !== 'prizepicks') return null;
  const label = String(market || '').trim().toLowerCase();
  const role = String(position || '').trim().toUpperCase();
  const genericFantasy = key === 'player_fantasy_score' || key === 'player_fantasy_points'
    || /^(?:fantasy\s+(?:score|points?))$/.test(label);
  if (league === 'NBA' && genericFantasy) return SPECS.nba;
  if (league === 'MLB' && (key === 'player_hitter_fantasy_score' || /hitter\s+fantasy\s+(?:score|points?)/.test(label))) return SPECS.mlb_hitter;
  if (league === 'MLB' && (key === 'player_pitcher_fantasy_score' || /pitcher\s+fantasy\s+(?:score|points?)/.test(label))) return SPECS.mlb_pitcher;
  if (league === 'MLB' && genericFantasy) {
    if (/^(?:P|SP|RP|LHP|RHP)$/.test(role)) return SPECS.mlb_pitcher;
    if (role) return SPECS.mlb_hitter;
  }
  return null;
}

export const fantasyScoringSupported = params => Boolean(fantasySpec(params));

export function scoreFantasyRow(row, spec, raw = null) {
  if (!spec || !row || !raw) return null;
  if (spec.id === 'nba') {
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
    note: 'Historical fantasy scores are reconstructed from verified game-log statistics using the platform scoring chart. A game is excluded if every required component cannot be verified.',
  };
}
