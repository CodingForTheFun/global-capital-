// Synthetic UI fixtures only; no sports provider, user account, or production data.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.WORKSPACE_TEST_ORIGIN||'http://127.0.0.1:3100';
const out='artifacts/restored-terminal';await mkdir(out,{recursive:true});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const reports=[];
const browser=await chromium.launch();
try{
 for(const [name,viewport] of [['mobile390',{width:390,height:844}],['desktop1440',{width:1440,height:1000}]]){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  let failPhotos=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(base+'/board',async route=>{
   const response=await route.fetch();
   await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"img-src 'self' data: blob:"}});
  });
  await page.route('**/_next/image?**',route=>failPhotos?route.abort():route.fulfill({status:200,contentType:'image/png',body:pixel}));
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());let body;
   if(u.pathname==='/api/account/me')body={authenticated:true,user:{id:'fixture-user'}};
   else if(u.pathname==='/api/apex/props'){
    const sport=u.searchParams.get('sport')||'NFL';
    const playerName=sport==='WNBA'?'Fixture Second Player':'Fixture Player',providerPlayerId=sport==='WNBA'?'espn:84':'espn:42';
    const common={sport,playerName,providerPlayerId,eventId:'fixture-event',market:'Points',marketId:'player_points',line:20.5,price:-110,gameStartTime:'2050-09-20T18:00:00Z',homeTeam:'Test Home',awayTeam:'Test Away'};
    body={ok:true,props:['book-a','book-b'].flatMap(book=>['OVER','UNDER'].map(side=>({...common,id:`${sport}-${book}-${side}`,sportsbook:book,sportsbookKey:book,side}))).concat([{...common,id:'blank-row',playerName:''}]),supportedSports:['NFL','WNBA'],meta:{sportsbookCount:2}};
   }else if(u.pathname==='/api/apex/research')body={ok:true,available:false,message:'Synthetic test: verified history unavailable.',gameLog:[]};
   else if(u.pathname==='/api/props/ml')body={ok:true,results:{}};
   else if(u.pathname==='/api/apex/player-artwork'){
    if(failPhotos)return route.abort();
    return route.fulfill({status:200,contentType:'image/png',body:pixel});
   }else if(u.pathname==='/api/apex/stream')return route.fulfill({status:200,contentType:'text/event-stream',body:'event: ready\ndata: {}\n\n'});
   return route.fulfill({status:body?200:404,contentType:'application/json',body:JSON.stringify(body||{})});
  });
  await page.goto(base+'/board');
  await page.getByRole('heading',{name:'Research Terminal',exact:true}).waitFor();
  const unit=name.startsWith('mobile')?page.locator('article:visible'):page.locator('table:visible tbody tr');
  await unit.first().waitFor();
  assert.equal(await unit.count(),1,'the previous dense board folds book/side quotes into one prop');
  assert.equal(await page.locator('[data-release="canonical-workspace-v1"]').count(),0,'rejected layout is not mounted');
  await page.waitForFunction(()=>[...document.querySelectorAll('img[data-player-photo]')].filter(n=>n.getBoundingClientRect().width>0).every(n=>n.complete&&n.naturalWidth>0));
  const imgSrc=await page.locator('img[data-player-photo]:visible').first().getAttribute('src');
  assert.ok(new URL(imgSrc,base).searchParams.get('url').includes('/nfl/players/full/42.png'));
  await page.screenshot({path:`${out}/${name}-board.png`,fullPage:true});
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].map(n=>({tag:n.tagName,className:typeof n.className==='string'?n.className:'',rect:n.getBoundingClientRect().toJSON(),minWidth:getComputedStyle(n).minWidth,display:getComputedStyle(n).display,position:getComputedStyle(n).position,text:n.textContent?.slice(0,80)})).filter(x=>x.rect.width&&x.rect.right>innerWidth+1).slice(0,30)}));
  await writeFile(`${out}/${name}-dimensions.json`,JSON.stringify(dimensions,null,2));
  if(dimensions.scrollWidth>dimensions.viewport+1)console.log('OVERFLOW_DIAGNOSTIC',JSON.stringify(dimensions));
  assert.ok(dimensions.scrollWidth<=dimensions.viewport+1,'restored board fits viewport');
  // A row's midpoint can hit an independent Over/Under button. The player
  // identity cell is the actual research-opening interaction being tested.
  if(name.startsWith('mobile'))await page.getByRole('button',{name:'Inspect',exact:true}).click();else await unit.first().locator('td').first().click();
  await page.getByLabel('Player inspector',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Player inspector',{exact:true}).locator('img[data-player-photo]').count(),1,'same photo component inside existing inspector');
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  failPhotos=true;await page.reload();
  await page.locator('img[data-player-photo="unavailable"]:visible').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[data-player-photo="unavailable"]')].every(n=>n.complete&&n.naturalWidth===128));
  assert.equal(await page.locator('img[data-player-photo="unavailable"]:visible').first().evaluate(n=>getComputedStyle(n).visibility),'visible','network errors never hide the image slot');
  failPhotos=false;await page.getByRole('button',{name:'WNBA',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[data-player-photo]')].some(n=>new URL(n.src).searchParams.get('url')?.includes('/wnba/players/full/84.png')&&n.complete&&n.naturalWidth>0));
  assert.equal(await page.locator('img[data-player-photo="unavailable"]').count(),0,'previous player failure does not leak into a new identity');
  assert.deepEqual(errors,[]);
  reports.push({viewport:name,passed:true,syntheticFixtures:true,checks:['previous-layout','multi-book-single-prop','blank-name-filter','image-loaded-under-production-CSP','inspector-photo','bounded-image-fallback','identity-reset','no-horizontal-overflow']});
  await context.close();
 }
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(reports,null,2));}
console.log(JSON.stringify({ok:true,reports}));
