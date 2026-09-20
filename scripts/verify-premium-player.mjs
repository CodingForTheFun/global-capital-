// Explicitly synthetic browser fixtures. Never calls a paid provider or changes production data.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3100',out='artifacts/premium-player';
await mkdir(out,{recursive:true});
const quote=(book,line,side='OVER')=>({key:`${book}:${line}:${side}`,outcomeId:null,book,bookName:book==='draftkings'?'DraftKings':'FanDuel',line,choice:side,side,price:side==='OVER'?-115:-105,multiplier:null,updatedAt:'2050-09-20T12:00:00Z',dfs:false,conflict:false});
const markets=[{key:'longest',marketKey:'player_rush_longest',label:'player_rush_longest',period:null,variant:'standard',offers:[quote('draftkings',.5),quote('draftkings',.5,'UNDER'),quote('fanduel',1.5),quote('fanduel',1.5,'UNDER')]},{key:'half',marketKey:'player_rush_longest',label:'player_rush_longest · Period h1',period:'h1',variant:'standard',offers:[quote('draftkings',.5)]},{key:'yards',marketKey:'player_rush_yds',label:'player_rush_yds',period:null,variant:'standard',offers:[quote('draftkings',30.5)]}];
const player={key:'qa-player',playerId:null,name:'Research QA Player',aliases:[],sport:'football_nfl',eventId:'qa-event',startsAt:'2050-09-20T18:00:00Z',homeTeam:'Test Home',awayTeam:'Test Away',markets};
const url=base+'/research?'+new URLSearchParams({sportKey:player.sport,event:player.eventId,playerKey:player.key,category:'longest'});
const results=[];const browser=await chromium.launch();
try{
 for(const width of [375,390,430,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],historyCalls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());let body,status=200;
   if(u.pathname==='/api/account/me')body={authenticated:true,user:{id:'synthetic-ui-user'}};
   else if(u.pathname==='/api/oblige-workspace'){
    const action=u.searchParams.get('action');
    if(action==='event')body={ok:true,players:[player],event:{id:player.eventId},fetchedAt:new Date().toISOString()};
    if(action==='history'){
     const key=u.searchParams.get('market');historyCalls.push(key);
     body=key==='half'?{ok:true,available:false,message:'Exact first-half history unavailable.',gameLog:[]}:{ok:true,available:true,source:'Synthetic UI fixture only',gameLog:Array.from({length:16},(_,i)=>({gameId:`qa-${i}`,date:`2049-09-${String(28-i).padStart(2,'0')}T00:00:00Z`,value:i===7?null:i%4,opponent:['TST','QA','SYN'][i%3],isHome:i%2===0,season:2049}))};
    }
    if(action==='model')body={ok:true,prediction:{available:false,message:'No trained model has passed validation for this selection yet.'}};
   }
   if(!body){status=404;body={ok:false};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('[data-design="premium-player-research-v1"]').waitFor();await page.locator('.op-chart-bar').first().waitFor();
  const text=await page.locator('[data-design]').innerText();assert.ok(!text.includes('player_rush_'),'No raw provider names in customer-visible text');
  assert.equal(await page.getByRole('group',{name:'Stat categories',exact:true}).locator('button').count(),2,'No duplicate category per period, book or line');
  assert.equal(await page.getByRole('group',{name:'Available game periods',exact:true}).locator('button').count(),2,'Only actual supported periods');
  assert.equal(await page.locator('.op-research-title:visible').count(),0,'No duplicated research heading');
  assert.equal(await page.getByRole('button',{name:'Follow Research QA Player',exact:true,includeHidden:true}).count(),2,'Same follow action is retained in engine and presented once');
  assert.equal(await page.getByRole('button',{name:'Follow Research QA Player',exact:true}).count(),1);
  const initialHistoryCalls=historyCalls.length;
  assert.equal(await page.getByLabel('Selected book',{exact:true}).locator('option').count(),1,'hero selector is exact-line only');
  await page.getByRole('button',{name:'Select FanDuel',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='1.5');
  await page.getByRole('button',{name:'Raise research line',exact:true}).click();assert.equal(await page.locator('.op-line-number').textContent(),'2');
  assert.equal(historyCalls.length,initialHistoryCalls,'Book and line changes do not widen history polling');
  await page.getByRole('button',{name:'Follow Research QA Player',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Unfollow Research QA Player',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Select DraftKings',exact:true}).click();
  await page.getByRole('group',{name:'Available game periods',exact:true}).getByRole('button',{name:'1H',exact:true}).click();
  await page.getByText('Exact first-half history unavailable.',{exact:true}).waitFor();assert.equal(await page.locator('.op-chart-bar').count(),0,'No full-game chart substituted for missing half history');
  if(width===390)await page.screenshot({path:`${out}/mobile390-unavailable.png`,fullPage:true});
  await page.getByRole('group',{name:'Available game periods',exact:true}).getByRole('button',{name:'Full game',exact:true}).click();await page.locator('.op-chart-bar').first().waitFor();
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,chartTop:document.querySelector('.op-chart-section')?.getBoundingClientRect().top}));
  assert.ok(dimensions.scrollWidth<=width+1,`${width}: no horizontal page overflow`);
  assert.ok(dimensions.chartTop<850,`${width}: chart is not pushed below giant repeated forms`);
  await page.screenshot({path:`${out}/width-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[],'No runtime errors');results.push({width,passed:true,syntheticFixtures:true,...dimensions,historyCalls:historyCalls.length});await context.close();
 }
 const context=await browser.newContext(),page=await context.newPage();let workspaceRequests=0;
 await page.route('**/api/**',async route=>{if(route.request().url().includes('/api/oblige-workspace'))workspaceRequests++;await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({authenticated:false,ok:false})});});
 await page.goto(url);await page.getByRole('button',{name:/sign in/i}).first().waitFor();assert.equal(workspaceRequests,0);assert.equal(await page.locator('[data-design="premium-player-research-v1"]').count(),0);await context.close();
 results.push({signedOut:'PASS',privateWorkspaceRequests:0});
}catch(error){await writeFile(`${out}/failure.txt`,String(error));throw error;}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));}
console.log(JSON.stringify({ok:true,results}));
