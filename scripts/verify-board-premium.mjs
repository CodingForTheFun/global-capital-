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
const names={NFL:['player_reception_longest','Longest Reception'],WNBA:['player_points','Points'],MLB:['batter_total_bases','Total Bases'],NHL:['player_shots_on_goal','Shots on Goal'],TENNIS:['player_aces','Aces'],CS2:['player_kills','Kills'],NBA:['player_points','Points'],NCAAF:['player_pass_yds','Passing Yards'],NCAAB:['player_points','Points'],SOCCER:['player_shots','Shots'],CRICKET:['player_runs','Runs'],ROCKETLEAGUE:['player_goals','Goals']};
function rows(sport){
 const stat=(names[sport]||names.NFL)[0],common={sport,provider:'propline',proplineEventId:`native-${sport}`,proplinePlayerId:'espn:42',playerName:'UI Test Player',providerPlayerId:'espn:42',market:stat,marketId:stat,line:22.5,gameStartTime:'2050-09-20T18:00:00Z',homeTeam:'Test Home',awayTeam:'Test Away',team:'QA',opponent:'TST'};
 return [[stat,stat],[sport==='NFL'?'player_reception_yds':'player_assists',sport==='NFL'?'player_reception_yds':'player_assists'],[stat+' · First half',stat]].flatMap(([market,marketId],mi)=>['draftkings','fanduel'].flatMap(book=>(book==='draftkings'?[22.5]:[23.5,24.5]).flatMap(line=>['OVER','UNDER'].map(side=>({...common,market,marketId,line,eventId:`fixture-${book}`,id:`${sport}-${mi}-${book}-${line}-${side}`,proplineOutcomeId:`${sport}-${mi}-${book}-${line}-${side}`,sportsbook:book==='draftkings'?'DraftKings':'FanDuel',sportsbookKey:book,price:side==='OVER'?-115:-105,side})))))
}
const results=[];let browser;
try{
 browser=await chromium.launch();
 for(const width of [375,390,430,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],historyCalls=[],privatePaths=[];let signedIn=true,failPhotos=false,specialMode=false,referenceMode=false,manyMode=false,holdModel=false,modelCalls=0,activeHistory=0,maxHistory=0;let releaseModel;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/_next/image?**',route=>failPhotos?route.abort():route.fulfill({status:200,contentType:'image/svg+xml',body:photo}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body,status=200;
   if(url.pathname==='/api/account/me')body={authenticated:signedIn,...(signedIn?{user:{id:'synthetic-ui-test-user'}}:{})};
   // SignInPanel asks whether to display Google sign-in. This is public config,
   // not protected player data; all other signed-out API calls remain failures.
   else if(url.pathname==='/api/account/google/status')body={available:false};
   else if(!signedIn){privatePaths.push(url.pathname);status=401;body={ok:false};}
   else if(url.pathname==='/api/apex/props'){const sport=url.searchParams.get('sport')||'NFL';const standard=rows(sport),seed=standard[0];
    const special=(flavor,line,extra={})=>({...seed,id:`ui-${flavor}-${line}`,proplineOutcomeId:`ui-${flavor}-${line}`,line,sportsbook:'PrizePicks',sportsbookKey:'prizepicks',price:100,dfsOddsType:flavor,specialType:flavor,specialVerified:true,isAlternate:true,...extra});
    if(sport==='NFL')for(const quote of standard){Object.assign(quote,{homeTeam:'NE Patriots',awayTeam:'PIT Steelers',team:'PIT',opponent:'NE'});if(quote.sportsbookKey==='draftkings')quote.playerName='UI Test Player (PIT)';}
    body={ok:true,props:specialMode?[...standard,special('goblin',16.5),special('demon',26.5),special('demon',30.5,{playerName:'UI Test Special Only',providerPlayerId:'fixture:special-only'})]:standard,supportedSports:Object.keys(names),meta:{sportsbookCount:specialMode?3:2}};}
   else if(url.pathname==='/api/apex/research'){
    if(manyMode){activeHistory++;maxHistory=Math.max(maxHistory,activeHistory);await new Promise(resolve=>setTimeout(resolve,75));activeHistory--;}
    assert.ok(!(url.searchParams.get('playerName')||'').includes('(PIT)'),'Verified team tags never enter history lookups');
    const market=url.searchParams.get('market')||'';historyCalls.push({market,sport:url.searchParams.get('sport'),line:url.searchParams.get('line')});
    body=market.includes('First half')?{ok:true,available:false,message:'UI test: exact first-half history unavailable.',gameLog:[]}:{ok:true,available:true,source:'UI TEST FIXTURE - NOT LIVE SPORTS DATA',gameLog:Array.from({length:20},(_,i)=>({gameId:`test-${i}`,date:`2049-09-${String(28-i).padStart(2,'0')}T00:00:00Z`,opponent:i%2?'TST':'QA',value:i===6?null:12+i,isHome:i%2===0,season:2049}))};
   }else if(url.pathname==='/api/props/ml'){
    modelCalls++;if(referenceMode&&holdModel)await new Promise(resolve=>{releaseModel=resolve;});
    const targets=route.request().postDataJSON()?.props||[];assert.ok(targets.length<=24,'Model service batch limit');
    body={ok:true,results:Object.fromEntries(targets.map(target=>[target.key,(target.isAlternate||referenceMode)?{available:false,code:'MARKET_NOT_SUPPORTED',message:'UI test: no model for alternate lines.'}:{available:true,code:'READY',modelVersion:'UI-TEST-ONLY',projection:24,probabilityOver:.6,probabilityUnder:.4,probabilityPush:0,validation:{method:'rolling-player-history'},expiresAt:new Date(Date.now()+600000).toISOString()}]))};
   }
   else if(url.pathname==='/api/apex/propline'){
    const kind=url.searchParams.get('kind'),sport=url.searchParams.get('sport')||'NFL';
    assert.equal(url.searchParams.get('eventId'),`native-${sport}`,'Only native provider event IDs reach insights');
    body={available:true,data:kind==='projections'?{projections:[...new Set(rows(sport).map(row=>row.marketId))].map(marketKey=>({playerId:'espn:42',playerName:'UI Test Player',marketKey,projection:24.3,booksContributing:4}))}:kind==='ev'?{plays:rows(sport).map(row=>({playerId:'espn:42',playerName:row.playerName,marketKey:row.marketId,line:row.line,price:row.price,bookmakerKey:row.sportsbookKey,side:row.side,evPercent:4.5}))}:kind==='history'?{points:[{outcomeId:'ui-goblin-16.5',marketKey:names.NFL[0],bookmakerKey:'prizepicks',side:'OVER',line:15.5,price:100,at:'2049-09-20T10:00:00Z'},{outcomeId:'different-outcome',marketKey:names.NFL[0],bookmakerKey:'prizepicks',side:'OVER',line:99.5,price:100,at:'2049-09-20T10:00:00Z'}]}:null};
   }
   else if(url.pathname==='/api/apex/player-artwork')return failPhotos?route.abort():route.fulfill({status:200,contentType:'image/svg+xml',body:photo});
   else if(url.pathname==='/api/apex/stream')return route.fulfill({status:200,contentType:'text/event-stream',body:'event: ready\ndata: {}\n\n'});
   else{status=404;body={ok:false};}
   if(manyMode&&url.pathname==='/api/apex/props')body.props=Array.from({length:30},(_,i)=>body.props.map(row=>({...row,playerName:`UI Player ${String(i).padStart(2,'0')}`,providerPlayerId:`espn:${100+i}`,id:`${row.id}-${i}`}))).flat();
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  // Use the actual deployed board's click handler, not a handcrafted canonical URL.
  await page.goto(base+'/board',{waitUntil:'domcontentloaded'});
  const card=page.locator('[data-player-card]:visible').first();await card.waitFor({timeout:30000});
  assert.equal(await page.locator('[data-player-card]:visible').count(),1,'Existing cross-book deduplication is preserved');
  await page.locator('[data-label="Hit rate"] > div > span').first().filter({hasText:/[0-9]/}).waitFor();
  assert.equal(modelCalls,0,'Initial board never waits for or requests optional models');
  assert.equal(await page.locator('[data-design="alpha"]').count(),1,'Alpha is the shared board layout');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Cards fit viewport');
  await page.screenshot({path:`${out}/width-${width}-cards.png`,fullPage:true});
  if(width===390||width===1440)console.log(`REFERENCE_CARDS_${width}=`+(await page.screenshot({type:'jpeg',quality:50})).toString('base64'));
  const researchButton=card.getByRole('button',{name:'Research',exact:true});
  if(await researchButton.count())await researchButton.click();else await card.getByRole('button',{name:'Research UI Test Player',exact:true}).click();
  await page.waitForURL(/\/research\?/);
  const opened=new URL(page.url());assert.equal(opened.searchParams.get('player'),'UI Test Player');assert.equal(opened.searchParams.has('playerKey'),false,'Reproduce the legacy link path missed by the original deployment');
  const main=page.locator('[data-research-route="legacy-board-premium-v2"]');await main.waitFor();
  await page.getByLabel('Player stat category',{exact:true}).selectOption({label:'Longest Reception'});await page.locator('.op-chart-bar').first().waitFor();
  assert.ok(!(await main.innerText()).match(/\b(?:player|batter|pitcher)_[a-z_]+\b/),'Raw provider keys never appear in the visible research page');
  assert.equal(await page.locator('.player-cinematic-hero').count(),0,'The old oversized research renderer is not mounted');
  assert.equal(await page.locator('.op-research-title:visible').count(),0,'No repeated player-research form heading');
  assert.equal(await page.getByLabel('Player stat category').locator('option').count(),3,'All legacy stat/period choices retained');
  assert.equal(await page.getByRole('group',{name:'Stat categories',exact:true}).locator('button').count(),2,'Stat rail is not duplicated per book or period');
  const count=historyCalls.length;
  await page.getByRole('button',{name:'Select FanDuel',exact:true}).click();await page.waitForURL(value=>new URL(value).searchParams.get('book')==='fanduel');await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='23.5');
  await page.getByLabel('Posted line or outcome').selectOption('24.5');await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='24.5');
  await page.getByRole('button',{name:'Select DraftKings',exact:true}).click();await page.waitForURL(value=>new URL(value).searchParams.get('book')==='draftkings');await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='22.5');
  await page.getByRole('button',{name:'Raise research line',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='23');
  await page.getByRole('button',{name:'Select DraftKings',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='22.5');
  assert.equal(await page.locator('.op-line-number').textContent(),'22.5','Explicit quote reselection resets the adjusted analysis line');
  await page.getByLabel('Selected book',{exact:true}).selectOption('');
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Selected book"]')?.value===''&&!new URL(location.href).searchParams.has('book'));
  assert.equal(await page.getByLabel('Selected book',{exact:true}).inputValue(),'','Best prices retained');
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
  const failedCalls=historyCalls.length;await page.getByRole('button',{name:'Retry history',exact:true}).click();await page.waitForFunction(()=>!!document.querySelector('.op-no-history'));await page.waitForTimeout(100);assert.ok(historyCalls.length>failedCalls,'HTTP 200 unavailable history can be retried');
  if(width===390)await main.screenshot({path:`${out}/width-${width}-unavailable.png`});
  await page.getByRole('group',{name:'Available game periods',exact:true}).getByRole('button',{name:'Full game',exact:true}).click();await page.locator('.op-chart-bar').first().waitFor();
  await page.evaluate(()=>scrollTo(0,0));
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,heroHeight:document.querySelector('[data-research-hero]')?.getBoundingClientRect().height,chartTop:document.querySelector('.op-chart-section')?.getBoundingClientRect().top}));
  assert.ok(dimensions.scrollWidth<=width+1,'No horizontal page overflow');
  const heroBounds=await page.locator('[data-research-hero]').boundingBox();assert.ok(heroBounds.x>=0&&heroBounds.x+heroBounds.width<=width+1,'Identity is fully inside mobile viewport');
  assert.equal(await page.locator('main main').count(),0,'A single main landmark');assert.ok(dimensions.heroHeight<210,'Compact identity hero');assert.ok(dimensions.chartTop<900,'Chart not buried below repeated oversized fields');
  await main.screenshot({path:`${out}/width-${width}.png`});
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  if(width===390)console.log('REFERENCE_RESEARCH_390='+(await page.screenshot({type:'jpeg',quality:50})).toString('base64'));
  // Previously saved provider-tagged URLs still find the clean player and load history.
  if(width===390){await page.goto(base+'/research?'+new URLSearchParams({sport:'NFL',player:'UI Test Player (PIT)',market:names.NFL[0],line:'22.5'}));await main.waitFor();await page.locator('.op-chart-bar').first().waitFor();assert.ok(!(await main.innerText()).includes('(PIT)'));}
  // Saved legacy links without card/category IDs must use the same component for every sport.
  if(width===390)for(const [sport,[stat,title]] of Object.entries(names)){
   await page.goto(base+'/research?'+new URLSearchParams({sport,player:'UI Test Player',market:stat,line:'22.5'}));await main.waitFor();await page.locator('.op-chart-bar').first().waitFor();assert.ok(await main.getByRole('heading',{name:title,exact:true}).count()>0,`${sport}: readable label on saved link`);assert.equal(await page.locator('.player-cinematic-hero').count(),0);
  }
  failPhotos=true;await page.reload();await main.waitFor();await page.locator('img[data-player-photo="unavailable"]:visible').first().waitFor();
  assert.equal(await page.locator('img[data-player-photo="unavailable"]:visible').first().evaluate(node=>getComputedStyle(node).visibility),'visible','Missing artwork has a visible bounded fallback');
  specialMode=true;failPhotos=false;await page.goto(base+'/board');
  await page.getByRole('link',{name:'Goblin',exact:true}).first().waitFor();
  assert.equal(await page.locator('[data-player-card]').count(),2,'Special-only player retained');
  await page.getByRole('button',{name:'Forecast',exact:true}).first().click();
  await page.locator('[data-label="Proj"]').filter({hasText:'24.0'}).first().waitFor();
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByLabel('Prop type',{exact:true}).selectOption('demon');
  assert.equal(await page.locator('[data-player-card]').count(),2,'Demon filter keeps both players');
  assert.equal(await page.locator('[data-label="Odds"]').filter({hasText:'+100'}).count(),0,'Synthetic DFS odds hidden');
  await page.getByRole('link',{name:'Demon',exact:true}).first().click();await main.waitFor();
  await page.locator('.op-chart-bar').first().waitFor();
  assert.equal(await page.getByLabel('Selected book',{exact:true}).inputValue(),'prizepicks');
  await page.getByLabel('Player stat category',{exact:true}).selectOption({label:'Longest Reception · Goblin'});
  await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='16.5');
  assert.ok(await page.locator('[data-variant="goblin"]').count()>0,'Green Goblin label in research');
  const specialDimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(specialDimensions.scroll<=specialDimensions.width+1,'Variant controls fit the existing mobile layout');
  await main.screenshot({path:`${out}/width-${width}-specials.png`});
  if(width===390){
   await page.getByText('Line history',{exact:true}).click();
   const history=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Line history'})});
   await history.getByRole('cell',{name:'15.5',exact:true}).waitFor();
   assert.equal(await history.getByRole('cell',{name:'99.5',exact:true}).count(),0,'Other outcome history never leaks into the selected quote');
   assert.equal(await history.getByRole('cell',{name:'+100',exact:true}).count(),0,'History does not present synthetic DFS odds');
   referenceMode=true;holdModel=true;specialMode=false;await page.goto(base+'/board');
   await page.getByRole('button',{name:'Forecast',exact:true}).first().click();
   await page.locator('[data-label="Proj"]').filter({hasText:'24.3'}).first().waitFor();
   await page.getByText('Market implied',{exact:true}).first().waitFor();
   await page.getByText('Market no-vig',{exact:true}).first().waitFor();
   assert.ok(releaseModel,'Market reference appears while model response is still pending');releaseModel();holdModel=false;
   await page.locator('[data-player-card]').first().getByRole('button',{name:'Research',exact:true}).click();await main.waitFor();
   await page.getByRole('heading',{name:'Market reference',exact:true}).waitFor();
  }
  if(width===390){
   manyMode=true;referenceMode=false;specialMode=false;historyCalls.length=0;modelCalls=0;
   await page.goto(base+'/board');await page.locator('[data-player-card]').first().waitFor();
   await page.waitForFunction(()=>document.querySelectorAll('[data-player-card]').length===12);
   await page.locator('[data-label="Hit rate"] > div > span').last().filter({hasText:/[—0-9]/}).waitFor();
   assert.equal(historyCalls.length,12,'Only the first 12 visible players request history');assert.ok(maxHistory<=3,'At most three history requests in flight');assert.equal(modelCalls,0);
   const firstNames=await page.locator('[data-player-card]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-player-card')));
   await page.getByRole('button',{name:'Next',exact:true}).click();
   await page.waitForFunction(first=>!first.includes(document.querySelector('[data-player-card]')?.getAttribute('data-player-card')),firstNames);
   assert.equal(await page.locator('[data-player-card]').count(),12,'Next page is reachable');
   await page.getByRole('button',{name:/^Save UI Player/}).first().click();
   await page.getByRole('button',{name:'Show saved props',exact:true}).click();
   assert.equal(await page.locator('[data-player-card]').count(),1,'Saved navigation shows the chosen card');
   await page.reload();await page.locator('[data-player-card]').first().waitFor();await page.getByRole('button',{name:'Show saved props',exact:true}).click();
   assert.equal(await page.locator('[data-player-card]').count(),1,'Saved cards survive reload');
   await page.getByRole('button',{name:'Show saved props',exact:true}).click();
   await page.getByRole('textbox',{name:'Search players, teams, or props',exact:true}).fill('UI Player 29');
   await page.waitForFunction(()=>document.querySelectorAll('[data-player-card]').length===1);
   assert.ok((await page.locator('[data-player-card]').innerText()).includes('UI Player 29'),'Search reaches beyond the first page');
   manyMode=false;
  }
  signedIn=false;privatePaths.length=0;await page.reload();await page.getByRole('button',{name:/sign in/i}).first().waitFor();assert.equal(await main.count(),0,'Private research hidden when signed out');assert.deepEqual(privatePaths,[],'No protected data requests before authentication');
  assert.deepEqual(errors,[],'No runtime exceptions');
  results.push({width,passed:true,origin:base,syntheticFixtures:true,actualBoardClick:true,savedLinkSports:width===390?Object.keys(names):[],signedOutPrivateRequests:privatePaths.length,...dimensions});await context.close();
 }
}catch(error){await writeFile(`${out}/failure.txt`,String(error));throw error;}
finally{await browser?.close();await writeFile(`${out}/report.json`,JSON.stringify({syntheticFixtures:true,authenticatedLiveData:false,results},null,2));}
console.log(JSON.stringify({ok:true,syntheticFixtures:true,authenticatedLiveData:false,results}));
