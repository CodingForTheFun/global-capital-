/** Real integrated server/account routes. Sports data is explicitly fixture-only. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {analyzeResearch} from '../lib/analytics/research.mjs';
const out='artifacts/research-home';await mkdir(out,{recursive:true});
const dir=await mkdtemp(path.join(tmpdir(),'autoscout-home-qa-'));
const base='http://127.0.0.1:3025';
const env={...process.env,PORT:'3025',DATA_DIR:dir,NODE_ENV:'production',ACCOUNT_BETA_OPEN:'true',REQUIRE_ACCOUNT:'true',ACCOUNT_OWNER_EMAIL:'owner@fixture.invalid',DASHBOARD_SESSION_SECRET:randomBytes(32).toString('hex'),AUTOPROP_MASTER_KEY:randomBytes(32).toString('hex'),AUTO_SCAN_MINUTES:'0',THE_ODDS_API_KEY:'',SPORTSDATAIO_API_KEY:'',CLEARSPORTS_API_KEY:'',GEMINI_API_KEY:'',ANTHROPIC_API_KEY:''};
const proc=spawn(process.execPath,['frontdoor-clearsports.mjs'],{env,stdio:['ignore','pipe','pipe']});
let log='',browser,page,paidRequests=0;const checks=[],errors=[];
proc.stdout.on('data',c=>log+=c);proc.stderr.on('data',c=>log+=c);
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('RESEARCH_HOME_PASS',label);};
const now=Date.now(),email='research-home@fixture.invalid',password=randomBytes(18).toString('hex');
const games=Array.from({length:12},(_,i)=>({gameId:`fixture-${i}`,date:new Date(now-(i+1)*86400000).toISOString(),value:20+i,minutes:30,season:2026,completed:true,isHome:i%2===0,opponent:'NY'}));
const research={available:true,ok:true,sport:'NBA',player:{id:'qa-player',playerName:'QA Research Athlete',team:'BOS'},gameLog:games,season:2026,matchup:{opponent:'NY'},coverage:{seasonComplete:false},source:'Isolated synthetic test fixture'};
const quotes=['Fixture Book A','Fixture Book B'].flatMap((book,j)=>['OVER','UNDER'].map(side=>({id:`qa-${j}-${side}`,eventId:'qa-event',playerId:'qa-player',playerName:'QA Research Athlete',sport:'NBA',team:'BOS',marketId:'player_points',market:'Points',side,line:24.5+j,price:-110,sportsbookKey:book,sportsbook:book,providerUpdatedAt:new Date(now-60000).toISOString(),gameStartTime:new Date(now+86400000).toISOString(),awayTeam:'New York Knicks',homeTeam:'Boston Celtics',isAlternate:false})));
async function fixtures(ctx){
 await ctx.addInitScript(()=>localStorage.setItem('autoscout-sport','NBA'));
 await ctx.route('**/api/apex/props?*',r=>r.fulfill({json:{props:quotes,data:{lines:quotes.map(q=>({id:q.id,propId:'qa-prop'})),players:[{id:'qa-player',team:'BOS'}]},meta:{fetchedAt:new Date(now).toISOString(),events:1,sportsbookCount:2}}}));
 await ctx.route('**/api/apex/research?*',r=>{const u=new URL(r.request().url());return r.fulfill({json:analyzeResearch(research,Number(u.searchParams.get('line')),u.searchParams.get('side'))});});
 await ctx.route('**/api/apex/research-batch',r=>{const b=r.request().postDataJSON();return r.fulfill({json:{ok:true,results:Object.fromEntries(b.props.map(p=>[p.key,analyzeResearch(research,p.line,p.side)]))}});});
 await ctx.route('**/api/apex/player-artwork?*',r=>r.fulfill({status:404,body:''}));
 await ctx.route('**/api/apex/taco-offers?*',r=>r.fulfill({json:{offers:[],available:false,message:'No verified Taco offers in this test fixture.'}}));
}
async function ready(){await page.locator('#as5[data-product="autoscout"]').waitFor();await page.locator('.asCard').first().waitFor();await page.waitForFunction(()=>document.getElementById('asResearchBatch')?.textContent==='Visible research loaded');}
try{
 let healthy=false;for(let i=0;i<100;i++){try{healthy=(await fetch(base+'/api/health')).ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,400));}
 check(healthy,'Original server starts without a Next.js child process');
 const gate=await(await fetch(base)).text();check(gate.includes('asResearchGate')&&gate.includes('id="authForm"'),'Root uses original Auto Scout account form');
 check(!gate.includes('ObligePay')&&!gate.includes('Betslip with Kelly'),'Signed-out branding and features are research-only');
 for(const api of ['/api/apex/props','/api/apex/research','/api/apex/research-batch','/api/apex/line-history','/api/props/ml'])check((await fetch(base+api)).status===401,api+' remains account protected');
 for(const url of ['/sportsbooks','/sportsbooks/','/preview']){const r=await fetch(base+url,{redirect:'manual'});check(r.status===302&&r.headers.get('location')==='/apex',url+' redirects to existing Auto Scout');}
 check((await fetch(base+'/api/apex/game-markets')).status===410,'Retired game endpoint cannot request sportsbook odds');
 browser=await chromium.launch({headless:true});
 for(const [name,viewport] of [['desktop',{width:1600,height:1100}],['mobile',{width:390,height:844}]]){
  const ctx=await browser.newContext({viewport});await fixtures(ctx);page=await ctx.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/api\/props\/(ask|project)(?:\?|$)/.test(r.url()))paidRequests++;});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  if(name==='mobile')await page.locator('#tabIn').click();
  await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#submit').click();await ready();
  check(true,name+' signs in through the native account form');
  check((await page.title()).startsWith('Auto Scout'),name+' uses Auto Scout product identity');
  check(!(await page.locator('#as5').innerText()).includes('ObligePay'),name+' has no ObligePay product wording');
  check(await page.locator('.edge-workspace-nav,#asSlip,.asSlipAdd').count()===0,name+' has no sportsbook navigation or bet slip');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' root has no horizontal overflow');
  check(await page.locator('.asIdentity').getAttribute('href')==='/',name+' brand opens same-domain research home');
  await page.screenshot({path:`${out}/${name}-research.png`,fullPage:true});
  await page.locator('#asSearch').fill('No Matching Fixture');await page.waitForFunction(()=>document.querySelectorAll('.asCard').length===0);
  await page.locator('#asSearch').fill('');await page.locator('.asCard').first().waitFor();check(true,name+' existing player filter still works');
  await page.keyboard.press('Control+k');check(await page.locator('#asSearch').evaluate(e=>e===document.activeElement),name+' keyboard search shortcut works');
  await page.locator('#asi-open').click();await page.locator('#asi-sensitivity').waitFor();
  check(await page.locator('#asIntelligenceDetail details').count()===8,name+' retains all eight Intelligence tools');
  await page.locator('#asLinePlus').click();await page.locator('#asLinePlus').click();await page.locator('[data-side="UNDER"]').click();
  const actual=(await page.locator('#asi-sensitivity tr.active td').nth(1).textContent()).trim();
  check(actual===Math.round(analyzeResearch(research,25.5,'UNDER').windows.l10.hitRate)+'%',name+' line/side changes preserve the shared research math');
  await page.screenshot({path:`${out}/${name}-intelligence.png`,fullPage:false});
  await page.keyboard.press('Escape');check(await page.locator('.asDrawerBg.on').count()===0,name+' drawer closes normally');
  if(name==='desktop'){
   await page.locator('.asSave[data-fav]').first().click();await page.waitForFunction(()=>document.querySelector('.asSave[data-fav]')?.getAttribute('aria-pressed')==='true');
   const saved=await(await ctx.request.get(base+'/api/saved-props')).json();check(saved.saved?.length>0,'Saved props persist through the ORIGINAL authenticated API');
  }else{
   const saved=await(await ctx.request.get(base+'/api/saved-props')).json();check(saved.saved?.length>0,'Existing server-bound saves survive a fresh mobile sign-in');
  }
  await page.locator('#asSettings').click();check(await page.locator('#asUtility').evaluate(e=>e.open),name+' original settings open');await page.keyboard.press('Escape');
  await page.goto(base+'/sportsbooks#tacos',{waitUntil:'domcontentloaded'});await page.waitForURL('**/apex#tacos');
  await page.getByRole('heading',{name:'🌮 Taco-only props',exact:true}).waitFor();check(true,name+' old Taco bookmark opens Auto Scout-only promotion view');
  await page.getByRole('button',{name:'Back to regular props',exact:true}).click();check(await page.locator('#asRules').getAttribute('aria-checked')==='true',name+' regular-line protections remain on');
  await page.goto(base);await ready();
  await ctx.close();
 }
 check(paidRequests===0,'No automatic paid Ask or projection requests');
 check(errors.length===0,'No JavaScript page exceptions: '+errors.join('; '));
 check(!/Next.js guest dashboard ready|guest startup timed out/.test(log),'Retired Next.js service is not running');
 console.log(JSON.stringify({passed:checks.length,checks,errors,fixtureData:true,paidRequests,productionAccountsCreated:false},null,2));
}catch(error){await page?.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${out}/failure.json`,JSON.stringify({error:error.stack,url:page?.url(),checks,errors},null,2));throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify({passed:checks.length,checks,errors,fixtureData:true,paidRequests},null,2));await browser?.close();proc.kill('SIGTERM');await writeFile(`${out}/server.log`,log);await rm(dir,{recursive:true,force:true}).catch(()=>{});}
