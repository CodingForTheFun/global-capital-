import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function replaceOnceOrPresent(source, from, to, label) {
  if (source.includes(to)) return source;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`[soccer-feeds] ${label} anchor count=${count}`);
  return source.replace(from, to);
}

function patchFile(root, relative, edits) {
  const file = path.join(root, relative);
  let source = readFileSync(file, 'utf8');
  for (const edit of edits) source = replaceOnceOrPresent(source, edit.from, edit.to, `${relative}: ${edit.label}`);
  writeFileSync(file, source, 'utf8');
}

export function applySoccerPublicFeedPatches(root = process.cwd()) {
  // Expose a truthful all-soccer board in addition to league-specific tabs.
  // Keep soccer out of AUTOMATIC_SPORTS so this never widens paid-provider polling.
  patchFile(root, 'lib/autoscout/models.mjs', [{
    label: 'supported sports',
    from: "export const SUPPORTED_SPORTS = Object.freeze([...AUTOMATIC_SPORTS,'MLS','EPL','UCL','TENNIS']);",
    to: "export const SUPPORTED_SPORTS = Object.freeze([...AUTOMATIC_SPORTS,'SOCCER','MLS','EPL','UCL','TENNIS']);",
  }]);

  patchFile(root, 'lib/autoscout/persistence-scheduler.mjs', [{
    label: 'public soccer persistence',
    from: "const PUBLIC_PERSISTENCE_SPORTS = Object.freeze([...AUTOMATIC_SPORTS, 'TENNIS']);",
    to: "const PUBLIC_PERSISTENCE_SPORTS = Object.freeze([...AUTOMATIC_SPORTS, 'SOCCER','MLS','EPL','UCL','TENNIS']);",
  }]);

  patchFile(root, 'lib/autoscout/research-ui-runtime-patch.mjs', [
    {
      label: 'all-soccer tab',
      from: "    \"var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL','TENNIS'];\",",
      to: "    \"var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','SOCCER','MLS','EPL','UCL','TENNIS'];\",",
    },
    {
      label: 'generic soccer line-only policy',
      from: " if(selectedSport==='TENNIS')return {ok:true,available:false,lineOnly:true,retryable:false,code:'HISTORICAL_SOURCE_UNVERIFIED',message:'Live tennis line only. A complete tennis match-history source is not verified yet, so Auto Scout will not invent L5/L10/H2H results.'};",
      to: " if(selectedSport==='SOCCER')return {ok:true,available:false,lineOnly:true,retryable:false,code:'HISTORICAL_SOURCE_UNVERIFIED',message:'Live all-soccer line only. Use MLS, EPL or UCL when a league-specific verified history match is available.'};\n if(selectedSport==='TENNIS')return {ok:true,available:false,lineOnly:true,retryable:false,code:'HISTORICAL_SOURCE_UNVERIFIED',message:'Live tennis line only. A complete tennis match-history source is not verified yet, so Auto Scout will not invent L5/L10/H2H results.'};",
    },
  ]);

  // FanDuel already has a generic player-total parser that understands the key
  // soccer stat labels. Point it at FanDuel's soccer content page as another
  // zero-credit source.
  patchFile(root, 'lib/ingestion/fanduel-public.mjs', [{
    label: 'FanDuel soccer page',
    from: "  NCAAF: 'ncaaf', NCAAB: 'ncaab', TENNIS: 'tennis',\n});",
    to: "  NCAAF: 'ncaaf', NCAAB: 'ncaab', TENNIS: 'tennis', SOCCER: 'soccer',\n});",
  }]);

  // Kambi / BetRivers exposes soccer under the top-level soccer list view.
  patchFile(root, 'lib/ingestion/betrivers-public.mjs', [
    {
      label: 'BetRivers soccer path',
      from: "const SPORT_PATHS = Object.freeze({ MLB: 'baseball/mlb', NBA: 'basketball/nba', NFL: 'american_football/nfl', NHL: 'ice_hockey/nhl' });",
      to: "const SPORT_PATHS = Object.freeze({ MLB: 'baseball/mlb', NBA: 'basketball/nba', NFL: 'american_football/nfl', NHL: 'ice_hockey/nhl', SOCCER: 'soccer' });",
    },
    {
      label: 'BetRivers soccer markets',
      from: "    [/strikeouts?/i, 'Strikeouts'], [/hits?/i, 'Hits'], [/shots?\\s+on\\s+goal/i, 'Shots on Goal'], [/blocked\\s+shots?/i, 'Blocked Shots'], [/saves?/i, 'Saves'], [/goals?/i, 'Goals'],",
      to: "    [/strikeouts?/i, 'Strikeouts'], [/hits?/i, 'Hits'], [/shots?\\s+on\\s+target/i, 'Shots on Target'], [/shots?\\s+on\\s+goal/i, 'Shots on Goal'], [/passes?\\s+attempted/i, 'Passes Attempted'], [/passes?\\s+completed/i, 'Passes Completed'], [/attempted\\s+dribbles?/i, 'Attempted Dribbles'], [/clearances?/i, 'Clearances'], [/tackles?/i, 'Tackles'], [/\\bshots?\\b/i, 'Shots'], [/blocked\\s+shots?/i, 'Blocked Shots'], [/saves?/i, 'Saves'], [/goals?/i, 'Goals'],",
    },
  ]);

  // Bovada's public coupon endpoint accepts the generic soccer path and its
  // event parser already enforces two-sided regular O/U lines.
  patchFile(root, 'lib/ingestion/bovada-public.mjs', [
    {
      label: 'Bovada soccer path',
      from: "  NCAAF: 'football/college-football', NCAAB: 'basketball/college-basketball',\n});",
      to: "  NCAAF: 'football/college-football', NCAAB: 'basketball/college-basketball', SOCCER: 'soccer',\n});",
    },
    {
      label: 'Bovada soccer markets',
      from: "    [/shots?\\s+on\\s+goal/i, 'Shots on Goal'], [/blocked\\s+shots?/i, 'Blocked Shots'], [/saves?/i, 'Saves'], [/goals?/i, 'Goals'],",
      to: "    [/shots?\\s+on\\s+target/i, 'Shots on Target'], [/shots?\\s+on\\s+goal/i, 'Shots on Goal'], [/passes?\\s+attempted/i, 'Passes Attempted'], [/passes?\\s+completed/i, 'Passes Completed'], [/attempted\\s+dribbles?/i, 'Attempted Dribbles'], [/clearances?/i, 'Clearances'], [/tackles?/i, 'Tackles'], [/\\bshots?\\b/i, 'Shots'], [/blocked\\s+shots?/i, 'Blocked Shots'], [/saves?/i, 'Saves'], [/goals?/i, 'Goals'],",
    },
  ]);

  // Pinnacle discovers its sport id dynamically, so only the soccer selector
  // and unit vocabulary need to be added.
  patchFile(root, 'lib/ingestion/pinnacle-public.mjs', [
    {
      label: 'Pinnacle soccer selector',
      from: "  MLB: /baseball/i, NHL: /hockey/i, TENNIS: /tennis/i,\n});",
      to: "  MLB: /baseball/i, NHL: /hockey/i, TENNIS: /tennis/i, SOCCER: /soccer/i,\n});",
    },
    {
      label: 'Pinnacle soccer league matching',
      from: "  if (!league && sport !== 'TENNIS') return false;\n  if (sport === 'NFL')",
      to: "  if (!league && !['TENNIS','SOCCER'].includes(sport)) return false;\n  if (sport === 'SOCCER') return true;\n  if (sport === 'NFL')",
    },
    {
      label: 'Pinnacle soccer units',
      from: "  Aces: 'Aces', DoubleFaults: 'Double Faults', GamesWon: 'Games Won', SetsWon: 'Sets Won',\n});",
      to: "  Aces: 'Aces', DoubleFaults: 'Double Faults', GamesWon: 'Games Won', SetsWon: 'Sets Won',\n  Shots: 'Shots', ShotsOnTarget: 'Shots on Target', PassesAttempted: 'Passes Attempted', PassesCompleted: 'Passes Completed', Tackles: 'Tackles', Clearances: 'Clearances', AttemptedDribbles: 'Attempted Dribbles', SoccerAssists: 'Assists',\n});",
    },
  ]);

  // DraftKings publishes soccer as league-specific feeds. These are the current
  // public league IDs; each has an env override so a rotation is configuration,
  // not another code edit. The collector may still fail closed if DK blocks the
  // anonymous transport in a region.
  patchFile(root, 'lib/ingestion/draftkings-sportsbook-public.mjs', [
    {
      label: 'DraftKings soccer leagues',
      from: "const LEAGUES = Object.freeze({ NFL: 88808, NBA: 42648, MLB: 84240, NHL: 42133 });",
      to: "const LEAGUES = Object.freeze({ NFL: 88808, NBA: 42648, MLB: 84240, NHL: 42133, MLS: Number(process.env.AUTOSCOUT_DRAFTKINGS_MLS_LEAGUE_ID || 40252), EPL: Number(process.env.AUTOSCOUT_DRAFTKINGS_EPL_LEAGUE_ID || 40253), UCL: Number(process.env.AUTOSCOUT_DRAFTKINGS_UCL_LEAGUE_ID || 40685) });",
    },
    {
      label: 'DraftKings soccer market templates',
      from: "const MARKET_SUFFIXES = Object.freeze({\n  NFL:",
      to: "const SOCCER_MARKETS = Object.freeze([\n  ['Shots on Target', /\\s+shots?\\s+on\\s+target(?:\\s+o\\/u)?$/i], ['Shots', /\\s+shots?(?:\\s+o\\/u)?$/i],\n  ['Passes Attempted', /\\s+passes?\\s+attempted(?:\\s+o\\/u)?$/i], ['Passes Completed', /\\s+passes?\\s+completed(?:\\s+o\\/u)?$/i],\n  ['Attempted Dribbles', /\\s+attempted\\s+dribbles?(?:\\s+o\\/u)?$/i], ['Clearances', /\\s+clearances?(?:\\s+o\\/u)?$/i],\n  ['Tackles', /\\s+tackles?(?:\\s+o\\/u)?$/i], ['Saves', /\\s+(?:goalie\\s+)?saves?(?:\\s+o\\/u)?$/i],\n  ['Assists', /\\s+assists?(?:\\s+o\\/u)?$/i], ['Goals', /\\s+goals?(?:\\s+o\\/u)?$/i],\n]);\nconst MARKET_SUFFIXES = Object.freeze({\n  MLS: SOCCER_MARKETS, EPL: SOCCER_MARKETS, UCL: SOCCER_MARKETS,\n  NFL:",
    },
    {
      label: 'DraftKings soccer category discovery',
      from: "    return /player|passing|rushing|receiving|pitcher|batter|goalie|skater|points|rebounds|assists|strikeouts|hits/i.test(name);",
      to: "    return /player|passing|rushing|receiving|pitcher|batter|goalie|skater|points|rebounds|assists|strikeouts|hits|shots|saves|passes|tackles|clearances|dribbles|goals/i.test(name);",
    },
  ]);

  // BetMGM documents soccer as sport id 4. competitionIds is optional, so the
  // generic SOCCER tab can combine every current soccer competition without
  // hard-coding league ids.
  patchFile(root, 'lib/ingestion/betmgm-public.mjs', [
    {
      label: 'BetMGM soccer sport',
      from: "  NHL: { sportId: '12', competitionId: '25' },\n});",
      to: "  NHL: { sportId: '12', competitionId: '25' },\n  SOCCER: { sportId: String(process.env.AUTOSCOUT_BETMGM_SOCCER_SPORT_ID || '4'), competitionId: String(process.env.AUTOSCOUT_BETMGM_SOCCER_COMPETITION_ID || '') },\n});",
    },
    {
      label: 'BetMGM soccer markets',
      from: "  NHL: [\n    ['Shots on Goal', /shots?\\s+on\\s+goal/i], ['Blocked Shots', /blocked\\s+shots?/i], ['Goals Against', /goals?\\s+against/i],\n    ['Saves', /\\bsaves?\\b/i], ['Points', /\\bpoints?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i],\n  ],\n});",
      to: "  NHL: [\n    ['Shots on Goal', /shots?\\s+on\\s+goal/i], ['Blocked Shots', /blocked\\s+shots?/i], ['Goals Against', /goals?\\s+against/i],\n    ['Saves', /\\bsaves?\\b/i], ['Points', /\\bpoints?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i],\n  ],\n  SOCCER: [\n    ['Shots on Target', /shots?\\s+on\\s+target/i], ['Passes Attempted', /passes?\\s+attempted/i], ['Passes Completed', /passes?\\s+completed/i],\n    ['Attempted Dribbles', /attempted\\s+dribbles?/i], ['Clearances', /clearances?/i], ['Tackles', /\\btackles?\\b/i],\n    ['Saves', /\\b(?:goalie\\s+)?saves?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i], ['Shots', /\\bshots?\\b/i],\n  ],\n});",
    },
    {
      label: 'BetMGM optional competition filter',
      from: "    for (const [key, value] of Object.entries({\n      'x-bwin-accessid': accessId, lang: 'en-us', country: 'US', userCountry: 'US', offerMapping: 'Filtered',\n      sportIds: ids.sportId, competitionIds: ids.competitionId, fixtureTypes: 'Standard', sortBy: 'StartDate', offerCategories: 'Gridable',\n    })) url.searchParams.set(key, value);",
      to: "    const params = {\n      'x-bwin-accessid': accessId, lang: 'en-us', country: 'US', userCountry: 'US', offerMapping: 'Filtered',\n      sportIds: ids.sportId, fixtureTypes: 'Standard', sortBy: 'StartDate', offerCategories: 'Gridable',\n    };\n    if (ids.competitionId) params.competitionIds = ids.competitionId;\n    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);",
    },
  ]);

  console.log('[autoscout] zero-credit soccer feeds enabled: PrizePicks/Underdog + FanDuel/Pinnacle/BetRivers/Bovada/DraftKings/BetMGM');
}
