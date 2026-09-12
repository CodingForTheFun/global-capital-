/** Local fixture browser QA. Never serves or deploys these synthetic test quotes. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {normalizePublicGameLog} from '../lib/data-sources/espn/research.mjs';
import {finalizeResearch} from '../lib/autoscout/research-service.mjs';
import {normalizeTeamGame} from '../lib/data-sources/espn/team-research.mjs';
const f=JSON.parse(fs.readFileSync('./tests/fixtures/espn-pipeline-extras.json'));
const sets=[
 ['love','Jordan Love',['player_sacks','player_pass_yds','player_pass_attempts','player_pass_completions','player_pass_tds','player_pass_interceptions','player_rush_yds','player_rush_attempts','player_rush_tds','player_pass_rush_yds']],
 ['defense','Micah Parsons',['player_sacks','player_tackles_assists','player_solo_tackles','player_assists']],
 ['kicking','Brandon McManus',['player_field_goals','player_kicking_points','player_pats']],
 ['team','Green Bay Packers Defense',['team_sacks','team_sacks_allowed','team_points_allowed']],
 ['none','No Logs Test Fixture',['player_pass_yds']]
];
const props=[],research={};let i=0;
for(const [src,name,markets] of sets)for(const marketId of markets){
 const id=String(++i),team=src==='defense'?'GB':'GB',entityType=src==='team'?'team':'player';
 const market=marketId.replace(/^(player|team)_/,'').replaceAll('_',' ');
 const line=marketId==='player_sacks'?2.5:marketId.includes('yds')?200.5:marketId.includes('points')?5.5:2.5;
 const base={id,eventId:'qa-local-game',playerId:name,playerName:name,sport:'NFL',marketId,market,entityType,team,homeTeam:'Minnesota Vikings',awayTeam:'Green Bay Packers',gameStartTime:'2026-09-13T20:25:00Z',sportsbookKey:'prizepicks',sportsbook:'PrizePicks',line,price:-137,side:'OVER',isAlternate:false};
 props.push(base,{...base,id:id+'u',side:'UNDER'});
 let gameLog=src==='none'?[]:src==='team'?[normalizeTeamGame(f.team,{teamId:'9',eventId:'401772968',field:marketId==='team_sacks'?'TeamDefensiveSacks':marketId==='team_sacks_allowed'?'TeamSacksAllowed':'TeamPointsAllowed'})]:normalizePublicGameLog(f[src],{sport:'NFL',providerMarketKey:marketId});
 const r=src==='none'?{ok:true,available:false,code:'NO_GAME_LOG_DATA',message:'No completed game logs are available for this player.',gameLog:[]}:
 {...finalizeResearch({gameLog,player:{playerName:name,sport:'NFL',team},sport:'NFL',market,line,side:'OVER',opponent:'MIN',opponentId:'NFL:16',season:'2026',coverage:{seasonComplete:false}}),
  marketDisplayName:marketId==='player_sacks'?(src==='love'?'Sacks taken':'Defensive sacks'):null};
 research[name+'|'+marketId]=r;
}
const nba=JSON.parse(fs.readFileSync('./tests/fixtures/espn-nba-gamelog.json'));
const NBAprops=[{id:'nba1',eventId:'nbaevent',playerId:'tatum',playerName:'Jayson Tatum',sport:'NBA',team:'BOS',marketId:'player_points',market:'Points',homeTeam:'Boston Celtics',awayTeam:'New York Knicks',gameStartTime:'2026-09-13T20:25:00Z',sportsbookKey:'prizepicks',sportsbook:'PrizePicks',line:26.5,price:-137,side:'OVER'}];
research['Jayson Tatum|player_points']=finalizeResearch({gameLog:normalizePublicGameLog(nba,{sport:'NBA',providerMarketKey:'player_points'}),sport:'NBA',player:{playerName:'Jayson Tatum',sport:'NBA'},line:26.5,side:'OVER',season:'2026',coverage:{seasonComplete:false}});

const DATA={boards:{NFL:{props,data:{players:[],lines:[]},meta:{}},NBA:{props:NBAprops,data:{players:[],lines:[]},meta:{}}},research};
const calls=[];let failNext=false;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=url.pathname,q=url.searchParams;
 const send=(value,status=200,type='application/json')=>{res.writeHead(status,{'content-type':type});res.end(Buffer.isBuffer(value)?value:JSON.stringify(value));};
 if(p==='/')return send(Buffer.from('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script src="/ui.js"></script></body></html>'),200,'text/html');
 const file=p==='/ui.js'?'apex-v2/scout-ui-v5.js':p==='/assets/autoscout-research.css'?'apex-v2/research-ui.css':p.startsWith('/assets/lib/')?p.slice(8):null;
 if(file&&fs.existsSync(file))return send(fs.readFileSync(file),200,file.endsWith('.css')?'text/css':'application/javascript');
 if(p==='/api/apex/props')return send(DATA.boards[q.get('sport')]||{props:[],data:{},meta:{}});
 if(p==='/api/apex/research-batch'){
  let raw='';for await(const chunk of req)raw+=chunk;
  const input=JSON.parse(raw);calls.push(input);
  await new Promise(resolve=>setTimeout(resolve,700));
  if(failNext){failNext=false;return send({ok:false},503);}
  return send({ok:true,results:Object.fromEntries(input.props.map(v=>[v.key,DATA.research[v.playerName+'|'+v.marketId]||{available:false,code:'NO_GAME_LOG_DATA'}]))});
 }
 if(p==='/api/apex/research')return send(DATA.research[q.get('playerName')+'|'+q.get('marketId')]||{available:false,code:'NO_GAME_LOG_DATA'});
 if(p==='/api/saved-props')return send({saved:[],profile:{kind:'account',id:'local-qa-only'}});
 if(p==='/api/account/me')return send({authenticated:true,user:{email:'local-test@example.invalid'}});
 if(p==='/api/account/health')return send({ok:true,password:{available:true}});
 if(p==='/api/apex/player-artwork')return send(Buffer.from(''),200,'image/png');
 if(p.startsWith('/api/'))return send({ok:true});
 return send({},404);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const report={kind:'fixture browser QA, not a production login or actual sportsbook quotes',checks:[]};
await fs.promises.mkdir('validation-output',{recursive:true});
try{
 for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForSelector('.asCard');
  const skeletons=await page.locator('.asStatSkeleton').count();assert.ok(skeletons>=8);
  await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');
  const ready=await page.locator('.asResearchState.ready').count();assert.ok(ready>=18);
  assert.equal(await page.locator('.asCard').count(),20);assert.ok(calls.every(c=>c.props.length<=4));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
  await page.screenshot({path:`validation-output/${label}.png`,fullPage:true});
  await page.locator('#asSearch').fill('Jordan Love');await page.waitForTimeout(350);
  // Filtering can reveal the one group initially on page two; it must hydrate
  // without clicking the optional retry button.
  await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');
  const card=page.locator('.asCard').filter({hasText:'Sacks taken'}).first();await card.click();
  await page.waitForSelector('#asLinePlus');
  const before=await page.locator('[data-window="l5"] b').textContent();
  for(let i=0;i<6;i++)await page.locator('#asLinePlus').click();
  const high=await page.locator('[data-window="l5"] b').textContent();
  await page.locator('[data-side="UNDER"]').click();
  const under=await page.locator('[data-window="l5"] b').textContent();assert.notEqual(high,under);
  assert.equal(await page.locator('[data-window="season"] b').textContent(),'N/A');
  assert.ok(!(await page.locator('#asDrawerBody').textContent()).includes('Pushes are excluded'));
  await page.keyboard.press('Escape');await page.locator('#asSearch').fill('No Logs Test Fixture');await page.waitForTimeout(1200);
  const noLogs=await page.locator('.asCard .asBadges').textContent();assert.ok(noLogs.includes('N/A'));assert.ok(!noLogs.includes('—'));
  await page.locator('#asSearch').fill('');await page.waitForTimeout(350);
  await page.locator('#asNext').click();await page.waitForTimeout(1000);assert.equal(await page.locator('.asCard').count(),1);
  await page.reload();await page.waitForSelector('.asCard');await page.locator('[data-sport="NBA"]').click();
  await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');
  assert.ok((await page.locator('#asList').textContent()).includes('Jayson Tatum'));
  assert.ok(!(await page.locator('#asList').textContent()).includes('Jordan Love'));
  assert.deepEqual(errors,[]);
  report.checks.push({viewport:label,skeletons,readyCards:ready,batchMax:4,automaticHydration:true,lineBefore:before,lineIncreased:high,underToggled:under,noOverflow:true,noLogsNA:true,seasonNA:true,pagination:true,sportSwitchRace:true,pageErrors:errors});
  await context.close();
 }
 // A failed batch must stop animating and permit an explicit retry.
 const page=await browser.newPage();failNext=true;await page.goto(origin);await page.waitForSelector('.asCard');
 await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Retry research');
 assert.equal(await page.locator('.asStatSkeleton').count(),0);await page.locator('#asResearchBatch').click();
 await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');
 report.failedBatchRetry=true;console.log(JSON.stringify(report,null,2));
 await fs.promises.writeFile('validation-output/browser.json',JSON.stringify(report,null,2));
}catch(error){
 await fs.promises.writeFile('validation-output/browser-failure.txt',String(error.stack));
 for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:'validation-output/browser-failure.png',fullPage:true}).catch(()=>{});
 throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
