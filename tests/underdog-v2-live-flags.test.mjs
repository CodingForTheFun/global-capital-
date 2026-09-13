import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnderdog, normalizedFeedBoard } from '../lib/ingestion/normalize.mjs';

const start='2026-09-14T20:00:00.000Z';
function payload(liveEvent=false){
  return {
    _autoscout_v2:true,
    players:[{id:'p1',full_name:'Fixture Player',sport_id:'NBA',team:'BOS',active:true,live_event:false}],
    appearances:[{id:'a1',player_id:'p1',match_id:'g1',team_id:'t1'}],
    games:[{id:'g1',sport_id:'NBA',scheduled_at:start,home_team_id:'t1',away_team_id:'t2'}],
    teams:[{id:'t1',abbr:'BOS'},{id:'t2',abbr:'NYK'}],
    over_under_lines:[{
      id:'l1',active:true,is_live:false,live_event:liveEvent,stat_value:31.5,updated_at:'2026-09-13T19:00:00.000Z',
      over_under:{live_event:false,appearance_stat:{appearance_id:'a1',stat:'Points',display_stat:'Points'}},
      options:[{choice:'higher',live_event:false},{choice:'lower',live_event:false}],
    }],
  };
}

test('Underdog v2 false live_event flags do not discard pregame props',()=>{
  const rows=normalizeUnderdog(payload(false));
  assert.equal(rows.length,1);
  assert.equal(rows[0].sport,'NBA');
  assert.equal(rows[0].line,31.5);
  assert.deepEqual(rows[0].sides,['OVER','UNDER']);
  const board=normalizedFeedBoard(rows);
  assert.equal(board.props.length,2);
  assert.equal(board.props[0].sportsbookKey,'underdog');
});

test('Underdog v2 true live_event remains excluded from pregame board',()=>{
  assert.equal(normalizeUnderdog(payload(true)).length,0);
});
