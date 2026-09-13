// No production accounts, bets or payment writes. One bounded guest AI question.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const origin='https://www.obligepay.com';
const report={expected:process.env.GITHUB_SHA,observed:null,checks:[],browserErrors:[],productionAccountsCreated:false,realGuestAiCalls:0};
const check=(ok,label)=>{assert.ok(ok,label);report.checks.push(label);console.log('LIVE_PASS',label)};
let browser,page;
await mkdir('artifacts',{recursive:true});
try{
 for(let i=0;i<50;i++){
  try{const r=await fetch(origin+'/api/guest-health?check='+Date.now(),{signal:AbortSignal.timeout(8000),cache:'no-store'});const data=await r.json();if(r.ok&&data.release===report.expected){report.observed=data.release;break}}catch{}
  await new Promise(r=>setTimeout(r,8000));
 }
 check(report.observed===report.expected,'Exact promoted release serves public domain');
 const health=await(await fetch(origin+'/api/account/health')).json();
 report.features=health.features;
 check(health.features?.ask===true,'Ask recognizes configured provider');
 check(health.features?.projections===true,'Projection provider configured');
 check((await fetch(origin+'/api/health')).ok,'Core health');
 for(const route of ['game-markets','taco-offers'])check((await fetch(origin+'/api/apex/'+route+'?sport=NFL')).status===401,route+' remains account protected');
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1600,height:1050}});page.on('pageerror',e=>report.browserErrors.push(e.message));
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Game lines. Player props. Auto Scout.',exact:true}).waitFor();
 check(true,'Root serves main sportsbook interface, not sample preview');
 const nav=page.getByRole('navigation',{name:'Primary workspace navigation'}).filter({visible:true});const labels=await nav.locator('a').allTextContents();
 check(labels.at(-2)==='Tools'&&labels.at(-1)==='Auto Scout','Auto Scout remains beside Tools');
 await page.screenshot({path:'artifacts/sportsbook-live-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile viewport fits');
 await page.screenshot({path:'artifacts/sportsbook-live-mobile.png',fullPage:true});
 await page.goto(origin+'/preview',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Jayson Tatum',exact:true}).waitFor();
 check(true,'Original sample preview retained separately');
 const state=await page.request.get(origin+'/api/ask-prop');check(state.ok(),'Signed guest session established');
 const answer=await page.request.post(origin+'/api/ask-prop',{data:{prompt:'How many sample games finished above 26.5?',prop:{player:'Jayson Tatum',team:'BOS',opponent:'NYK',stat:'Points',line:26.5,pickDirection:'OVER',recentGameResults:[31,29,24,35,28]}}});report.realGuestAiCalls++;
 const result=await answer.json();report.guestAi={status:answer.status(),code:result.code||null,answer:result.answer||null};
 check(answer.ok()&&typeof result.answer==='string'&&result.answer.length>0,'One real Gemini card answer returned');
 const denied=await page.request.post(origin+'/api/ask-prop',{data:{prompt:'Again',prop:{}}});
 check(denied.status()===403&&(await denied.json()).code==='AUTH_REQUIRED','Second guest query blocked');
 check(report.browserErrors.length===0,'No public browser exceptions');
}catch(e){report.failure=e.message;await page?.screenshot({path:'artifacts/sportsbook-live-failure.png',fullPage:true}).catch(()=>{});throw e}
finally{await writeFile('artifacts/sportsbook-live-report.json',JSON.stringify(report,null,2));await browser?.close()}
