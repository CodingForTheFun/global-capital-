/** Synthetic local contract/UI tests only; never substitutes results on production. */
import http from 'node:http';
import fs from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {ML_ENGINE} from '../lib/ml/contract.mjs';
const kickoff=new Date(Date.now()+86400000).toISOString(),rows=[];
for(const [id,name] of [['qa-a','QA Model Fixture'],['qa-b','QA Untrained Fixture']])for(const market of ['player_pass_yds','player_rush_yds'])for(const side of ['OVER','UNDER'])rows.push({id:id+market+side,sport:'NFL',eventId:'ml-fixture-game',playerId:id,playerName:name,marketId:market,market:market==='player_pass_yds'?'Passing yards':'Rushing yards',line:market==='player_pass_yds'?200.5:20.5,side,sportsbookKey:'prizepicks',sportsbook:'PrizePicks',gameStartTime:kickoff,homeTeam:'Home Fixture',awayTeam:'Away Fixture',entityType:'player',isAlternate:false,price:-110});
// Synthetic promotion contract fixture, never real upstream Taco data.
const tq=rows.find(q=>q.playerId==='qa-a'&&q.marketId==='player_pass_yds'&&q.side==='OVER');
tq.promotion={type:'taco',source:'prizepicks',verified:true,status:'active',sourceRecordId:'qa-taco-fixture',offerId:tq.id,sport:tq.sport,eventId:tq.eventId,playerId:tq.playerId,marketId:tq.marketId,side:tq.side,line:tq.line,observedAt:new Date(Date.now()-1000).toISOString(),startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()};
const requests=[];let failure=false;
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost'),p=u.pathname;
 const send=(data,status=200,type='application/json')=>{res.writeHead(status,{'content-type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
 if(p==='/')return send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script src="/ui.js"></script></body></html>',200,'text/html');
 const file=p==='/ui.js'?'apex-v2/scout-ui-v5.js':p==='/assets/prop-ml.css'?'public/prop-ml.css':p==='/assets/autoscout-research.css'?'apex-v2/research-ui.css':p.startsWith('/assets/lib/')?p.slice(8):null;
 if(file&&fs.existsSync(file))return send(fs.readFileSync(file),200,file.endsWith('.css')?'text/css':'application/javascript');
 if(p==='/api/props/ml'){
  let text='';for await(const c of req)text+=c;const input=JSON.parse(text);requests.push(input.props);await new Promise(r=>setTimeout(r,250));
  if(failure)return send({ok:false},503);
  return send({ok:true,results:Object.fromEntries(input.props.map(t=>[t.key,t.playerId==='qa-a'&&t.marketId==='player_pass_yds'?{...t,available:true,modelled:true,code:'READY',engine:ML_ENGINE,projection:231.4,probabilityOver:.64,probabilityUnder:.36,probabilityPush:0,modelVersion:'QA fixture NOT trained model',generatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),validation:{observations:400,events:100}}:{available:false,code:'MODEL_NOT_READY',message:'No trained, validated model has been loaded for this market.'}]))});
 }
 if(p.startsWith('/api/props/predict')||p.startsWith('/api/props/project')){requests.push('FORBIDDEN_PAID_LLM');return send({},500);}
 if(p==='/api/apex/props')return send({props:rows,data:{players:[],lines:[]},meta:{}});
 if(p==='/api/apex/research-batch'){
  let raw='';for await(const c of req)raw+=c;return send({ok:true,results:Object.fromEntries(JSON.parse(raw).props.map(r=>[r.key,{available:false,code:'NO_GAME_LOG_DATA',gameLog:[]}]))});
 }
 if(p==='/api/apex/research')return send({available:false,code:'NO_GAME_LOG_DATA',gameLog:[]});
 if(p==='/api/saved-props')return send({saved:[],profile:{kind:'account',id:'ml-qa'}});
 if(p==='/api/account/me')return send({authenticated:true,user:{id:'ml-qa',email:'qa@local.invalid'}});
 if(p==='/api/apex/player-artwork')return send('',404,'image/png');
 if(p.startsWith('/api/'))return send({ok:true});
 send({},404);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
await mkdir('validation-output/ml',{recursive:true});
const browser=await chromium.launch({headless:true}),report={scope:'Synthetic fixture browser testing only, not actual predictions or production quotes',checks:[]};
try{
 for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('.asCard [data-ml-state="READY"]');
  assert.equal(await page.locator('.asCard').count(),2);
  assert.equal(await page.locator('.asCard .asML').count(),2);
  assert.equal(await page.locator('.asCard .asTacoBadge').count(),1);
  assert.equal(await page.locator('.asCard .asCardHead .asTacoBadge').count(),0);
  assert.equal(await page.locator('.asCard .asOddsStrip .o .asTacoBadge').count(),1);
  assert.equal(await page.locator('.asCard .asOddsStrip .u .asTacoBadge').count(),0);
  const a=page.locator('.asCard').filter({has:page.locator('.asPlayer',{hasText:'QA Model Fixture'})});
  assert.ok((await a.locator('.asML').innerText()).includes('231.4'));assert.ok((await a.locator('.asML').innerText()).includes('64.0%'));
  assert.equal(await page.locator('.asCard [data-ml-state="MODEL_NOT_READY"]').count(),1);
  await a.locator('.asPlayer').click();await page.waitForSelector('#asDrawerBody [data-ml-state="READY"]');
  await page.locator('[data-side="UNDER"]').click();assert.ok((await page.locator('#asDrawerBody .asMLSelected').innerText()).includes('Under'));
  await page.locator('#asLinePlus').click();await page.waitForSelector('#asDrawerBody [data-ml-state="TARGET_UNVERIFIED"]');
  assert.ok(!(await page.locator('#asDrawerBody .asML').innerText()).includes('231.4'),'No forecast borrowed for an unscored line');
  await page.locator('#asClose').click();await page.locator('[data-prop-type="all"]').click();
  await page.locator('#asSearch').fill('QA Model Fixture');await page.waitForTimeout(350);
  const control=page.locator('.asCard [data-card-choice]');
  const option=await control.locator('option').evaluateAll(items=>items.find(i=>i.textContent.startsWith('Rushing')).value);
  await control.selectOption(option);await page.waitForSelector('.asCard [data-ml-state="MODEL_NOT_READY"]');
  assert.equal(await page.locator('.asCard').count(),1);assert.ok(!(await page.locator('.asCard .asML').innerText()).includes('231.4'));
  assert.equal(await page.locator('.asCard .asTacoBadge').count(),0,'Rushing prop cannot inherit a passing Taco');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  assert.ok(!requests.includes('FORBIDDEN_PAID_LLM'));assert.ok(requests.every(r=>r.length<=24));
  await page.screenshot({path:`validation-output/ml/${label}-untrained-fixture.png`,fullPage:true});
  report.checks.push({viewport:label,cardCount:2,noRepeats:true,exactLine:true,sideSwitch:true,marketSwitch:true,absentModelNoNumbers:true,noAutomaticLLM:true,pageErrors:errors});
  await context.close();
 }
 failure=true;const c=await browser.newContext();const p=await c.newPage();await p.goto(base);await p.waitForSelector('.asCard [data-ml-state="MODEL_FEED_UNAVAILABLE"]');await c.close();
 report.failureDoesNotCrashBoard=true;
 await writeFile('validation-output/ml/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
