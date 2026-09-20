import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './load-lib.mjs';
import { BOARD_SPORTS } from '../../../lib/autoscout/models.mjs';
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
 assert.equal(researchPlayerName('Test Player (MIN)',{...context,sport:'NBA',team:'Minnesota Vikings'}),'Test Player (MIN)');
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

test('opposing namesakes without provider IDs retain separate quote groups',()=>{
 const groups=groupProps([row({providerPlayerId:null,playerName:'Alex Smith (PIT)'}),row({providerPlayerId:null,playerName:'Alex Smith (NE)',team:'NE'})],'NFL');
 assert.equal(groups.length,2);assert.equal(groupPlayerCards(groups).length,2);
 assert.deepEqual(groups.map(group=>group.quotes[0].playerName),['Alex Smith (PIT)','Alex Smith (NE)']);
});

test('every supported board sport uses shared identity, category, and exact-book grouping',()=>{
 for(const sport of BOARD_SPORTS){
  const base=row({sport,playerName:'Fixture Athlete',providerPlayerId:null});
  const tagged={...base,playerName:'Fixture Athlete (PIT)',eventId:'second-book',sportsbook:'FanDuel',sportsbookKey:'fanduel'};
  const groups=groupProps([base,tagged,{...base,market:'Second stat',marketId:'second_stat'}],sport);
  const cards=collapsePlayerCards(groups,groups);
  assert.equal(cards.length,1,`${sport}: one player/game`);assert.equal(cards[0].categoryCount,2,`${sport}: categories retained`);assert.equal(cards[0].bookCount,2,`${sport}: books retained`);
  assert.equal(groups[1].player,'Fixture Athlete',`${sport}: explicit matching team code`);
  const other={...tagged,playerName:'Fixture Athlete (NE)',team:'NE',eventId:'opposing-player'};
  assert.equal(groupPlayerCards(groupProps([base,other],sport)).length,2,`${sport}: opposing namesakes distinct`);
 }
});

test('full team names verify provider tags within the actual league',()=>{
 for(const [sport,player,tag,team,opponent] of [['MLB','Agustin Ramirez','MIA','Miami Marlins','San Diego Padres'],['MLB','Alec Burleson','STL','St. Louis Cardinals','Washington Nationals'],['NBA','Fixture Athlete','BOS','Boston Celtics','Los Angeles Lakers'],['WNBA','Fixture Athlete','MIN','Minnesota Lynx','Seattle Storm'],['NHL','Fixture Athlete','BOS','Boston Bruins','New York Rangers']]){
  const base=row({sport,playerName:player,providerPlayerId:null,team,homeTeam:team,awayTeam:opponent});
  const decorated={...base,eventId:'other-book',playerName:`${player} (${tag})`,team:null};
  const groups=groupProps([base,decorated],sport);
  assert.equal(groups[1].player,player,`${sport}: full matchup verifies tag`);assert.equal(groupPlayerCards(groups).length,1);
 }
 assert.equal(researchPlayerName('Fixture Athlete (BOS)',{sport:'MLB',homeTeam:'Boston Celtics',awayTeam:'Los Angeles Lakers'}),'Fixture Athlete (BOS)','another league cannot supply identity evidence');
});
