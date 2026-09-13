// Integrated browser QA uses isolated accounts and explicit test-only network fixtures.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {sanitizePublicPayload} from '../lib/public-sanitize.mjs';
import {assertTacoPlacement} from './assert-taco-placement.mjs';
const base='http://127.0.0.1:3025',data=await mkdtemp(path.join(tmpdir(),'sportsbook-ci-'));
await mkdir('artifacts',{recursive:true});
const proc=spawn(process.execPath,['frontdoor-clearsports.mjs'],{env:{...process.env,PORT:'3025',DATA_DIR:data,NODE_ENV:'production',ACCOUNT_BETA_OPEN:'true',REQUIRE_ACCOUNT:'true',ACCOUNT_OWNER_EMAIL:'owner@local.invalid',DASHBOARD_SESSION_SECRET:randomBytes(32).toString('hex'),AUTOPROP_MASTER_KEY:randomBytes(32).toString('hex'),AUTO_SCAN_MINUTES:'0',THE_ODDS_API_KEY:'',SPORTSDATAIO_API_KEY:'',CLEARSPORTS_API_KEY:'',GEMINI_API_KEY:'test-fixture',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','pipe']});
let log='',browser,page;const checks=[],errors=[];proc.stdout.on('data',c=>log+=c);proc.stderr.on('data',c=>log+=c);
const check=(condition,name)=>{assert.ok(condition,name);checks.push(name);console.log('SPORTSBOOK_PASS',name)};
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500));}
 check(ready,'Integrated startup');for(const route of ['game-markets','taco-offers'])check((await fetch(base+'/api/apex/'+route)).status===401,route+' is account protected');
 const health=await(await fetch(base+'/api/account/health')).json();check(health.features.ask===true,'Gemini-only config enables Ask');
 check((await(await fetch(base)).text()).includes('Game lines. Player props. Auto Scout.'),'Anonymous root is the main sportsbook');
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1600,height:1100}});page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
 await ctx.request.post(base+'/api/account/register',{data:{email:'sportsbook-ci@local.invalid',password:randomBytes(18).toString('hex')}});
 const books=['DraftKings','FanDuel','BetMGM','Caesars','Fanatics','BetRivers'];
 const game={id:'qa1',homeTeam:'Chicago QA',awayTeam:'Detroit QA',startTime:'2099-01-01T00:00:00Z',status:'SCHEDULED',books:books.map(name=>({sportsbookKey:name.toLowerCase(),name,markets:[{marketKey:'h2h',updatedAt:'2026-09-12T00:00:00Z',outcomes:[{name:'Detroit QA',price:-110,point:null},{name:'Chicago QA',price:105,point:null}]},{marketKey:'spreads',outcomes:[{name:'Detroit QA',price:-110,point:-2.5},{name:'Chicago QA',price:-110,point:2.5}]},{marketKey:'totals',outcomes:[{name:'Over',price:-110,point:42.5},{name:'Under',price:-110,point:42.5}]}]}))};
 await page.route('**/api/apex/game-markets?*',r=>r.fulfill({json:sanitizePublicPayload({ok:true,available:true,games:[game],coverage:{note:'Test fixture only'}})}));
 await page.route('**/api/apex/props?*',r=>r.fulfill({json:{props:books.flatMap((book,i)=>['OVER','UNDER'].map(side=>({id:book+side,sport:'NFL',playerName:'Test Receiver',playerId:'qa',eventId:'qa1',market:'Receiving Yards',marketId:'player_reception_yds',line:55.5,side,sportsbook:book,sportsbookKey:book.toLowerCase(),price:-110,team:'DET',homeTeam:'Chicago QA',awayTeam:'Detroit QA'}))),meta:{warning:'Test partial-coverage notice'}}}));
 await page.route('**/api/apex/taco-offers?*',r=>r.fulfill({json:{offers:[],available:false,message:'Verified Taco promotion data is not supplied by the current feed.'}}));
 await page.route('**/api/apex/research?*',r=>r.fulfill({json:{available:true,gameLog:[60,70,40,55,80].map(value=>({value,date:'2026-09-01'})),projectedStat:{value:61.3,sampleSize:5,source:'Recent-form estimate'},windows:{l5:{hitRate:60,average:61,games:5},l10:{hitRate:60,average:61,games:5},l20:{hitRate:60,average:61,games:5}}}}));
 await page.route('**/api/props/ask',async r=>{const body=r.request().postDataJSON();check(body.prop.side==='OVER'&&body.prop.line===55.5&&body.prop.gameLog.length===5,'Ask sends active measured context');return r.fulfill({json:{available:true,answer:'Three of these five results exceeded 55.5.'}})});
 await page.route('**/api/props/project',r=>r.fulfill({json:{available:true,projection:63.4}}));
 await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'NFL · Game lines',exact:true}).waitFor();check(true,'Signed-in root opens game markets');
 const ml=page.getByRole('button',{name:'Detroit QA DraftKings Moneyline Detroit QA',exact:true});await ml.click();check(await ml.getAttribute('aria-pressed')==='true','Moneyline selection');check(await page.getByTestId('game-return').textContent()==='19.09','Betslip return calculation');
 await page.getByRole('button',{name:'Detroit QA DraftKings Spread Detroit QA',exact:true}).click();await page.getByRole('button',{name:'parlay',exact:true}).click();check(await page.getByTestId('game-return').textContent()==='Unavailable','Same-game parlay has no invented payout');
 await page.getByRole('button',{name:'single',exact:true}).click();await page.getByRole('button',{name:'Review selections',exact:true}).click();await page.getByText('No wager submitted',{exact:true}).waitFor();check(true,'Review does not simulate a wager');
 await page.screenshot({path:'artifacts/sportsbook-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Game board fits mobile');await page.screenshot({path:'artifacts/sportsbook-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Player props',exact:true}).click();await page.getByRole('button',{name:'Research Test Receiver',exact:true}).waitFor();check(await page.getByRole('columnheader',{name:'BetRivers',exact:true}).count()===1,'Book columns are not truncated to four');
 await page.getByRole('button',{name:'Research Test Receiver',exact:true}).click();await page.getByTestId('projected-stat').getByText('61.3',{exact:true}).waitFor();check(true,'Recent-form projected stat displays');
 await page.getByRole('button',{name:'Generate AI projection',exact:true}).click();await page.getByTestId('projected-stat').getByText('63.4',{exact:true}).waitFor();check(true,'AI generated projection replaces labeled baseline');
 await page.getByLabel('Ask prop question').fill('How many games exceeded the line?');await page.getByRole('button',{name:'Ask',exact:true}).click();await page.getByText('Three of these five results exceeded 55.5.',{exact:true}).waitFor();check(true,'Ask displays grounded answer');await page.screenshot({path:'artifacts/sportsbook-prop-insight.png',fullPage:false});await page.getByRole('button',{name:'Close prop research',exact:true}).click();
 await assertTacoPlacement(page,base,check);
 check(errors.length===0,`No JavaScript exceptions: ${errors.join(';')}`);await writeFile('artifacts/sportsbook-report.json',JSON.stringify({passed:checks.length,checks,errors,fixtureData:true,paidProviderCalls:0,productionAccountsCreated:false},null,2));
}catch(e){await page?.screenshot({path:'artifacts/sportsbook-failure.png',fullPage:true}).catch(()=>{});await writeFile('artifacts/sportsbook-failure.json',JSON.stringify({error:e.message,checks,url:page?.url()},null,2));throw e;}
finally{await browser?.close();proc.kill('SIGTERM');await writeFile('artifacts/sportsbook-server.log',log);}
