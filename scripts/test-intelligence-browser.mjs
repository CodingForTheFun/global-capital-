/** Isolated fixture-only browser checks; never requests providers or production accounts. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { analyzeResearch } from '../lib/analytics/research.mjs';
const now=Date.now();let revision=0,historyRequests=0,paidRequests=0,boardRequests=0;
const quoteTime=()=>new Date(now-60000+revision*1000).toISOString();
const athlete='Local QA Athlete',eventId='qa-event',playerId='qa-player';
const games=Array.from({length:12},(_,i)=>({gameId:`qa-g${i}`,date:new Date(now-(i+1)*86400000).toISOString(),value:20+i,minutes:30,assists:i===1?null:i,season:2026,completed:true,isHome:i%2===0,opponent:'NY',teammateParticipation:[{playerId:'qa-t',name:'Fixture teammate',played:i<6,verified:true,source:'Local test participation fixture'}]}));
const base={available:true,ok:true,sport:'NBA',player:{id:playerId,playerName:athlete,team:'BOS'},gameLog:games,season:2026,matchup:{opponent:'NY'},coverage:{seasonComplete:false},source:'Local test fixture'};
const props=()=>['Book A','Book B','Book C'].flatMap((book,j)=>['OVER','UNDER'].map(side=>({id:`p-${j}-${side}`,eventId,playerId,playerName:athlete,team:'BOS',sport:'NBA',marketId:'player_points',market:'Points',side,line:24.5+(j===1?1:0)+revision,price:j===1?150:j===2?-115:-110,sportsbookKey:book,sportsbook:book,providerUpdatedAt:quoteTime(),gameStartTime:new Date(now+86400000).toISOString(),awayTeam:'New York Knicks',homeTeam:'Boston Celtics',isAlternate:false})));
const source=process.cwd(),out=path.join(source,'test-results/intelligence');fs.mkdirSync(out,{recursive:true});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 const send=(value,status=200,type='application/json')=>{res.writeHead(status,{'content-type':type+'; charset=utf-8'});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
 try {
  if(p==='/')return send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Scout local QA fixture</title></head><body><script src="/ui.js"></script></body></html>',200,'text/html');
  const file=p==='/ui.js'?'apex-v2/scout-ui-v5.js':p==='/assets/autoscout-research.css'?'apex-v2/research-ui.css':p.startsWith('/assets/lib/')?p.slice(8):null;
  if(file && !file.includes('..') && fs.existsSync(file))return send(fs.readFileSync(file),200,file.endsWith('.css')?'text/css':'application/javascript');
  if(p==='/api/apex/props'){boardRequests++;return send({props:props(),data:{lines:props().map(r=>({id:r.id,propId:'qa-prop'})),players:[{id:playerId,team:'BOS'}]},meta:{fetchedAt:quoteTime(),events:1,sportsbookCount:3}});}
  if(p==='/api/apex/research')return send(analyzeResearch(base,Number(url.searchParams.get('line')),url.searchParams.get('side')));
  if(p==='/api/apex/research-batch'){let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);return send({ok:true,results:Object.fromEntries(request.props.map(r=>[r.key,analyzeResearch(base,r.line,r.side)]))});}
  if(p==='/api/apex/line-history'){historyRequests++;const book=url.searchParams.get('bookmaker'),side=url.searchParams.get('side');return send({configured:true,rows:[{prop_id:'qa-prop',bookmaker_key:book,side,line:22.5,created_at:new Date(now-3600000).toISOString()},{prop_id:'qa-prop',bookmaker_key:book,side,line:24.5,created_at:new Date(now-1800000).toISOString()}]});}
  if(p==='/api/account/me')return send({authenticated:true,user:{id:'local-qa',email:'qa@example.invalid'}});
  if(p==='/api/saved-props')return send({saved:[],profile:{kind:'account',id:'local-qa'}});
  if(p==='/api/account/health')return send({ok:true,password:{available:true}});
  if(p==='/api/apex/player-artwork')return send('',404);
  if(p.includes('predict')||p.includes('ask')){paidRequests++;return send({available:false});}
  if(p.startsWith('/api/'))return send({ok:true});
  console.error('FIXTURE_NOT_FOUND',p);return send({error:'Not found'},404);
 }catch(error){console.error('FIXTURE_ERROR',p,error.message);return send({error:'Fixture handler error'},500);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
let activePage=null,activeLabel='setup';const failures=[];
const report={scope:'Local synthetic fixture QA, not proof of production provider availability.',checks:[],requests:{}};
try{
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['tablet',{width:820,height:1180}],['mobile-375',{width:375,height:812}],['mobile',{width:390,height:844}],['mobile-430',{width:430,height:932}]] ){
  const context=await browser.newContext({viewport,acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('autoscout-sport','NBA'));
  const page=await context.newPage(),errors=[];activePage=page;activeLabel=name;
  page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER_PAGE_ERROR',name,e.stack||e.message);});
  page.on('console',m=>{if(m.type()==='error')console.error('BROWSER_CONSOLE',name,m.text());});
  page.on('requestfailed',r=>{failures.push({url:r.url(),error:r.failure()?.errorText});console.error('BROWSER_REQUEST_FAILED',r.url(),r.failure()?.errorText);});
  page.on('response',r=>{if(r.status()>=400)console.error('BROWSER_HTTP',r.status(),r.url());});
  await page.goto(origin);console.log('BROWSER_LOADED',name);await page.waitForSelector('.asCard');console.log('BROWSER_CARDS',name);await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');
  assert.equal(await page.locator('#asi-open').isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`${name}-board.png`),fullPage:true});
  await page.locator('#asSort').selectOption('l20');
  await page.locator('#asAdvancedToggle').click();
  assert.equal(await page.locator('[data-threshold="l20"]').count(),1);
  await page.locator('#asFilterDone').click();
  await page.locator('#asi-open').click();await page.waitForSelector('#asi-sensitivity');console.log('BROWSER_STUDIO',name);
  assert.equal(await page.locator('#asIntelligenceDetail details').count(),8);
  assert.equal(await page.locator('#asi-sensitivity tbody tr').count(),7);
  const initialLine=24.5+revision;
  const activeRate=()=>page.locator('#asi-sensitivity tr.active td').nth(1).textContent();
  assert.equal((await activeRate()).trim(),Math.round(analyzeResearch(base,initialLine,'OVER').windows.l10.hitRate)+'%');
  // A single step plus a side flip can legitimately preserve a hit rate (pushes).
  // Verify exact thresholds and shared-engine results, not an assumed inequality.
  await page.locator('#asLinePlus').click();await page.locator('#asLinePlus').click();await page.locator('[data-side="UNDER"]').click();
  assert.match(await page.locator('#asi-sensitivity tr.active td').first().textContent(),new RegExp(String(initialLine+1).replace('.', '\\.')));
  assert.equal((await activeRate()).trim(),Math.round(analyzeResearch(base,initialLine+1,'UNDER').windows.l10.hitRate)+'%');
  assert.ok((await page.locator('#asi-quality').textContent()).includes('not predictive confidence'));
  await page.locator('[data-asi-section="scenario"]').click();await page.locator('#asi-minutes').fill('0');await page.locator('#asi-scenario-form button').click();
  assert.equal(await page.locator('#asi-scenario-result .asi-big').first().textContent(),'0');
  await page.locator('[data-asi-section="dependencies"]').click();assert.equal(await page.locator('.asi-graph').count(),1);
  await page.locator('[data-asi-section="timeline"]').click();const before=historyRequests;await page.locator('#asi-history-load').click();await page.waitForSelector('#asi-timeline-output li');assert.equal(historyRequests,before+1);
  await page.locator('#asi-history-load').click();await page.waitForTimeout(120);assert.equal(historyRequests,before+1,'history request reuses cache');
  await page.locator('[data-asi-section="brief"]').click();await page.locator('#asi-brief-build').click();assert.ok((await page.locator('#asi-brief-output').textContent()).includes('[E1]'));
  const download=page.waitForEvent('download');await page.locator('#asi-download').click();const downloaded=await download;assert.equal(downloaded.suggestedFilename(),'autoscout-research-brief.txt');
  await page.locator('[data-asi-section="sensitivity"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.locator('.asDrawer').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await page.screenshot({path:path.join(out,`${name}-studio.png`),fullPage:false});
  await page.locator('#asTab-intelligence').focus();await page.keyboard.press('End');assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id'),'asTab-ask');await page.keyboard.press('Home');assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id'),'asTab-overview');
  await page.locator('[data-window="l5"]').click();
  assert.equal(await page.locator('[data-support-stat="assists"] b').textContent(),'2.3');
  assert.equal(await page.locator('[data-support-stat="assists"] .asSupportSample').textContent(),'4 of 5 games reported');
  assert.equal(await page.locator('[data-support-stat="rebounds"] b').textContent(),'Unavailable');
  await page.locator('[data-filter="home"]').click();
  assert.equal(await page.locator('[data-support-stat="assists"] b').textContent(),'4');
  assert.equal(await page.locator('[data-support-stat="assists"] .asSupportSample').textContent(),'5 of 5 games reported');
  await page.locator('[data-window="l20"]').click();
  assert.equal(await page.locator('[data-support-stat="assists"] .asSupportSample').textContent(),'6 of 6 games reported');
  assert.equal(await page.locator('.asDrawer').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await page.screenshot({path:path.join(out,`${name}-supporting-stats.png`),fullPage:false});
  await page.locator('#asTab-lines').click();
  await page.locator('#asLineInput').fill(String(initialLine));
  await page.locator('#asLineInput').press('Tab');
  assert.equal(await page.locator('.asMatrix .asBest').count(),2);
  for(const cell of await page.locator('.asMatrix .asBest').all())assert.match(await cell.textContent(),/^-110/);
  assert.equal(await page.locator('.asDrawer').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.asDrawerBg.on').count(),0);
  revision++;await page.locator('#asRefresh').click();await page.waitForFunction(()=>document.querySelector('#asi-radar-count')?.textContent.includes('observed changes'));
  await page.locator('.asi-radar summary').click();assert.ok(await page.locator('[data-radar-key]').count()>0);
  assert.deepEqual(errors,[]);
  report.checks.push({viewport:name,selectedSampleStats:true,l20Controls:true,exactLinePriceComparison:true,eightTools:true,sharedSensitivityReactivity:true,zeroMinuteScenario:true,dependencyGraph:true,historyCache:true,citedBrief:true,textDownload:true,radar:true,keyboardTabs:true,noOverflow:true,pageErrors:errors});
  await context.close();
 }
 assert.equal(paidRequests,0);report.requests={historyRequests,paidRequests,boardRequests};
 console.log(JSON.stringify(report,null,2));
}catch(error){
 report.failure={viewport:activeLabel,message:error.stack||String(error),network:failures};
 if(activePage&&!activePage.isClosed()){
  report.failure.visibleText=await activePage.locator('body').innerText().catch(()=>null);
  fs.writeFileSync(path.join(out,'failure.html'),await activePage.content().catch(()=>''));
  await activePage.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
 }
 console.error('BROWSER_DIAGNOSTICS',JSON.stringify(report.failure));throw error;
}finally{fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
