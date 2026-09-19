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
  let failPhotos=false,researchCalls=0;
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
    const common={sport,playerName,providerPlayerId,eventId:'fixture-event',market:'Points',marketId:'player_points',line:20.5,price:-110,gameStartTime:'2050-09-20T18:00:00Z',homeTeam:'Test Home',awayTeam:'Test Away',team:'TEST',opponent:'OPP'};
    const props=['Points','Rebounds','Points · First half'].flatMap((market,mi)=>['book-a','book-b'].flatMap(book=>(book==='book-b'?[21.5,22.5]:[20.5]).flatMap(line=>['OVER','UNDER'].map(side=>({...common,market,marketId:mi===1?'player_rebounds':'player_points',line,id:`${sport}-${mi}-${book}-${line}-${side}`,sportsbook:book,sportsbookKey:book,side})))));
    props.push({...props[0]},{...props[0],id:'no-id-duplicate',providerPlayerId:null},{...common,id:'blank-row',playerName:''});
    body={ok:true,props,supportedSports:['NFL','WNBA'],meta:{sportsbookCount:2}};
   }else if(u.pathname==='/api/apex/research'){researchCalls++;body={ok:true,available:false,message:'Synthetic test: verified history unavailable.',gameLog:[]};}
   else if(u.pathname==='/api/props/ml')body={ok:true,results:{}};
   else if(u.pathname==='/api/apex/player-artwork'){
    if(failPhotos)return route.abort();
    return route.fulfill({status:200,contentType:'image/png',body:pixel});
   }else if(u.pathname==='/api/apex/stream')return route.fulfill({status:200,contentType:'text/event-stream',body:'event: ready\ndata: {}\n\n'});
   return route.fulfill({status:body?200:404,contentType:'application/json',body:JSON.stringify(body||{})});
  });
  await page.goto(base+'/board');
  await page.getByLabel('Opponent').waitFor();
  const unit=page.locator('table:visible tbody tr');
  await unit.first().waitFor();
  assert.equal(await unit.count(),1,'one player/game row despite duplicate ingestion, three stats, multiple lines and books');
  assert.equal(await page.getByText('Apply',{exact:true}).count(),0,'filters update directly without an Apply box');
  assert.equal(await page.getByText('Clear',{exact:true}).count(),0,'filters update directly without a Clear box');
  for(const label of ['Opponent','Stat','Season','Home/Away','Team','Book','Line','More filters'])assert.equal(await page.getByLabel(label).count(),1,`compact ${label} filter exists`);
  await page.waitForFunction(()=>[...document.querySelectorAll('img[data-player-photo]')].filter(n=>n.getBoundingClientRect().width>0).every(n=>n.complete&&n.naturalWidth>0));
  const imgSrc=await page.locator('img[data-player-photo]:visible').first().getAttribute('src');
  assert.ok(new URL(imgSrc,base).searchParams.get('url').includes('/nfl/players/full/42.png'));
  await page.screenshot({path:`${out}/${name}-board.png`,fullPage:true});
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  await writeFile(`${out}/${name}-dimensions.json`,JSON.stringify(dimensions,null,2));
  assert.ok(dimensions.scrollWidth<=dimensions.viewport+1,'premium board keeps overflow inside the table scroller');
  await unit.first().locator('td').first().click();
  await page.getByLabel('Player stat category',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Player inspector',{exact:true}).count(),0,'no intermediate inspector');
  assert.equal(await page.getByLabel('Player stat category').locator('option').count(),3,'one category per stat, not per book/line');
  await page.getByLabel('Player stat category').selectOption({label:'Points'});
  await page.getByText('Synthetic test: verified history unavailable.',{exact:true}).first().waitFor();
  const historyBefore=researchCalls;
  await page.getByLabel('Selected book',{exact:true}).selectOption('book-b');
  await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='21.5');
  assert.equal(await page.getByLabel('Posted line or outcome').locator('option').count(),2);
  await page.getByLabel('Posted line or outcome').selectOption('22.5');
  await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='22.5');
  await page.getByLabel('Selected book',{exact:true}).selectOption('book-a');
  await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='20.5');
  assert.equal(researchCalls,historyBefore,'changing book/line reuses the same game sample');
  await page.locator('img[data-player-photo]:visible').first().waitFor();
  await page.screenshot({path:`${out}/${name}-player-research.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'player controls fit viewport');
  await page.goto(base+'/board');
  failPhotos=true;await page.reload();
  await page.locator('img[data-player-photo="unavailable"]:visible').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[data-player-photo="unavailable"]')].every(n=>n.complete&&n.naturalWidth===128));
  assert.equal(await page.locator('img[data-player-photo="unavailable"]:visible').first().evaluate(n=>getComputedStyle(n).visibility),'visible','network errors never hide the image slot');
  failPhotos=false;await page.getByRole('button',{name:'WNBA',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[data-player-photo]')].some(n=>new URL(n.src).searchParams.get('url')?.includes('/wnba/players/full/84.png')&&n.complete&&n.naturalWidth>0));
  assert.equal(await page.locator('img[data-player-photo="unavailable"]').count(),0,'old failures do not leak into new players');
  assert.deepEqual(errors,[]);
  reports.push({viewport:name,passed:true,syntheticFixtures:true,checks:['premium-board','one-player-per-game','direct-dropdown-filters','no-apply-clear-panel','blank-name-filter','image-loaded-under-production-CSP','direct-research-photo','unique-stat-categories','book-specific-lines','no-extra-history-calls-on-book-line-change','bounded-image-fallback','identity-reset','no-document-horizontal-overflow']});
  await context.close();
 }
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(reports,null,2));}
console.log(JSON.stringify({ok:true,reports}));
