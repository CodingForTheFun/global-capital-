import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFliff } from '../lib/ingestion/fliff.mjs';
import { normalizeBovada } from '../lib/ingestion/bovada.mjs';
import { normalizePrizePicks, normalizedFeedBoard } from '../lib/ingestion/normalize.mjs';
import { calculatePropTrend } from '../lib/ingestion/trends.mjs';
import { zeroCreditConfig } from '../lib/ingestion/zero-credit-worker.mjs';
import { researchClient } from '../lib/ui/research-home.mjs';

test('zero-credit cadence is constrained to requested 2-4 minute window', () => {
  const prior=process.env.AUTOSCOUT_ZERO_CREDIT_POLL_MINUTES;
  process.env.AUTOSCOUT_ZERO_CREDIT_POLL_MINUTES='1'; assert.equal(zeroCreditConfig().pollMinutes,2);
  process.env.AUTOSCOUT_ZERO_CREDIT_POLL_MINUTES='9'; assert.equal(zeroCreditConfig().pollMinutes,4);
  process.env.AUTOSCOUT_ZERO_CREDIT_POLL_MINUTES='3'; assert.equal(zeroCreditConfig().pollMinutes,3);
  if(prior==null)delete process.env.AUTOSCOUT_ZERO_CREDIT_POLL_MINUTES;else process.env.AUTOSCOUT_ZERO_CREDIT_POLL_MINUTES=prior;
});

test('trend calculations use stored results and separate pushes', () => {
  const rows=[7,6,5,5,4,8,2,9,6,3].map((value,i)=>({value,date:`2026-09-${String(12-i).padStart(2,'0')}T00:00:00Z`,opponent:i<2?'NYK':'MIA'}));
  const trend=calculatePropTrend(rows,5,'OVER','NYK');
  assert.equal(trend.l5.games,5);
  assert.equal(trend.l5.decisions,3);
  assert.equal(trend.l5.hits,2);
  assert.equal(trend.l5.hitRate,67);
  assert.equal(trend.streak,2);
  assert.equal(trend.h2h.games,2);
  assert.equal(trend.overProbability,63);
  assert.equal(trend.underProbability,38);
});

test('Fliff adapter keeps explicit player O/U rows and no invented price beyond standard -110 fallback', () => {
  const rows=normalizeFliff([{id:'f1',playerName:'Sample Player',sport:'NBA',marketName:'Points',line:24.5,startTime:'2026-09-14T00:00:00Z',eventId:'e1',homeTeam:'BOS',awayTeam:'NYK'}]);
  assert.equal(rows.length,1); assert.equal(rows[0].line,24.5); assert.equal(rows[0].overOdds,-110); assert.equal(rows[0].underOdds,-110);
});

test('Bovada adapter ignores team markets and extracts explicit player over/under', () => {
  const payload=[{events:[{id:'e1',startTime:'2026-09-14T00:00:00Z',competitors:[{name:'BOS',home:true},{name:'NYK',home:false}],displayGroups:[{markets:[{id:'m1',description:'Sample Player - Points',outcomes:[{description:'Over',price:{handicap:24.5,american:-105}},{description:'Under',price:{handicap:24.5,american:-115}}]},{id:'m2',description:'Game Total',outcomes:[{description:'Over',price:{handicap:220.5}},{description:'Under',price:{handicap:220.5}}]}]}]}]}];
  const rows=normalizeBovada(payload,'basketball/nba');
  assert.equal(rows.length,1); assert.equal(rows[0].playerName,'Sample Player'); assert.equal(rows[0].overOdds,-105); assert.equal(rows[0].underOdds,-115);
});

test('PrizePicks promo variants are preserved as alternates and stay out of main-line active props', () => {
  const payload={data:[{type:'projection',id:'p1',attributes:{stat_type:'Points',line_score:19.5,odds_type:'goblin',start_time:'2026-09-14T00:00:00Z'},relationships:{player:{data:{type:'new_player',id:'a1'}},league:{data:{type:'league',id:'l1'}}}}],included:[{type:'new_player',id:'a1',attributes:{name:'Sample Player',team:'BOS',position:'G'}},{type:'league',id:'l1',attributes:{name:'NBA'}}]};
  const rows=normalizePrizePicks(payload); assert.equal(rows.length,1); assert.equal(rows[0].isAlternate,true); assert.equal(rows[0].promotion.type,'goblin');
  const board=normalizedFeedBoard(rows); assert.ok(board.props.every(r=>r.isAlternate)); assert.ok(board.active_props.every(r=>r.is_alternate));
});

test('presentation adapter creates shareable /props routes and removes legacy Game log labels', () => {
  const source=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
  const client=researchClient(source);
  assert.match(client,/\/props\//); assert.doesNotMatch(client,/Game log available/); assert.doesNotMatch(client,/section\('Game log'/);
  assert.match(client,/maybeOpenPropRoute/);
});

test('runtime bootstrap strips paid sports data credentials', () => {
  const source=readFileSync(new URL('../frontdoor-clearsports.mjs',import.meta.url),'utf8');
  for(const key of ['THE_ODDS_API_KEY','SPORTSDATAIO_API_KEY','SPORTSGAMEODDS_API_KEY','CLEARSPORTS_API_KEY']) assert.match(source,new RegExp(key));
  assert.match(source,/research-service-v3-zero/); assert.match(source,/startZeroCreditWorker/); assert.match(source,/local-sandbox/);
});
