import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backfillH2H } from '../lib/data-sources/espn/h2h-backfill.mjs';
import { researchOpponentMatches } from '../lib/analytics/research.mjs';
import { fantasySpec, fantasyScoringSupported, scoreFantasyRow } from '../lib/props/fantasy-scoring.mjs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';

const nfl2025 = JSON.parse(readFileSync(new URL('./fixtures/espn-nfl-gamelog.json', import.meta.url), 'utf8'));

test('H2H backfill reaches a prior season until it has a verified multi-game sample', async () => {
  const history = {
    available: true,
    season: 2026,
    opponent: 'BAL',
    opponentId: 'NFL:33',
    player: { playerName:'Fixture QB', providerPlayerId:'history:NFL:123', team:'PIT', sport:'NFL' },
    coverage: { seasonComplete:false },
    gameLog: [{ gameId:'nfl:current', date:'2026-09-13T17:00:00.000Z', season:2026, seasonType:2, opponent:'SEA', opponentId:'NFL:26', team:'PIT', value:200 }],
  };
  let calls = 0;
  const result = await backfillH2H(history, { sport:'NFL', playerName:'Fixture QB', market:'Passing Yards', line:220.5, side:'OVER' }, {
    now: () => Date.parse('2026-09-15T00:00:00Z'),
    fetchImpl: async url => {
      calls += 1;
      assert.match(String(url), /season=2025/);
      return { ok:true, json:async()=>nfl2025 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.coverage.h2hHistoryBackfilled, true);
  assert.equal(result.coverage.h2hHistoryGames, 2);
  assert.equal(result.coverage.h2hHistoryTarget, 2);
  assert.equal(result.gameLog.filter(row => row.opponentId === 'NFL:33').length, 2);
  assert.ok(result.gameLog.every(row => row.gameId));
});

test('H2H backfill spends no request once two verified meetings are already present', async () => {
  const history = {
    available:true, season:2026, opponent:'BAL', opponentId:'NFL:33',
    player:{providerPlayerId:'history:NFL:123'}, coverage:{},
    gameLog:[
      {gameId:'nfl:1',date:'2026-01-01T00:00:00Z',season:2026,seasonType:2,opponent:'BAL',opponentId:'NFL:33',value:1},
      {gameId:'nfl:2',date:'2025-12-01T00:00:00Z',season:2025,seasonType:2,opponent:'BAL',opponentId:'NFL:33',value:2},
    ],
  };
  let calls=0;
  const result=await backfillH2H(history,{sport:'NFL',market:'Passing Yards'},{fetchImpl:async()=>{calls++;throw Error('should not fetch');}});
  assert.equal(result,history);
  assert.equal(calls,0);
});

test('H2H opponent matching prefers verified IDs and falls back only when a row has no ID', () => {
  const matchup={opponent:'BAL',opponentId:'NFL:33'};
  assert.equal(researchOpponentMatches({opponent:'BAL',opponentId:'NFL:33'},matchup),true);
  assert.equal(researchOpponentMatches({opponent:'BAL',opponentId:'NFL:8'},matchup),false);
  assert.equal(researchOpponentMatches({opponent:'BAL'},matchup),true);
  assert.equal(researchOpponentMatches({opponent:'SEA'},matchup),false);
});

test('PrizePicks NBA fantasy score uses the verified six-component chart exactly', () => {
  const spec = fantasySpec({ sport:'NBA', market:'Fantasy Score', providerMarketKey:'prizepicks:player_fantasy_score' });
  assert.ok(spec);
  const raw={points:'20',totalRebounds:'10',assists:'5',blocks:'2',steals:'1',turnovers:'4'};
  assert.equal(scoreFantasyRow({},spec,raw),44.5);
});

test('PrizePicks Fantasy Points aliases resolve only with verified source and MLB role', () => {
  assert.equal(fantasySpec({sport:'NBA',market:'Fantasy Points',providerMarketKey:'prizepicks:player_fantasy_points'})?.id,'nba');
  assert.equal(fantasySpec({sport:'MLB',market:'Fantasy Points',providerMarketKey:'prizepicks:player_fantasy_points',position:'OF'})?.id,'mlb_hitter');
  assert.equal(fantasySpec({sport:'MLB',market:'Fantasy Points',providerMarketKey:'prizepicks:player_fantasy_points',position:'SP'})?.id,'mlb_pitcher');
  assert.equal(fantasySpec({sport:'MLB',market:'Fantasy Points',providerMarketKey:'prizepicks:player_fantasy_points'}),null);
  assert.equal(fantasySpec({sport:'MLB',market:'Fantasy Points',providerMarketKey:'underdog:player_fantasy_points',position:'OF'}),null);
});

test('PrizePicks MLB hitter and pitcher fantasy scores use every required component', () => {
  const hitter=fantasySpec({sport:'MLB',market:'Hitter Fantasy Score',providerMarketKey:'prizepicks:player_hitter_fantasy_score'});
  const hitterRaw={hits:'3',doubles:'1',triples:'0',homeRuns:'1',runs:'2',RBIs:'3',walks:'1',hitByPitch:'0',stolenBases:'1'};
  // One single (3), one double (5), one HR (10), 2R (4), 3RBI (6), BB (2), SB (5).
  assert.equal(scoreFantasyRow({},hitter,hitterRaw),35);

  const pitcher=fantasySpec({sport:'MLB',market:'Pitcher Fantasy Score',providerMarketKey:'prizepicks:player_pitcher_fantasy_score'});
  const pitcherRaw={earnedRuns:'2',strikeouts:'8','wins-losses':'W(8-2)'};
  // Win 6 + QS 4 - 2 ER*3 + 8 K*3 + 18 outs.
  assert.equal(scoreFantasyRow({pitchingOuts:18},pitcher,pitcherRaw),46);
});

test('fantasy scoring stays fail-closed for an unverified platform or sport', () => {
  assert.equal(fantasyScoringSupported({sport:'NBA',market:'Fantasy Score',providerMarketKey:'underdog:player_fantasy_score'}),false);
  assert.equal(fantasyScoringSupported({sport:'NFL',market:'Fantasy Score',providerMarketKey:'prizepicks:player_fantasy_score'}),false);
  assert.equal(fantasyScoringSupported({sport:'WNBA',market:'Fantasy Score',providerMarketKey:'prizepicks:player_fantasy_score'}),false);
});

test('production UI sends source-qualified fantasy research and does not present zero H2H games like a result', () => {
  const source=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
  const patched=patchFantasyH2HUi(patchResearchUi(source));
  assert.match(patched,/function researchMarketKey/);
  assert.match(patched,/id\.indexOf\(':\'\)>0/);
  assert.match(patched,/prizepicks.*marketId/s);
  assert.match(patched,/H2H','N\/A','','0 prior games'/);
  assert.match(patched,/FANTASY_COMPONENTS_INCOMPLETE/);
  assert.doesNotThrow(()=>new Function(patched));
});
