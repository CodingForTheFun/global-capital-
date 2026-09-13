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
const games=Array.from({length:12},(_,i)=>({gameId:`qa-g${i}`,date:new Date(now-(i+1)*86400000).toISOString(),value:20+i,minutes:30,season:2026,completed:true,isHome:i%2===0,opponent:'NY',teammateParticipation:[{playerId:'qa-t',name:'Fixture teammate',played:i<6,verified:true,source:'Local test participation fixture'}]}));
const base={available:true,ok:true,sport:'NBA',player:{id:playerId,playerName:athlete,team:'BOS'},gameLog:games,season:2026,matchup:{opponent:'NY'},coverage:{seasonComplete:false},source:'Local test fixture'};
const props=()=>['Book A','Book B'].flatMap((book,j)=>['OVER','UNDER'].map(side=>({id:`p-${j}-${side}`,eventId,playerId,playerName:athlete,team:'BOS',sport:'NBA',marketId:'player_points',market:'Points',side,line:24.5+j+revision,price:-110,sportsbookKey:book,sportsbook:book,providerUpdatedAt:quoteTime(),gameStartTime:new Date(now+86400000).toISOString(),awayTeam:'New York Knicks',homeTeam:'Boston Celtics',isAlternate:false})));
const source=process.cwd(),out=path.join(source,'test-results/intelligence');fs.mkdirSync(out,{recursive:true});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 const send=(value,status=200,type='application/json')=>{res.writeHead(status,{'content-type':type});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
 if(p==='/')return send('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Scout local QA fixture</title></head><body><script src="/ui.js"></script></body></html>',200,'text/html');
 const file=p==='/ui.js'?'apex-v2/scout-ui-v5.js':p==='/assets/autoscout-research.css'?'apex-v2/research-ui.css':p.startsWith('/assets/lib/')?p.slice(8):null;
 if(file && !file.includes('..') && fs.existsSync(file))return send(fs.readFileSync(file),200,file.endsWith('.css')?'text/css':'application/javascript');
 if(p==='/api/apex/props'){boardRequests++;return send({props:props(),data:{lines:props().map(r=>({id:r.id,propId:'qa-prop'})),players:[{id:playerId,team:'BOS'}]},meta:{fetchedAt:quoteTime(),events:1,sportsbookCount:2}});}
 if(p==='/api/apex/research')return send(analyzeResearch(base,Number(url.searchParams.get('line')),url.searchParams.get('side')));
 if(p==='/api/apex/research-batch'){let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);return send({ok:true,results:Object.fromEntries(request.props.map(r=>[r.key,analyzeResearch(base,r.line,r.side)]))});}
 if(p==='/api/apex/line-history'){historyRequests++;const book=url.searchParams.get('bookmaker'),side=url.searchParams.get('side');return send({configured:true,rows:[{prop_id:'qa-prop',bookmaker_key:book,side,line:22.5,created_at:new Date(now-3600000).toISOString()},{prop_id:'qa-prop',bookmaker_key:book,side,line:24.5,created_at:new Date(now-1800000).toISOString()}]});}
 if(p==='/api/account/me')return send({authenticated:true,user:{id:'local-qa',email:'qa@example.invalid'}});
 if(p==='/api/saved-props')return send({saved:[],profile:{kind:'account',id:'local-qa'}});
 if(p==='/api/account/health')return send({ok:true,password:{available:true}});
 if(p==='/api/apex/player-artwork')return send('',404);
 if(p.includes('predict')||p.includes('ask')){paidRequests++;return send({available:false});}
 return send({ok:true});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
const report={scope:'Local synthetic fixture QA, not proof of production provider availability.',checks:[],requests:{}};
try{
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport,acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('autoscout-sport','NBA'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForSelector('.asCard');await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');
  assert.equal(await page.locator('#asi-open').isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`${name}-board.png`),fullPage:true});
  await page.locator('#asi-open').click();await page.waitForSelector('#asi-sensitivity');
  assert.equal(await page.locator('#asIntelligenceDetail details').count(),8);
  assert.equal(await page.locator('#asi-sensitivity tbody tr').count(),7);
  const original=await page.locator('#asi-sensitivity tr.active td').nth(1).textContent();
  await page.locator('#asLinePlus').click();await page.locator('[data-side="UNDER"]').click();
  const revised=await page.locator('#asi-sensitivity tr.active td').nth(1).textContent();assert.notEqual(original,revised);
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
  await page.keyboard.press('Escape');assert.equal(await page.locator('.asDrawerBg.on').count(),0);
  revision++;await page.locator('#asRefresh').click();await page.waitForFunction(()=>document.querySelector('#asi-radar-count')?.textContent.includes('observed changes'));
  await page.locator('.asi-radar summary').click();assert.ok(await page.locator('[data-radar-key]').count()>0);
  assert.deepEqual(errors,[]);
  report.checks.push({viewport:name,eightTools:true,sharedSensitivityReactivity:true,zeroMinuteScenario:true,dependencyGraph:true,historyCache:true,citedBrief:true,textDownload:true,radar:true,keyboardTabs:true,noOverflow:true,pageErrors:errors});
  await context.close();
 }
 assert.equal(paidRequests,0);report.requests={historyRequests,paidRequests,boardRequests};
 fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();server.close();}
