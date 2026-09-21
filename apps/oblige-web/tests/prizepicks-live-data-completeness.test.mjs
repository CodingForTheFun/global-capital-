import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { loadLib } from './load-lib.mjs';
const {groupProps,fetchResearch}=await loadLib('api');

test('PrizePicks fantasy line keeps source-qualified market identity and player role',()=>{
  const rows=[
    {id:'pp-over',eventId:'game-1',providerPlayerId:'pp-player-1',playerName:'Fixture Hitter',market:'Fantasy Points',marketId:'prizepicks:player_hitter_fantasy_score',line:6.5,side:'OVER',sportsbook:'PrizePicks',sportsbookKey:'prizepicks',position:'OF',gameStartTime:'2030-09-20T00:20:00Z'},
    {id:'pp-under',eventId:'game-1',providerPlayerId:'pp-player-1',playerName:'Fixture Hitter',market:'Fantasy Points',marketId:'prizepicks:player_hitter_fantasy_score',line:6.5,side:'UNDER',sportsbook:'PrizePicks',sportsbookKey:'prizepicks',position:'OF',gameStartTime:'2030-09-20T00:20:00Z'},
  ];
  const groups=groupProps(rows,'MLB');
  assert.equal(groups.length,1);
  assert.equal(groups[0].line,6.5);
  assert.equal(groups[0].marketId,'prizepicks:player_hitter_fantasy_score');
  assert.equal(groups[0].position,'OF');
  assert.deepEqual(new Set(groups[0].quotes.map(row=>row.side)),new Set(['OVER','UNDER']));
});

test('research request forwards PrizePicks market identity and player role',async()=>{
  const oldFetch=globalThis.fetch;
  let requested='';
  globalThis.fetch=async input=>{
    requested=String(input);
    return new Response(JSON.stringify({ok:true,available:false,gameLog:[]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const group={
      key:'fixture',propId:'pp-over',player:'Fixture Hitter',providerPlayerId:'pp-player-1',
      market:'Fantasy Points',marketId:'prizepicks:player_hitter_fantasy_score',line:6.5,sport:'MLB',
      team:'ATL',position:'OF',opponent:null,homeTeam:'ATL',awayTeam:'NYM',matchup:'NYM @ ATL',
      startsAt:'2030-09-20T00:20:00Z',live:false,quotes:[],bestOver:null,bestUnder:null,
    };
    await fetchResearch(group,'OVER');
    const url=new URL(requested,'https://example.test');
    assert.equal(url.searchParams.get('marketId'),'prizepicks:player_hitter_fantasy_score');
    assert.equal(url.searchParams.get('position'),'OF');
    assert.equal(url.searchParams.get('line'),'6.5');
  } finally {
    globalThis.fetch=oldFetch;
  }
});

test('fantasy research uses the selected book even with an unqualified or stale parent market',async()=>{
  const oldFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async input=>{
    requests.push(new URL(String(input),'https://example.test').searchParams.get('marketId'));
    return Response.json({ok:true,available:false,gameLog:[]});
  };
  try {
    for(const [index,book] of ['prizepicks','underdog'].entries()) {
      const group={key:`source-fixture-${index}`,sport:'WNBA',player:'Formula Fixture',market:'Fantasy Score',marketId:index?'prizepicks:player_fantasy_score':'player_fantasy_score',line:19.5,quotes:[{sportsbookKey:book,side:'OVER',line:19.5}],bestOver:null,bestUnder:null};
      await fetchResearch(group,'OVER');
    }
    assert.deepEqual(requests,['prizepicks:player_fantasy_score','underdog:player_fantasy_score']);
  } finally { globalThis.fetch=oldFetch; }
});
