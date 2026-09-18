import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fieldsFor } from '../lib/data-sources/sportsdataio/markets.mjs';
import { marketContract, normalizeStatColumns, statValue } from '../lib/data-sources/espn/stat-contract.mjs';
import { lineOnlyResearch, researchSelectionPolicy } from '../lib/autoscout/research-policy.mjs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';

const player = (sport, market, providerMarketKey) => ({sport, playerName:'Verified Player', market, providerMarketKey});

test('fantasy scoring is line-only across every supported sport family', () => {
  for (const sport of ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','MLS','EPL','UCL','TENNIS']) {
    const policy = researchSelectionPolicy({sport,playerName:'Verified Player',market:'Fantasy Score',providerMarketKey:'player_fantasy_score'});
    assert.equal(policy.eligible,false,sport);
    assert.equal(policy.code,'FANTASY_SCORING_UNVERIFIED',sport);
  }
});

test('multi-player and explicit combo markets are line-only across sports', () => {
  for (const sport of ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','MLS','EPL','UCL','TENNIS']) {
    assert.equal(researchSelectionPolicy({sport,playerName:'Player A + Player B',market:'Receiving Yards'}).code,'COMBO_HISTORY_UNVERIFIED');
    assert.equal(researchSelectionPolicy({sport,playerName:'Player A',market:'Receiving Yards (Combo)'}).code,'COMBO_HISTORY_UNVERIFIED');
  }
  assert.equal(lineOnlyResearch(player('NFL','Receiving Yards','player_reception_yds')),null);
});

test('tennis remains live-line-only until a complete match-history source is verified', () => {
  const policy=researchSelectionPolicy({sport:'TENNIS',playerName:'Carlos Example',market:'Total Games',providerMarketKey:'player_games'});
  assert.equal(policy.eligible,false);
  assert.equal(policy.code,'HISTORICAL_SOURCE_UNVERIFIED');
});

test('live NBA and WNBA shorthand combo labels map to measured box-score sums', () => {
  const cases=[
    ['player_pts_asts','Pts+Asts',['Points','Assists']],
    ['player_pts_rebs','Pts+Rebs',['Points','Rebounds']],
    ['player_pts_rebs_asts','Pts+Rebs+Asts',['Points','Rebounds','Assists']],
    ['player_rebs_asts','Rebs+Asts',['Rebounds','Assists']],
  ];
  for(const sport of ['NBA','WNBA']) for(const [key,label,expected] of cases){
    assert.deepEqual(fieldsFor(sport,label,key),expected,`${sport} ${label}`);
    assert.deepEqual(marketContract({sport,market:label,providerMarketKey:key})?.fields,expected,`${sport} ${key}`);
  }
});

test('live NFL source aliases map only to statistics the public log can measure', () => {
  const cases=[
    ['player_rec_targets','Rec Targets',['ReceivingTargets']],
    ['player_longest_reception','Longest Reception',['ReceivingLongest']],
    ['player_longest_rush','Longest Rush',['RushingLongest']],
    ['player_longest_completion','Longest Completion',['PassingLongestCompletion']],
    ['player_tackles_ast','Tackles+Ast',['TotalTackles']],
    ['player_int','INT',['PassingInterceptions']],
    ['player_fg_made','FG Made',['FieldGoalsMade']],
    ['player_completion_percentage','Completion Percentage',['CompletionPercentage']],
    ['player_rush_yards_per_carry','Rush Yards Per Carry',['RushingYardsPerCarry']],
    ['player_rush_rec_yds','Rush+Rec Yds',['RushingYards','ReceivingYards']],
    ['player_pass_rush_yds','Pass+Rush Yds',['PassingYards','RushingYards']],
  ];
  for(const [key,label,expected] of cases){
    assert.deepEqual(marketContract({sport:'NFL',market:label,providerMarketKey:key})?.fields,expected,label);
  }
});

test('derived football rates use measured numerators and denominators and fail closed at zero attempts', () => {
  const mapped=normalizeStatColumns({passingAttempts:40,completions:30,rushingAttempts:8,rushingYards:44},{sport:'NFL'});
  assert.equal(mapped.CompletionPercentage,75);
  assert.equal(mapped.RushingYardsPerCarry,5.5);
  assert.equal(statValue({passingAttempts:40,completions:30},{sport:'NFL',fields:['CompletionPercentage']}),75);
  assert.equal(statValue({rushingAttempts:8,rushingYards:44},{sport:'NFL',fields:['RushingYardsPerCarry']}),5.5);
  assert.equal(statValue({passingAttempts:0,completions:0},{sport:'NFL',fields:['CompletionPercentage']}),null);
  assert.equal(statValue({rushingAttempts:0,rushingYards:0},{sport:'NFL',fields:['RushingYardsPerCarry']}),null);
});

test('safe fallback ids can use their exact label but mismatched provider ids still fail closed', () => {
  assert.deepEqual(marketContract({sport:'NBA',providerMarketKey:'player_pts_asts',market:'Pts+Asts'})?.fields,['Points','Assists']);
  assert.equal(marketContract({sport:'NBA',providerMarketKey:'player_points_q1',market:'Points'}),null);
  assert.equal(marketContract({sport:'NFL',providerMarketKey:'player_tds_over',market:'Passing TDs'}),null);
  assert.equal(marketContract({sport:'NFL',providerMarketKey:'player_totally_unknown',market:'Pass Yards'}),null);
});

test('soccer core labels still resolve while fantasy formulas remain unsupported', () => {
  assert.deepEqual(marketContract({sport:'EPL',market:'Shots',providerMarketKey:'player_shots'})?.fields,['Shots']);
  assert.deepEqual(marketContract({sport:'EPL',market:'Shots On Target',providerMarketKey:'player_shots_on_target'})?.fields,['ShotsOnTarget']);
  assert.deepEqual(marketContract({sport:'SOCCER',market:'Goalie Saves',providerMarketKey:'player_goalie_saves'})?.fields,['Saves']);
  assert.equal(marketContract({sport:'EPL',market:'Outfield Fantasy Score',providerMarketKey:'player_outfield_fantasy_score'}),null);
  assert.equal(marketContract({sport:'EPL',market:'Goalie Fantasy Score',providerMarketKey:'player_goalie_fantasy_score'}),null);
});

// Every soccer game log ESPN serves carries the same nine columns, and passes,
// tackles, clearances, dribbles and crosses are not among them at any league.
// Refusing these here is what keeps three round trips from being spent to
// discover an emptiness that was knowable before the first one.
test('soccer markets the game log cannot report are refused without a request', () => {
  for (const [market, key] of [['Passes Attempted','player_passes_attempted'],['Passes Completed','player_passes_completed'],
    ['Tackles','player_tackles'],['Clearances','player_clearances'],['Attempted Dribbles','player_attempted_dribbles'],
    ['Crosses','player_crosses'],['Shots Assisted','player_shots_assisted']]) {
    for (const sport of ['SOCCER','EPL','MLS','UCL']) {
      assert.equal(marketContract({sport,market,providerMarketKey:key}), null, `${sport} ${market} is not in any soccer game log`);
    }
  }
});

test('research UI patch exposes tennis and customer-safe line-only states without changing the checked-in UI', () => {
  const source=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
  const patched=patchResearchUi(source);
  // Soccer and tennis must reach the board. The list is allowed to grow past
  // them, so this no longer pins the end of the array.
  const sports = (patched.match(/var SPORTS=\[([^\]]*)\]/) || [])[1] || '';
  assert.ok(sports.includes("'SOCCER'"), 'SOCCER missing from the served sport list');
  assert.ok(sports.includes("'TENNIS'"), 'TENNIS missing from the served sport list');
  assert.match(patched,/Combo line available/);
  assert.match(patched,/Fantasy line available/);
  assert.match(patched,/research\?\.lineOnly/);
  assert.match(patched,/base\.lineOnly\?'':'<button/);
  assert.match(patched,/lineOnlyPolicy\(g\)\|\|research\?\.lineOnly/);
  assert.throws(()=>patchResearchUi(patched),/could not locate sport list/);
});
