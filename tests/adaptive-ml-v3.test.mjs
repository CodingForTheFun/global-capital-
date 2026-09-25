import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptivePrediction, ADAPTIVE_SPORTS, ADAPTIVE_VERSION, cleanAdaptiveHistory,
  adaptiveFeatures, fitAdaptiveHistory} from '../lib/ml/adaptive.mjs';

// Synthetic deterministic software fixtures; NEVER evidence of live accuracy.
const NOW = Date.parse('2026-09-25T15:00:00Z');
const START = Date.parse('2026-01-01T00:00:00Z');
const target = (sport = 'MLB', line = 4.5) => ({sport, eventId:'current', playerId:'fixture-player',
  playerName:'Synthetic test fixture', marketId:'fixture_stat', sportsbookKey:'fixture_book',
  line, gameStartTime:'2026-09-26T00:00:00Z', entityType:'player', live:false, isAlternate:false});
const logs = (n = 30) => Array.from({length:n}, (_, i) => ({gameId:`g${i}`,
  date:new Date(START + i * 2 * 86400000).toISOString(), value:2 + i % 7,
  opponent:i % 3 ? 'BBB' : 'AAA', opponentId:i % 3 ? 'b' : 'a', isHome:i % 2 === 0, season:'2026'}));
const research = (gameLog = logs()) => ({available:true, gameLog, opponent:'AAA', opponentId:'a', isHome:true, season:'2026',
  matchup:{eventId:'current', opponent:'AAA', opponentId:'a', isHome:true}});
const fit = (gameLog = logs(), overrides = {}) => fitAdaptiveHistory({research:research(gameLog), target:target(), now:NOW, ...overrides});

test('every supported sport withholds uncalibrated probabilities and model EV', () => {
  for (const sport of ADAPTIVE_SPORTS) {
    const p = adaptivePrediction({research:research(), target:target(sport), now:NOW});
    assert.equal(p.available, false, sport); assert.equal(p.code,'MODEL_WITHHELD');
    assert.equal(p.modelVersion, ADAPTIVE_VERSION); assert.equal(p.probabilityAvailable,false);
    assert.equal(p.projection,null);
    for (const field of ['probabilityOver','probabilityUnder','probabilityPush']) assert.equal(p[field],null);
    assert.equal(p.validation.probabilityCalibrated,false);
    assert.equal(p.validation.probabilityObservations,0);
    assert.equal(p.validation.evaluatesDisplayedAlgorithm,true);
  }
});

test('null/blank/boolean/nonfinite values cannot become zero, genuine zeros survive', () => {
  const bad = [null,undefined,'',' ',false,true,NaN,Infinity,'NaN','Infinity','0x10'];
  const rows = bad.map((value,i) => ({...logs(1)[0],gameId:`bad${i}`,value}));
  const cleaned = cleanAdaptiveHistory([...rows, {...logs(1)[0],gameId:'zero',value:0},
    {...logs(1)[0],gameId:'string-zero',value:'0'}, {...logs(1)[0],gameId:'negative',value:-1}],target(),NOW);
  assert.deepEqual(cleaned.map(r=>r.value).sort((a,b)=>a-b),[-1,0,0]);
});

test('future, target-event, nonfinal and not-yet-available records are excluded', () => {
  const r=logs(1)[0];
  const extras=[{...r,gameId:'future',date:'2026-10-01T00:00:00Z'},
    {...r,gameId:'current'},{...r,gameId:'x',eventId:'current'},
    {...r,gameId:'live',status:'in_progress'},{...r,gameId:'void',status:'cancelled'},
    {...r,gameId:'unverified',verified:false},{...r,gameId:'incomplete',completed:false},
    {...r,gameId:'unknown-date',availableAt:'bad'},
    {...r,gameId:'late',availableAt:'2026-10-01T00:00:00Z'}];
  assert.equal(cleanAdaptiveHistory([r,...extras],target(),NOW).length,1);
  assert.deepEqual(fit(logs()),fit([...logs(),...extras]));
});

test('exact duplicates are idempotent and conflicting duplicate events fail closed', () => {
  const r=logs(1)[0];
  assert.equal(cleanAdaptiveHistory([r,{...r}],target(),NOW).length,1);
  assert.equal(cleanAdaptiveHistory([r,{...r,value:99}],target(),NOW).length,0);
  assert.equal(cleanAdaptiveHistory([r,{...r,isHome:!r.isHome}],target(),NOW).length,0);
});

test('shuffled logs do not change fitted output', () => assert.deepEqual(fit(logs()),fit(logs().reverse())));

test('H2H uses exact normalized identity, not substring/name similarity', () => {
  const clean=cleanAdaptiveHistory(logs(),target(),NOW);
  const a=adaptiveFeatures(clean,{opponent:'AAA',opponentId:'a'});
  assert.equal(a.evidence.h2h.games,10);
  const b=adaptiveFeatures(clean,{opponent:'AAA',opponentId:'different'});
  assert.equal(b.evidence.h2h.games,0);
  assert.equal(adaptiveFeatures(clean,{opponent:'AA'}).evidence.h2h.games,0);
});

test('one H2H game is counted but strongly shrunk; missing H2H stays unavailable', () => {
  const clean=cleanAdaptiveHistory(logs(9),target(),NOW).map((r,i)=>({...r,opponentId:i===0?'one':'other'}));
  const f=adaptiveFeatures(clean,{opponentId:'one'});
  assert.equal(f.evidence.h2h.games,1); assert.equal(f.evidence.h2h.shrinkage,1/9);
  const missing=adaptiveFeatures(clean,{opponentId:'absent'});
  assert.equal(missing.evidence.h2h.available,false); assert.equal(missing.evidence.h2h.average,null);
  assert.equal(missing.x[6],0);
});

test('H2H, home-away, season, L5/L10/L20 are included in fold feature construction', () => {
  const clean=cleanAdaptiveHistory(logs(),target(),NOW), f=adaptiveFeatures(clean,research());
  assert.equal(f.evidence.l5.games,5); assert.equal(f.evidence.l10.games,10); assert.equal(f.evidence.l20.games,20);
  assert.equal(f.evidence.h2h.games,10); assert.equal(f.evidence.homeAway.games,15); assert.equal(f.evidence.season.games,30);
  assert.equal(f.x.length,9);
  const none=adaptiveFeatures(clean.map(r=>({...r,season:null,isHome:null})),{});
  assert.equal(none.evidence.season.available,false); assert.equal(none.evidence.homeAway.available,false);
});

test('later outcomes cannot change earlier walk-forward predictions or strategy selection', () => {
  const original=logs(45), changed=original.map((r,i)=>i>=30?{...r,value:300+i}:r);
  const a=fit(original), b=fit(changed);
  assert.deepEqual(a.checks.filter(r=>r.ts<Date.parse(original[30].date)),b.checks.filter(r=>r.ts<Date.parse(original[30].date)));
});

test('RMSE is measured on the final contextual/selected forecasts, not raw ridge predictions', () => {
  const p=fit(logs(40));
  const mse=p.checks.reduce((s,r)=>s+(r.actual-r.pred)**2,0)/p.checks.length;
  assert.equal(p.validation.rmse,Math.sqrt(mse));
  assert.ok(p.checks.every(r=>r.residual===r.actual-r.pred));
});

test('current-line hits are descriptive, actual window sizes are retained and pushes excluded', () => {
  const gameLog=logs(12).map((r,i)=>({...r,value:i%3+3}));
  const p=fit(gameLog,{target:target('MLB',4)}), h=p.currentLineHistory;
  assert.equal(h.descriptiveOnly,true); assert.equal(h.l20.games,12);
  assert.equal(h.all.over,4); assert.equal(h.all.under,4); assert.equal(h.all.pushes,4);
  assert.equal(h.all.decided,8); assert.equal(h.all.overRate,.5);
  const allPush=fit(logs(12).map(r=>({...r,value:4})),{target:target('MLB',4)}).currentLineHistory.all;
  assert.equal(allPush.overRate,null); assert.equal(allPush.underRate,null);
});

test('history is bounded and live/invalid targets cannot get forecasts', () => {
  const many=Array.from({length:200},(_,i)=>({...logs(1)[0],gameId:`m${i}`,date:new Date(START+i*86400000).toISOString()}));
  assert.equal(cleanAdaptiveHistory(many,target(),NOW).length,120);
  assert.equal(adaptivePrediction({research:research(),target:{...target(),live:true},now:NOW}).code,'PREMATCH_ONLY');
  assert.equal(adaptivePrediction({research:research(),target:{...target(),line:null},now:NOW}).code,'TARGET_UNVERIFIED');
  assert.equal(adaptivePrediction({research:{...research(),matchup:{eventId:'wrong'}},target:target(),now:NOW}).code,'TARGET_UNVERIFIED');
  assert.equal(fit(logs(8)),null);
});

test('null matchup metadata is unavailable evidence, not a feed exception', () => {
  const p=adaptivePrediction({research:{...research(),matchup:null},target:target(),now:NOW});
  assert.equal(p.code,'MODEL_WITHHELD');
});

test('delayed settlements are not used in earlier folds or strategy selection', () => {
  const a=logs(45);
  a[20]={...a[20],availableAt:a[30].date};
  const b=a.map((r,i)=>i===20?{...r,value:900}:r);
  const before=(p)=>p.checks.filter(r=>r.ts<Date.parse(a[30].date)&&r.ts>Date.parse(a[20].date));
  assert.deepEqual(before(fit(a)),before(fit(b)));
});
