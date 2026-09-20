import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './load-lib.mjs';
const { researchPlayerName } = await loadLib('player-identity');
const { groupProps, fetchResearch } = await loadLib('api');
const { groupPlayerCards, collapsePlayerCards, isSavedCard } = await loadLib('player-cards');
const { predictionTarget } = await loadLib('model-data');
const context = {sport:'NFL',team:'PIT',homeTeam:'NE Patriots',awayTeam:'PIT Steelers'};
const row = extra => ({...context,playerName:'Aaron Rodgers (PIT)',providerPlayerId:'native-rodgers',eventId:'native-game',market:'Rushing Yards',marketId:'player_rush_yds',line:.5,side:'OVER',price:-107,sportsbook:'DraftKings',sportsbookKey:'draftkings',gameStartTime:'2050-09-20T17:00:00Z',proplineOutcomeId:'native-outcome',...extra});

test('verified NFL team decoration is removed without guessing ambiguous names',()=>{
 assert.equal(researchPlayerName('Aaron Rodgers (PIT)',context),'Aaron Rodgers');
 assert.equal(researchPlayerName('Aaron Jones (MIN)',{sport:'NFL',team:'Minnesota Vikings'}),'Aaron Jones');
 assert.equal(researchPlayerName('Aaron Rodgers (PIT)',{...context,team:'NE'}),'Aaron Rodgers (PIT)');
 for(const name of ['Aaron Rodgers (ABC)','Aaron Rodgers (Captain)','Aaron Rodgers + Drake Maye (PIT)'])assert.equal(researchPlayerName(name,context),name);
 assert.equal(researchPlayerName('Aaron Rodgers (PIT)',{sport:'NFL'}),'Aaron Rodgers (PIT)');
 assert.equal(researchPlayerName('Test Player (MIN)',{...context,sport:'NBA',team:'MIN'}),'Test Player (MIN)');
});

test('provider-tagged and plain names form one card, preserving raw quotes and old saved links',()=>{
 const tagged=row(),plain=row({playerName:'Aaron Rodgers',providerPlayerId:'other-provider',eventId:'other-event',homeTeam:'New England Patriots',awayTeam:'Pittsburgh Steelers'});
 const groups=groupProps([tagged,plain],'NFL'),cards=groupPlayerCards(groups);
 assert.equal(cards.length,1);assert.equal(cards[0].variants.length,2);
 assert.equal(groups[0].player,'Aaron Rodgers');assert.equal(groups[0].quotes[0],tagged);
 assert.equal(tagged.playerName,'Aaron Rodgers (PIT)');assert.equal(tagged.proplineOutcomeId,'native-outcome');
 const at=Date.parse(tagged.gameStartTime);
 for(const game of [['ne patriots','pit steelers'],['new england patriots','pittsburgh steelers']]){
  const oldKey=JSON.stringify([JSON.stringify(['nfl',...game,at]),'aaron rodgers (pit)']);
  assert.ok(cards[0].aliases.includes(oldKey));assert.ok(isSavedCard(collapsePlayerCards(groups,groups)[0],[oldKey]));
 }
 assert.equal(groupPlayerCards(groupProps([tagged,row({eventId:'next-game',gameStartTime:'2050-09-21T17:00:00Z'})],'NFL')).length,2);
});

test('history and prediction requests use clean names and unchanged native identity',async t=>{
 const [group]=groupProps([row()],'NFL');let params;
 t.mock.method(globalThis,'fetch',async path=>{params=new URL(path,'https://fixture.invalid').searchParams;return Response.json({available:true,gameLog:[]});});
 await fetchResearch(group,'OVER');
 assert.equal(params.get('playerName'),'Aaron Rodgers');assert.equal(params.get('providerPlayerId'),'native-rodgers');assert.equal(params.get('eventId'),'native-game');
 const {payload}=predictionTarget(group);assert.equal(payload.playerName,'Aaron Rodgers');assert.equal(payload.playerId,'native-rodgers');assert.equal(payload.line,.5);
});
