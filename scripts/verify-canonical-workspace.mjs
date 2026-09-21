// Isolated, explicitly synthetic UI fixtures. No paid API calls or production data.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.WORKSPACE_TEST_ORIGIN||'http://127.0.0.1:3100';
const output='artifacts/canonical-workspace';await mkdir(output,{recursive:true});
async function checkWidth(page,name){
 await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 const diagnostic=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].map(n=>({tag:n.tagName,id:n.id,className:typeof n.className==='string'?n.className:'',rect:n.getBoundingClientRect().toJSON(),minWidth:getComputedStyle(n).minWidth,position:getComputedStyle(n).position,text:n.textContent?.slice(0,90)})).filter(x=>x.rect.width&&x.rect.right>innerWidth+1).slice(0,25)}));
 if(diagnostic.scrollWidth>diagnostic.viewport+1){console.log('OVERFLOW_DIAGNOSTIC',JSON.stringify(diagnostic));await writeFile(`${output}/${name}-overflow.json`,JSON.stringify(diagnostic,null,2));}
 assert.ok(diagnostic.scrollWidth<=diagnostic.viewport+1,`${name}: no horizontal page overflow`);
}
const sports=[{key:'football_nfl',title:'NFL',active:true},{key:'golf',title:'Golf',active:true},{key:'esports_rocket_league',title:'Rocket League',active:true},{key:'future_league',title:'Future League',active:false}];
const offer=(book,line,side='OVER',price=100)=>({key:`${book}:${line}:${side}`,outcomeId:`test:${book}:${line}:${side}`,book,bookName:book==='draftkings'?'DraftKings':book==='fanduel'?'FanDuel':'PrizePicks',line,choice:side,side,price,multiplier:null,updatedAt:new Date().toISOString(),dfs:book==='prizepicks',conflict:false});
function fixture(sport){
 const event={id:'test-event',sport,startsAt:'2050-09-20T18:00:00Z',homeTeam:'Test Home',awayTeam:'Test Away',status:'scheduled',aliases:[]};
 const markets=[{key:'rush',marketKey:'player_rush_yds',label:sport==='golf'?'Score':'Rushing yards',period:null,variant:'standard',offers:[offer('draftkings',sport==='golf'?-1.5:50.5),offer('draftkings',sport==='golf'?-1.5:50.5,'UNDER'),offer('fanduel',55.5),offer('fanduel',60.5),offer('prizepicks',45.5)]},{key:'receptions',marketKey:'player_receptions',label:'Receptions',period:null,variant:'standard',offers:[offer('draftkings',3.5)]},{key:'half',marketKey:'player_rush_yds',label:'Rushing yards · Period h1',period:'h1',variant:'standard',offers:[offer('draftkings',20.5)]}];
 return {ok:true,event,fetchedAt:new Date().toISOString(),players:[{key:`player:${sport}`,playerId:'test:1',name:'Fixture Player',aliases:['Fixture Player'],sport,eventId:event.id,startsAt:event.startsAt,homeTeam:event.homeTeam,awayTeam:event.awayTeam,markets}]};
}
const results=[];
const browser=await chromium.launch();
try{
 for(const [name,viewport] of [['mobile390',{width:390,height:844}],['desktop1440',{width:1440,height:1000}]]){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],targets=[];
  page.on('pageerror',e=>errors.push(e.message));
  let failHistory=0,historyRequests=0;
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());let body,status=200;
   if(u.pathname==='/api/account/me')body={authenticated:true,user:{id:'fixture-user'}};
   else if(u.pathname==='/api/oblige-workspace'){
    const action=u.searchParams.get('action'),sport=u.searchParams.get('sport')||'football_nfl',f=fixture(sport);
    if(action==='catalog')body={ok:true,sports};
    else if(action==='events')body={ok:true,events:[f.event]};
    else if(action==='event')body=f;
    else if(action==='history'){
     historyRequests++;
     if(failHistory>0){failHistory--;status=502;body={ok:false,message:'Fixture transient history failure'};}
     else if(u.searchParams.get('market')==='half')body={ok:true,available:false,message:'Exact period history unavailable.',gameLog:[]};
     else body={ok:true,available:true,source:'Synthetic UI test fixture',gameLog:Array.from({length:20},(_,i)=>({gameId:`test-${i}`,date:`2049-09-${String(28-i).padStart(2,'0')}T00:00:00Z`,opponent:'Test Opponent',value:sport==='golf'?(i%5)-3:i%2?60:40,isHome:i%2===0,season:2049}))};
    }else if(action==='model'){targets.push(u.searchParams.get('offer'));body={ok:true,prediction:{available:true,code:'READY',modelVersion:'SYNTHETIC-TEST-ONLY',projection:52,probabilityOver:.5,probabilityUnder:.4,probabilityPush:.1,generatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),validation:{method:'chronological-heldout-real-lines',events:100}}};}
   }
   if(body)await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});else await route.fulfill({status:404,contentType:'application/json',body:'{}'});
  });
  await page.goto(base+'/research?'+new URLSearchParams({sportKey:'football_nfl',event:'test-event',playerKey:'player:football_nfl',category:'rush'}));
  await page.getByLabel('Selected book',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Player stat category').locator('option').count(),3,'one stat category, not a tab per book/line');
  assert.deepEqual(await page.getByLabel('Selected book',{exact:true}).locator('option').allTextContents(),['DraftKings'],'hero selector contains only books carrying the displayed line');
  await page.getByRole('button',{name:'Select FanDuel',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='55.5');
  await page.getByLabel('Posted line or outcome').selectOption('60.5');
  await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='60.5');
  assert.deepEqual(await page.getByLabel('Selected book',{exact:true}).locator('option').allTextContents(),['FanDuel'],'line change keeps the hero selector exact-line only');
  await page.getByRole('button',{name:'Select PrizePicks',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.op-line-number')?.textContent==='45.5');
  assert.ok(await page.getByLabel('Trained model prediction').innerText().then(t=>!t.includes('Selected-quote EV\n+')),'no synthetic DFS singles EV');
  // Exhaust both bounded automatic attempts before asserting the manual recovery UI.
  failHistory=2;const beforeFailure=historyRequests;await page.getByLabel('Player stat category').selectOption('receptions');
  await page.getByRole('button',{name:'Retry history',exact:true}).waitFor();
  assert.equal(historyRequests-beforeFailure,2,'history automatically retries at most once');
  await page.getByRole('button',{name:'Retry history',exact:true}).click();await page.locator('.recharts-bar-rectangle').first().waitFor();
  assert.equal(historyRequests-beforeFailure,3,'manual retry performs a new successful request');
  await page.getByLabel('Player stat category').selectOption('half');
  await page.getByText('Exact period history unavailable.',{exact:true}).waitFor();
  assert.equal(await page.locator('.op-sample').count(),0,'compact unavailable history instead of empty stat tiles');
  await page.getByLabel('Player stat category').selectOption('rush');await page.locator('.recharts-bar-rectangle').first().waitFor();
  await checkWidth(page,`${name}-research`);
  assert.ok(targets.includes('fanduel:60.5:OVER'),'prediction requested exact selected book and line');
  await page.goto(base+'/research?'+new URLSearchParams({sportKey:'golf',event:'test-event',playerKey:'player:golf',category:'rush'}));
  await page.locator('.recharts-bar-rectangle').first().waitFor();
  assert.equal(await page.locator('.op-line-number').textContent(),'-1.5');
  await page.getByRole('button',{name:'Lower research line',exact:true}).click();assert.equal(await page.locator('.op-line-number').textContent(),'-2');
  assert.ok(await page.locator('.recharts-bar-rectangle').evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>{const b=n.getBoundingClientRect(),plot=n.closest('svg').getBoundingClientRect();return b.height>=0&&b.top>=plot.top&&b.bottom<=plot.bottom;})),'negative result bars stay within plot');
  assert.deepEqual(errors,[],'no runtime errors');
  results.push({viewport:name,passed:true,syntheticFixtures:true,checks:['canonical-shared-link','unique-stat-categories','book-switch','line-switch','exact-model-target','DFS-no-single-EV','history-retry','compact-unavailable','no-page-overflow','negative-history']});
  await context.close();
 }
}finally{await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(results,null,2));}
console.log(JSON.stringify({ok:true,results}));
