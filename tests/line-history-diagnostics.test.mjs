import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeLineHistory,formatLineHistoryReport,seriesKey} from '../lib/diagnostics/line-history.mjs';

const NOW=Date.parse('2026-09-15T12:00:00.000Z');
const HOUR=3_600_000, DAY=24*HOUR;
const at=ms=>new Date(ms).toISOString();

function snap(prop,book,side,ms){return {prop_id:prop,bookmaker_key:book,side,line:24.5,price:-110,created_at:at(ms)};}

test('a series is one prop at one book on one side',()=>{
 assert.equal(seriesKey({prop_id:'p1',bookmaker_key:'dk',side:'OVER'}),'p1|dk|OVER');
 assert.notEqual(seriesKey({prop_id:'p1',bookmaker_key:'dk',side:'OVER'}),seriesKey({prop_id:'p1',bookmaker_key:'dk',side:'UNDER'}));
});

test('the burst failure is caught: many rows, every series seen once, zero span',()=>{
 // The shape this project actually shipped once - 1,274 rows written in a
 // single pass, longest_tracked_span 00:00:00, 1.02 snapshots per series.
 const rows=Array.from({length:1274},(_,i)=>snap(`p${i}`,'dk','OVER',NOW-HOUR));
 const report=analyzeLineHistory(rows,{now:NOW});
 assert.equal(report.ok,false);
 assert.equal(report.rows,1274);
 assert.equal(report.trackedSeries,0);
 assert.equal(report.longestSpanMs,0);
 assert.match(report.failures.join(' '),/one snapshot/);
 assert.equal(report.provenForWindow,false);
});

test('a row count alone never passes the check',()=>{
 const many=Array.from({length:50_000},(_,i)=>snap(`p${i}`,'dk','OVER',NOW-2*HOUR));
 assert.equal(analyzeLineHistory(many,{now:NOW}).ok,false);
});

test('a genuinely tracked series passes',()=>{
 const rows=[];
 for(let h=12;h>=1;h--) rows.push(snap('p1','dk','OVER',NOW-h*HOUR));
 const report=analyzeLineHistory(rows,{now:NOW});
 assert.equal(report.ok,true,report.failures.join('; '));
 assert.equal(report.series,1);
 assert.equal(report.trackedSeries,1);
 assert.equal(report.maxSnapshotsPerSeries,12);
 assert.ok(report.longestSpanHours>=11);
});

test('history that stopped is failing even when the span is long',()=>{
 // Eight hours of good history that ended two days ago is a stopped writer.
 const rows=[];
 for(let h=0;h<8;h++) rows.push(snap('p1','dk','OVER',NOW-2*DAY-h*HOUR));
 const report=analyzeLineHistory(rows,{now:NOW});
 assert.equal(report.ok,false);
 assert.match(report.failures.join(' '),/more than 6 hours old/);
});

test('the week-long claim is only earned once observations span the week',()=>{
 const oneDay=[];
 for(let h=0;h<12;h++) oneDay.push(snap('p1','dk','OVER',NOW-h*HOUR));
 assert.equal(analyzeLineHistory(oneDay,{now:NOW,windowDays:7}).provenForWindow,false);

 const week=[];
 for(let d=0;d<7;d++) for(let h=0;h<4;h++) week.push(snap('p1','dk','OVER',NOW-d*DAY-h*HOUR));
 const report=analyzeLineHistory(week,{now:NOW,windowDays:7});
 assert.equal(report.ok,true,report.failures.join('; '));
 assert.equal(report.daysCovered,7);
 assert.equal(report.provenForWindow,true);
});

test('per-day buckets show which day writing stopped',()=>{
 const rows=[];
 for(const d of [4,3,2]) for(let h=0;h<3;h++) rows.push(snap('p1','dk','OVER',NOW-d*DAY-h*HOUR));
 const report=analyzeLineHistory(rows,{now:NOW});
 assert.equal(Object.keys(report.perDay).length,3);
 assert.equal(report.daysCovered,3);
});

test('rows with an unusable timestamp are excluded, never treated as epoch 0',()=>{
 const rows=[snap('p1','dk','OVER',NOW-2*HOUR),{prop_id:'p1',bookmaker_key:'dk',side:'OVER',created_at:null},
             {prop_id:'p1',bookmaker_key:'dk',side:'OVER',created_at:'not-a-date'}];
 const report=analyzeLineHistory(rows,{now:NOW});
 assert.equal(report.rows,1);
 assert.equal(report.rowsIgnored,2);
 // A null date coerced to 0 would invent a 56-year span.
 assert.ok(report.longestSpanHours<1);
});

test('provider_updated_at is never used as the time axis',()=>{
 const rows=[{prop_id:'p1',bookmaker_key:'dk',side:'OVER',created_at:at(NOW-HOUR),provider_updated_at:null},
             {prop_id:'p1',bookmaker_key:'dk',side:'OVER',created_at:at(NOW-2*HOUR),provider_updated_at:null}];
 const report=analyzeLineHistory(rows,{now:NOW});
 assert.equal(report.rows,2);
 assert.ok(report.longestSpanHours>=0.9);
});

test('an empty table fails with a plain reason rather than a crash',()=>{
 const report=analyzeLineHistory([],{now:NOW});
 assert.equal(report.ok,false);
 assert.equal(report.rows,0);
 assert.match(report.failures.join(' '),/no snapshots/);
 assert.equal(report.medianSnapshotsPerSeries,null);
});

test('malformed input does not throw',()=>{
 for(const input of [null,undefined,'nonsense',42,{}]) {
  const report=analyzeLineHistory(input,{now:NOW});
  assert.equal(report.ok,false);
 }
});

test('the formatted report states the verdict and the reasons',()=>{
 const text=formatLineHistoryReport(analyzeLineHistory([snap('p1','dk','OVER',NOW-9*DAY)],{now:NOW}));
 assert.match(text,/FAILING/);
 assert.match(text,/failing because:/);
 assert.match(text,/week-long claim earned: not yet/);
});
