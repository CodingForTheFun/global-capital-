// Browser-only synthetic fixtures. All /api requests are intercepted; no account,
// provider or production record is created. Live-origin mode verifies SHIPPED UI
// code, not authenticated live sports data. The visible name labels that distinction.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BOARD_PREMIUM_ORIGIN||'http://127.0.0.1:3100';
const out=process.env.BOARD_PREMIUM_OUTPUT||'artifacts/board-premium';
await mkdir(out,{recursive:true});
const photo=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#12283f"/><circle cx="64" cy="46" r="23" fill="#5c718a"/><path d="M14 128v-13a50 50 0 0 1 100 0v13" fill="#5c718a"/><text x="64" y="120" fill="white" text-anchor="middle" font-family="sans-serif" font-size="16">UI TEST</text></svg>');
const names={NFL:['player_reception_longest','Longest Reception'],WNBA:['player_points','Points'],MLB:['batter_total_bases','Total Bases'],NHL:['player_shots_on_goal','Shots on Goal'],TENNIS:['player_aces','Aces'],CS2:['player_kills','Kills']};
function rows(sport){
 const stat=(names[sport]||names.NFL)[0],common={sport,playerName:'UI Test Player',providerPlayerId:'espn:42',market:stat,marketId:stat,line:22.5,gameStartTime:'2050-09-20T18:00:00Z',homeTeam:'Test Home',awayTeam:'Test Away',team:'QA',opponent:'TST'};
 return [[stat,stat],[sport==='NFL'?'player_reception_yds':'player_assists',sport==='NFL'?'player_reception_yds':'player_assists'],[stat+' · First half',stat]].flatMap(([market,marketId],mi)=>['draftkings','fanduel'].flatMap(book=>(book==='draftkings'?[22.5]:[23.5,24.5]).flatMap(line=>['OVER','UNDER'].map(side=>({...common,market,marketId,line,eventId:`fixture-${book}`,id:`${sport}-${mi}-${book}-${line}-${side}`,sportsbook:book==='draftkings'?'DraftKings':'FanDuel',sportsbookKey:book,price:side==='OVER'?-115:-105,side})))))
}
const results=[];let browser;
try{
 browser=await chromium.launch();
 for(const width of [375,390,430,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],historyCalls=[];let signedIn=true,failPhotos=false,privateCalls=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/_next/image?**',route=>failPhotos?route.abort():route.fulfill({status:200,contentType:'image/svg+xml',body:photo}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body,status=200;
   if(url.pathname==='/api/account/me')body={authenticated:signedIn,...(signedIn?{user:{id:'synthetic-ui-test-user'}}:{})};
   else if(!signedIn){privateCalls++;status=401;body={ok:false};}
   else if(url.pathname==='/api/apex/props'){const sport=url.searchParams.get('sport')||'NFL';body={ok:true,props:rows(sport),supportedSports:Object.keys(names),meta:{sportsbookCount:2}};}
   else if(url.pathname==='/api/apex/research'){
    const market=url.searchParams.get('market')||'';historyCalls.push({market,sport:url.searchParams.get('sport'),line:url.searchParams.get('line')});
    body=market.includes('First half')?{ok:true,available:false,message:'UI test: exact first-half history unavailable.',gameLog:[]}:{ok:true,available:true,source:'UI TEST FIXTURE - NOT LIVE SPORTS DATA',gameLog:Array.from({length:20},(_,i)=>({gameId:`test-${i}`,date:`2049-09-${String(28-i).padStart(2,'0')}T00:00:00Z`,opponent:i%2?'TST':'QA',value:i===6?null:12+i,isHome:i%2===0,season:2049}))};
   }else if(url.pathname==='/api/props/ml')body={ok:true,results:{}};
   else if(url.pathname==='/api/apex/player-artwork')return failPhotos?route.abort():route.fulfill({status:200,contentType:'image/svg+xml',body:photo});
   else if(url.pathname==='/api/apex/stream')return route.fulfill({status:200,contentType:'text/event-stream',body:'event: ready\ndata: {}\n\n'});
   else{status=404;body={ok:false};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  // Use the actual deployed board's click handler, not a handcrafted canonical URL.
  await page.goto(base+'/board',{waitUntil:'domcontentloaded'});
  const card=page.locator('[data-player-card]:visible').first();await card.waitFor({timeout:30000});
  assert.equal(await page.locator('[data-player-card]:visible').count(),1,'Existing cross-book deduplication is preserved');
  const researchButton=card.getByRole('button',{name:'Research',exact:true});
  if(await researchButton.count())await researchButton.click();else await card.locator('td').first().click();
  await page.waitForURL(/\/research\?/);
  const opened=new URL(page.url());assert.equal(opened.searchParams.get('player'),'UI Test Player');assert.equal(opened.searchParams.has('playerKey'),false,'Reproduce the legacy link path missed by the original deployment');
  const main=page.locator('main[data-research-route="legacy-board-premium-v2"]');await main.waitFor();
  await page.getByLabel('Player stat category',{exact:true}).selectOption({label:'Longest Reception'});await page.locator('.op-chart-bar').first().waitFor();
  assert.ok(!(await main.innerText()).match(/\b(?:player|batter|pitcher)_[a-z_]+\b/),'Raw provider keys never appear in the visible research page');
  assert.equal(await page.locator('.player-cinematic-hero').count(),0,'The old oversized research renderer is not mounted');
  assert.equal(await page.locator('.op-research-title:visible').count(),0,'No repeated player-research form heading');
  assert.equal(await page.getByLabel('Player stat category').locator('option').count(),3,'All legacy stat/period choices retained');
  assert.equal(await page.getByRole('group',{name:'Stat categories',exact:true}).locator('button').count(),2,'Stat rail is not duplicated per book or period');
  const count=historyCalls.length;
  await page.getByLabel('Selected book',{exact:true}).selectOption('fanduel');await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='23.5');
  await page.getByLabel('Posted line or outcome').selectOption('24.5');await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='24.5');
  await page.getByLabel('Selected book',{exact:true}).selectOption('draftkings');await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='22.5');
  await page.getByLabel('Selected book',{exact:true}).selectOption('');assert.equal(await page.getByLabel('Selected book',{exact:true}).inputValue(),'','Best prices retained');
  await page.getByRole('button',{name:'Raise research line',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='23');
  assert.equal(historyCalls.length,count,'Book/line adjustments reuse the existing category history');
  assert.ok(historyCalls.some(call=>call.market==='player_reception_longest'),'Raw API identity is unchanged in data requests');
  assert.equal(await page.locator('.op-filter-editor').count(),0,'Recent one-tap filter fix is preserved');
  await page.getByLabel('Opponent',{exact:true}).selectOption('QA');
  await page.getByLabel('Season',{exact:true}).selectOption('2049');
  await page.getByLabel('Opponent',{exact:true}).selectOption('all');assert.equal(await page.getByLabel('Season',{exact:true}).inputValue(),'2049','Individual filter changes do not clear other filters');
  await page.getByRole('button',{name:'Follow UI Test Player',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Unfollow UI Test Player',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('group',{name:'Available game periods',exact:true}).getByRole('button',{name:'1H',exact:true}).click();
  await page.getByText('UI test: exact first-half history unavailable.',{exact:true}).waitFor();assert.equal(await page.locator('.op-chart-bar').count(),0,'No substituted full-game history for a half');
  if(width===390)await main.screenshot({path:`${out}/width-${width}-unavailable.png`});
  await page.getByRole('group',{name:'Available game periods',exact:true}).getByRole('button',{name:'Full game',exact:true}).click();await page.locator('.op-chart-bar').first().waitFor();
  await page.evaluate(()=>scrollTo(0,0));
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,heroHeight:document.querySelector('main[data-design] header')?.getBoundingClientRect().height,chartTop:document.querySelector('.op-chart-section')?.getBoundingClientRect().top}));
  assert.ok(dimensions.scrollWidth<=width+1,'No horizontal page overflow');assert.ok(dimensions.heroHeight<210,'Compact identity hero');assert.ok(dimensions.chartTop<900,'Chart not buried below repeated oversized fields');
  await main.screenshot({path:`${out}/width-${width}.png`});
  // Saved legacy links without card/category IDs must use the same component for every sport.
  if(width===390)for(const [sport,[stat,title]] of Object.entries(names)){
   await page.goto(base+'/research?'+new URLSearchParams({sport,player:'UI Test Player',market:stat,line:'22.5'}));await main.waitFor();await page.locator('.op-chart-bar').first().waitFor();assert.ok(await main.getByRole('heading',{name:title,exact:true}).count()>0,`${sport}: readable label on saved link`);assert.equal(await page.locator('.player-cinematic-hero').count(),0);
  }
  failPhotos=true;await page.reload();await main.waitFor();await page.locator('img[data-player-photo="unavailable"]:visible').first().waitFor();
  assert.equal(await page.locator('img[data-player-photo="unavailable"]:visible').first().evaluate(node=>getComputedStyle(node).visibility),'visible','Missing artwork has a visible bounded fallback');
  signedIn=false;privateCalls=0;await page.reload();await page.getByRole('button',{name:/sign in/i}).first().waitFor();assert.equal(await main.count(),0,'Private research hidden when signed out');assert.equal(privateCalls,0,'No private data requests before authentication');
  assert.deepEqual(errors,[],'No runtime exceptions');
  results.push({width,passed:true,origin:base,syntheticFixtures:true,actualBoardClick:true,savedLinkSports:width===390?Object.keys(names):[],signedOutPrivateRequests:privateCalls,...dimensions});await context.close();
 }
}catch(error){await writeFile(`${out}/failure.txt`,String(error));throw error;}
finally{await browser?.close();await writeFile(`${out}/report.json`,JSON.stringify({syntheticFixtures:true,authenticatedLiveData:false,results},null,2));}
console.log(JSON.stringify({ok:true,syntheticFixtures:true,authenticatedLiveData:false,results}));
