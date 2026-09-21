// Synthetic regression tests against the actual /research route, never live data.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import ts from '../apps/oblige-web/node_modules/typescript/lib/typescript.js';
const src=ts.transpileModule(readFileSync(new URL('../apps/oblige-web/tests/fixtures/mockPlayerData.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {mockPlayerData,mockDvpData,mockOddsData}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const output='artifacts/player-analysis';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),report=[];
try{for(const width of [390,1440])for(const sport of ['NBA','NFL','TENNIS']){
 const tennis=sport==='TENNIS',football=sport==='NFL',player='Analysis QA Player';
 const markets=tennis?[['Aces',7.5],['Games Won',12.5]]:football?[['Passing Yards',245.5],['Rushing Yards',24.5]]:[['Points',24.5],['Rebounds',8.5]];
 const c=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await c.newPage(),errors=[];let historyCalls=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());let body={ok:true,available:false,message:'Optional fixture not published.'},status=200;
  if(u.pathname==='/api/account/me')body={authenticated:true,user:{id:'qa-player-analysis'}};
  if(u.pathname==='/api/apex/props')body={ok:true,props:markets.flatMap(([market,line])=>['OVER','UNDER'].map(side=>({id:`${market}-${side}`,eventId:'qa-event',playerName:player,market,line,side,price:-110,sportsbook:'DraftKings',sportsbookKey:'draftkings',team:'BOS',opponent:tennis?'Opponent A':'IND',homeTeam:'Indiana Pacers',awayTeam:'Boston Celtics',gameStartTime:'2090-09-21T19:00:00Z'}))),meta:{},supportedSports:[sport]};
  if(u.pathname==='/api/apex/research'){historyCalls++;const metric=u.searchParams.get('market');body={...mockPlayerData,gameLog:mockPlayerData.gameLog.map((g,i)=>tennis?{gameId:g.gameId,date:g.date,season:g.season,seasonType:2,opponent:i%4===0?'Opponent A':'Opponent B',aces:4+i%8,gamesWon:9+i%9,value:metric==='Aces'?4+i%8:9+i%9,gameResult:i%3?'W':'L'}:{...g,value:metric==='Rebounds'?g.rebounds:football?metric==='Passing Yards'?200+i*7:10+i*2:g.points}),matchup:{opponent:tennis?'Opponent A':'IND'}};}
  if(u.pathname==='/api/apex/research-defense-position')body=football?{...mockDvpData,positions:['QB','RB','WR','TE'],rows:mockDvpData.rows.map(r=>({...r,position:'QB',metric:r.metric==='assists'?'passingYards':'rushingYards',average:r.metric==='assists'?245.6:24.2})).filter((r,i)=>i%10<2)}:mockDvpData;
  if(u.pathname==='/api/apex/research-matchup')body=tennis?{available:false,message:'No published prediction for this tennis fixture.'}:mockOddsData;
  if(u.pathname==='/api/apex/player-artwork')status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:3100/research?'+new URLSearchParams({sport,player,market:markets[0][0],line:String(markets[0][1])}));
 await page.locator('.recharts-bar-rectangle').first().waitFor();
 await page.locator('.op-sample').filter({hasText:/^L5/}).click();assert.equal(await page.locator('.recharts-bar-rectangle').count(),5);
 const calls=historyCalls;await page.getByRole('button',{name:'Raise research line',exact:true}).click();assert.equal(Number(await page.locator('.op-line-number').textContent()),markets[0][1]+.5);assert.equal(historyCalls,calls);
 await page.locator('.op-sample').filter({hasText:/^H2H/}).click();assert.equal(await page.locator('.recharts-bar-rectangle').count(),5);
 await page.locator('.op-sample').filter({hasText:/^Season/}).click();assert.equal(await page.locator('.recharts-bar-rectangle').count(),20);
 await page.getByRole('button',{name:'View Full Research',exact:true}).click();
 const log=page.getByRole('region',{name:'Sortable game log; scroll for all statistics'});await log.waitFor();assert.equal(await log.locator('tbody tr').count(),15);
 await log.getByRole('button',{name:'Date',exact:true}).click();assert.equal(await log.locator('th').first().getAttribute('aria-sort'),'ascending');
 if(tennis){assert.equal(await page.getByRole('combobox',{name:'Home / Away',exact:true}).count(),0);await page.getByRole('heading',{name:'Opponent matchup',exact:true}).waitFor();assert.equal(await page.getByLabel('Defense team').count(),0);assert.equal(await page.getByRole('heading',{name:'Lineups & depth chart',exact:true}).count(),0);assert.ok((await log.innerText()).includes('Aces'));assert.ok(!(await log.innerText()).includes('PTS'));}
 else {await page.getByLabel('Defense team').selectOption('11');await page.getByRole('group',{name:'Opponent position'}).getByRole('button',{name:football?'QB':'C',exact:true}).click();assert.ok((await page.getByRole('region',{name:'Defense vs position',exact:true}).innerText()).includes('26th / 30'));}
 await page.getByLabel('Player stat category',{exact:true}).selectOption({label:markets[1][0]});await page.waitForFunction(line=>Number(document.querySelector('.op-line-number')?.textContent)===line,markets[1][1]);await page.locator('.recharts-bar-rectangle').first().waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');assert.deepEqual(errors,[]);
 await page.screenshot({path:`${output}/${sport}-${width}.png`,fullPage:true});report.push({sport,width,passed:true});await c.close();
}}finally{await browser.close();await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
