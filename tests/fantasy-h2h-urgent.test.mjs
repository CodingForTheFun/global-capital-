import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backfillH2H } from '../lib/data-sources/espn/h2h-backfill.mjs';
import { scoreFootballSummaryForAthlete } from '../lib/data-sources/espn/fantasy-research.mjs';
import { fantasySpec, fantasyScoringSupported, scoreFantasyRow } from '../lib/props/fantasy-scoring.mjs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';

const nfl2025 = JSON.parse(readFileSync(new URL('./fixtures/espn-nfl-gamelog.json', import.meta.url), 'utf8'));

test('H2H backfill reaches a prior season only when the ordinary history has no meeting', async () => {
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
  assert.ok(result.gameLog.some(row => row.opponentId === 'NFL:33'));
  assert.ok(result.gameLog.every(row => row.gameId));
});

test('H2H backfill spends no request when a verified meeting is already present', async () => {
  const history = {
    available:true, season:2026, opponent:'BAL', opponentId:'NFL:33',
    player:{providerPlayerId:'history:NFL:123'}, coverage:{},
    gameLog:[{gameId:'nfl:1',date:'2026-01-01T00:00:00Z',season:2026,seasonType:2,opponent:'BAL',opponentId:'NFL:33',value:1}],
  };
  let calls=0;
  const result=await backfillH2H(history,{sport:'NFL',market:'Passing Yards'},{fetchImpl:async()=>{calls++;throw Error('should not fetch');}});
  assert.equal(result,history);
  assert.equal(calls,0);
});

test('PrizePicks basketball fantasy score uses the verified six-component chart', () => {
  const raw={points:'20',totalRebounds:'10',assists:'5',blocks:'2',steals:'1',turnovers:'4'};
  for (const sport of ['NBA','WNBA','NCAAB']) {
    const spec = fantasySpec({ sport, market:'Fantasy Score', providerMarketKey:'prizepicks:player_fantasy_score' });
    assert.ok(spec, sport);
    assert.equal(scoreFantasyRow({},spec,raw),44.5,sport);
  }
});

test('PrizePicks MLB hitter and pitcher fantasy scores use every required component', () => {
  const hitter=fantasySpec({sport:'MLB',market:'Hitter Fantasy Score',providerMarketKey:'prizepicks:player_hitter_fantasy_score'});
  const hitterRaw={hits:'3',doubles:'1',triples:'0',homeRuns:'1',runs:'2',RBIs:'3',walks:'1',hitByPitch:'0',stolenBases:'1'};
  assert.equal(scoreFantasyRow({},hitter,hitterRaw),35);

  const pitcher=fantasySpec({sport:'MLB',market:'Pitcher Fantasy Score',providerMarketKey:'prizepicks:player_pitcher_fantasy_score'});
  const pitcherRaw={earnedRuns:'2',strikeouts:'8','wins-losses':'W(8-2)'};
  assert.equal(scoreFantasyRow({pitchingOuts:18},pitcher,pitcherRaw),46);
});

test('PrizePicks NFL offensive fantasy score is reconstructed from the full box score', () => {
  const spec=fantasySpec({sport:'NFL',market:'Fantasy Score',providerMarketKey:'prizepicks:player_fantasy_score'});
  const athlete=id=>({athlete:{id:'7'},stats:id});
  const payload={boxscore:{players:[{team:{id:'1'},statistics:[
    {name:'passing',keys:['passingYards','passingTouchdowns','interceptions'],athletes:[athlete(['250','2','1'])]},
    {name:'rushing',keys:['rushingYards','rushingTouchdowns'],athletes:[athlete(['40','1'])]},
    {name:'receiving',keys:['receptions','receivingYards','receivingTouchdowns'],athletes:[]},
    {name:'fumbles',keys:['fumbles','fumblesLost','fumblesRecovered'],athletes:[athlete(['1','1','0'])]},
    {name:'kickReturns',keys:['kickReturns','kickReturnYards','kickReturnTouchdowns'],athletes:[]},
    {name:'puntReturns',keys:['puntReturns','puntReturnYards','puntReturnTouchdowns'],athletes:[]},
  ]}]},drives:{previous:[]},scoringPlays:[]};
  // 10 pass yds + 8 pass TD -1 INT +4 rush yds +6 rush TD -1 fumble.
  assert.equal(scoreFootballSummaryForAthlete(payload,'7',spec),26);
});

test('NFL fantasy scoring refuses a team game with an unattributed rare scoring component', () => {
  const spec=fantasySpec({sport:'NFL',market:'Fantasy Score',providerMarketKey:'prizepicks:player_fantasy_score'});
  const player={athlete:{id:'7'},stats:['250','2','1']};
  const payload={boxscore:{players:[{team:{id:'1'},statistics:[
    {name:'passing',keys:['passingYards','passingTouchdowns','interceptions'],athletes:[player]},
    {name:'rushing',keys:['rushingYards','rushingTouchdowns'],athletes:[]},
    {name:'receiving',keys:['receptions','receivingYards','receivingTouchdowns'],athletes:[]},
    {name:'fumbles',keys:['fumbles','fumblesLost','fumblesRecovered'],athletes:[]},
    {name:'kickReturns',keys:['kickReturns','kickReturnYards','kickReturnTouchdowns'],athletes:[]},
    {name:'puntReturns',keys:['puntReturns','puntReturnYards','puntReturnTouchdowns'],athletes:[]},
  ]}]},scoringPlays:[{id:'x',text:'Two-point conversion is GOOD',teamParticipants:[{type:'offense',team:{id:'1'}}]}]};
  assert.equal(scoreFootballSummaryForAthlete(payload,'7',spec),null);
});

test('PrizePicks NFL kicker scoring uses made field-goal distance and miss penalties', () => {
  const spec=fantasySpec({sport:'NFL',market:'Kicker Fantasy Score',providerMarketKey:'prizepicks:player_kicker_fantasy_score'});
  const teamParticipants=[{type:'offense',team:{id:'1'}}];
  const payload={boxscore:{players:[{team:{id:'1'},statistics:[{name:'kicking',keys:['fieldGoalsMade/fieldGoalAttempts','extraPointsMade/extraPointAttempts'],athletes:[{athlete:{id:'4'},stats:['2/3','3/4']}]}]}]},
    scoringPlays:[
      {id:'fg1',scoringPlay:true,text:'Kicker 35 yard field goal is GOOD',teamParticipants},
      {id:'fg2',scoringPlay:true,text:'Kicker 52 yd field goal is GOOD',teamParticipants},
    ]};
  assert.equal(scoreFootballSummaryForAthlete(payload,'4',spec),9);
});

test('PrizePicks soccer goalie fantasy score uses start, saves, goals conceded and clean sheet', () => {
  const spec=fantasySpec({sport:'SOCCER',market:'Goalie Fantasy Score',providerMarketKey:'prizepicks:player_goalie_fantasy_score'});
  assert.ok(spec);
  assert.equal(scoreFantasyRow({started:true},spec,{saves:'4',goalsConceded:'1',cleanSheets:'0'}),11);
  assert.equal(scoreFantasyRow({started:false},spec,{saves:'4',goalsConceded:'1',cleanSheets:'0'}),null);
});

test('fantasy scoring stays fail-closed for unverified platform or unsupported formula', () => {
  assert.equal(fantasyScoringSupported({sport:'NBA',market:'Fantasy Score',providerMarketKey:'underdog:player_fantasy_score'}),false);
  assert.equal(fantasyScoringSupported({sport:'NHL',market:'Fantasy Score',providerMarketKey:'prizepicks:player_fantasy_score'}),false);
  assert.equal(fantasyScoringSupported({sport:'SOCCER',market:'Fantasy Score',providerMarketKey:'prizepicks:player_fantasy_score'}),false);
});

test('production UI sends source-qualified fantasy research and distinguishes true zero H2H', () => {
  const source=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
  const patched=patchFantasyH2HUi(patchResearchUi(source));
  assert.match(patched,/function researchMarketKey/);
  assert.match(patched,/prizepicks.*marketId/s);
  assert.match(patched,/WNBA/);
  assert.match(patched,/NCAAF/);
  assert.match(patched,/Kicker Fantasy Score/);
  assert.match(patched,/player_goalie_fantasy_score/);
  assert.match(patched,/H2H','0g'/);
  assert.match(patched,/FANTASY_COMPONENTS_INCOMPLETE/);
  assert.doesNotThrow(()=>new Function(patched));
});
