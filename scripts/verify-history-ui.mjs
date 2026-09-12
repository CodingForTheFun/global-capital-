// Isolated browser QA. All HTTP is replayed locally; no production/account/provider writes.
// Run: node scripts/verify-history-ui.mjs (optional CHROMIUM_PATH override).
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { normalizePublicGameLog } from '../lib/data-sources/espn/research.mjs';
import { finalizeResearch } from '../lib/autoscout/research-service.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),out=process.env.QA_OUTPUT_DIR||'/tmp/obligepay-history-qa';
await mkdir(out,{recursive:true});
const fixture=JSON.parse(await readFile(root+'/tests/fixtures/espn-history-repair.json','utf8'));
const wnba=JSON.parse(await readFile(root+'/tests/fixtures/espn-wnba-gamelog.json','utf8'));
const replayNow=Date.parse('2026-09-12T22:00:00Z');
const selections={NFL:{sport:'NFL',playerName:'Micah Parsons',market:'Sacks',marketId:'player_sacks',team:'GB',homeTeam:'Green Bay Packers',awayTeam:'Detroit Lions',line:0.5,log:fixture['defense-previous']},
 WNBA:{sport:'WNBA',playerName:'Caitlin Clark',market:'Assists',marketId:'player_assists',team:'IND',homeTeam:'Indiana Fever',awayTeam:'Washington Mystics',line:7.5,log:wnba}};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
try{
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]]){
  const context=await browser.newContext({viewport});const page=await context.newPage();
  const errors=[],assetFailures=[],requests=[];let held=null,firstNFL=true;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&/\.(?:css|mjs|js)(?:\?|$)/.test(r.url()))assetFailures.push(r.url());});
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.hostname!=='127.0.0.1')return route.abort();
   const json=data=>route.fulfill({contentType:'application/json; charset=utf-8',body:JSON.stringify(data)});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated history regression replay</title><script src="/scout-ui-v5.js"></script>'});
   if(u.pathname==='/api/apex/props'){
    const s=selections[u.searchParams.get('sport')];
    return json({props:s?['OVER','UNDER'].map(side=>({...s,log:undefined,id:side,side,eventId:'fixture',gameStartTime:'2026-09-13T18:00:00Z',sportsbook:'PrizePicks',sportsbookKey:'prizepicks',isAlternate:false,providerUpdatedAt:'2026-09-12T22:00:00Z'})):[],data:{players:[],lines:[]},meta:{events:s?1:0,sportsbookCount:s?1:0,warning:'ISOLATED QA REPLAY — example lines, recorded game results, not a live board.'}});
   }
   if(u.pathname==='/api/apex/research-batch'){
    const props=req.postDataJSON().props;requests.push(props.map(p=>p.sport));
    if(firstNFL&&props[0]?.sport==='NFL'){firstNFL=false;await new Promise(r=>held=r);}
    const results={};
    for(const p of props){const s=selections[p.sport];
     const gameLog=normalizePublicGameLog(s.log,{...p,providerMarketKey:p.marketId,now:replayNow});
     results[p.key]=finalizeResearch({...p,available:true,player:{playerName:p.playerName,team:s.team},gameLog,season:s.log.filters.find(f=>f.name==='season').value,coverage:{seasonComplete:true}});
    }
    return json({results});
   }
   if(u.pathname==='/api/apex/player-artwork')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#203040"/></svg>'});
   if(u.pathname==='/api/saved-props')return json({saved:[],profile:null});
   if(u.pathname.startsWith('/api/'))return json({ok:true,authenticated:false});
   const relative=u.pathname==='/scout-ui-v5.js'?'apex-v2/scout-ui-v5.js':u.pathname==='/assets/autoscout-research.css'?'apex-v2/research-ui.css':u.pathname.replace(/^\/assets\//,'');
   const file=resolve(root,relative);
   if(!file.startsWith(root+'/'))return route.abort();
   try{return route.fulfill({contentType:(extname(file)==='.css'?'text/css':'text/javascript')+'; charset=utf-8',body:await readFile(file,'utf8')});}
   catch{return route.fulfill({status:404,body:'not found'});}
  });
  try{
   await page.goto('http://127.0.0.1:4998/');
   await page.waitForFunction(()=>document.querySelector('.asCard')?.innerText.includes('Micah Parsons'));
   await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.disabled===true);
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('.asBadges')).display==='grid');
   // A real browser sport-switch while the old batch is deliberately unresolved.
   await page.locator('[data-sport="WNBA"]').click();
   await page.waitForFunction(()=>document.querySelector('.asCard')?.innerText.includes('Caitlin Clark')&&document.querySelector('.asResearchState.ready'));
   assert.ok(requests.some(p=>p.includes('WNBA')));
   held?.();held=null;
   await page.screenshot({path:out+'/'+name+'-board.png',fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page should not overflow horizontally');
   assert.ok((await page.locator('.asBadges').innerText()).includes('—')||(await page.locator('.asBadges').innerText()).includes('73%'));
   await page.locator('.asCard').first().click();
   await page.locator('[data-window="l5"] b').waitFor();
   const rate=()=>page.locator('[data-window="l5"] b').innerText();
   const over=parseFloat(await rate());assert.ok(Number.isFinite(over));
   await page.locator('[data-side="UNDER"]').click();
   const under=parseFloat(await rate());assert.ok(Math.abs(over+under-100)<0.11);
   const input=page.locator('#asLineInput'),previous=Number(await input.inputValue());
   await page.locator('#asLinePlus').click();assert.equal(Number(await input.inputValue()),previous+0.5);
   await input.fill('1000');await input.dispatchEvent('change');
   assert.equal(await rate(),'100%');
   await page.locator('[data-side="OVER"]').click();assert.equal(await rate(),'0%');
   await page.screenshot({path:out+'/'+name+'-drawer.png',fullPage:true});
   assert.deepEqual(errors,[]);assert.deepEqual(assetFailures,[]);
   console.log(name,'PASS: stylesheet, UTF-8, viewport, sport-switch recovery, research cards, side/line recalculation, no page or asset errors');
  }catch(e){await page.screenshot({path:out+'/'+name+'-failure.png',fullPage:true});throw e;}
  finally{held?.();await context.close();}
 }
}finally{await browser.close();}
