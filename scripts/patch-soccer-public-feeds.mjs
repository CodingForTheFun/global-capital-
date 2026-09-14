import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function replaceOnceOrPresent(source, from, to, label) {
  if (source.includes(to)) return source;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`[soccer-feeds] ${label} anchor count=${count}`);
  return source.replace(from, to);
}

function patchFile(root, relative, edits) {
  const file = path.join(root, relative);
  if (!existsSync(file)) {
    console.warn(`[soccer-feeds] ${relative} is not present; skipping its patches.`);
    return;
  }
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

  // The soccer tab and its research policy used to be added here, because at
  // the time there was no way to research a prop that named no competition:
  // the tab was introduced already pinned to "line only", pointing people at
  // MLS, EPL and UCL instead. Those are now real: a league-agnostic ESPN game
  // log answers generic SOCCER props, so the sport list lives in the adapter
  // itself and soccer is researched rather than declared unresearchable. The
  // two edits that used to sit here are deliberately gone, not lost - leaving
  // the line-only edit in place would switch the research back off at build
  // time, which is the one change no test would have caught.

  patchFile(root, 'lib/ingestion/fanduel-public.mjs', [{
    label: 'FanDuel soccer page',
    from: "  NCAAF: 'ncaaf', NCAAB: 'ncaab', TENNIS: 'tennis',\n});",
    to: "  NCAAF: 'ncaaf', NCAAB: 'ncaab', TENNIS: 'tennis', SOCCER: 'soccer',\n});",
  }]);

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

  // Current DraftKings collector uses the public v5 event-group feed. EPL, MLS
  // and UCL stay league-scoped so league-specific historical research remains honest.
  patchFile(root, 'lib/ingestion/draftkings-sportsbook-public.mjs', [
    {
      label: 'DraftKings soccer leagues',
      from: "const LEAGUES = Object.freeze({ NFL: 88808, NBA: 42648, MLB: 84240, NHL: 42133 });",
      to: "const LEAGUES = Object.freeze({ NFL: 88808, NBA: 42648, MLB: 84240, NHL: 42133, MLS: Number(process.env.AUTOSCOUT_DRAFTKINGS_MLS_LEAGUE_ID || 40252), EPL: Number(process.env.AUTOSCOUT_DRAFTKINGS_EPL_LEAGUE_ID || 40253), UCL: Number(process.env.AUTOSCOUT_DRAFTKINGS_UCL_LEAGUE_ID || 40685) });",
    },
    {
      label: 'DraftKings soccer market rules',
      from: "  NHL: [\n    ['Shots on Goal', /shots?\\s+on\\s+goal/i], ['Blocked Shots', /blocked\\s+shots?/i],\n    ['Goals Against', /goals?\\s+against/i], ['Saves', /\\bsaves?\\b/i],\n    ['Points', /\\bpoints?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i],\n  ],\n});",
      to: "  NHL: [\n    ['Shots on Goal', /shots?\\s+on\\s+goal/i], ['Blocked Shots', /blocked\\s+shots?/i],\n    ['Goals Against', /goals?\\s+against/i], ['Saves', /\\bsaves?\\b/i],\n    ['Points', /\\bpoints?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i],\n  ],\n  MLS: [\n    ['Shots on Target', /shots?\\s+on\\s+target/i], ['Passes Attempted', /passes?\\s+attempted/i], ['Passes Completed', /passes?\\s+completed/i],\n    ['Attempted Dribbles', /attempted\\s+dribbles?/i], ['Clearances', /clearances?/i], ['Tackles', /\\btackles?\\b/i],\n    ['Saves', /\\b(?:goalie\\s+)?saves?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i], ['Shots', /\\bshots?\\b/i],\n  ],\n  EPL: [\n    ['Shots on Target', /shots?\\s+on\\s+target/i], ['Passes Attempted', /passes?\\s+attempted/i], ['Passes Completed', /passes?\\s+completed/i],\n    ['Attempted Dribbles', /attempted\\s+dribbles?/i], ['Clearances', /clearances?/i], ['Tackles', /\\btackles?\\b/i],\n    ['Saves', /\\b(?:goalie\\s+)?saves?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i], ['Shots', /\\bshots?\\b/i],\n  ],\n  UCL: [\n    ['Shots on Target', /shots?\\s+on\\s+target/i], ['Passes Attempted', /passes?\\s+attempted/i], ['Passes Completed', /passes?\\s+completed/i],\n    ['Attempted Dribbles', /attempted\\s+dribbles?/i], ['Clearances', /clearances?/i], ['Tackles', /\\btackles?\\b/i],\n    ['Saves', /\\b(?:goalie\\s+)?saves?\\b/i], ['Assists', /\\bassists?\\b/i], ['Goals', /\\bgoals?\\b/i], ['Shots', /\\bshots?\\b/i],\n  ],\n});",
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
