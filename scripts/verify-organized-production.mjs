// Verify the deployed, authenticated research board; no mocked source responses.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base='https://autoprop-live-production.up.railway.app';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir('artifacts/organized-board',{recursive:true});
let ready=false;
for(let n=0;n<24;n++){
 const r=await fetch(base+'/assets/lib/ui/prop-board.mjs',{signal:AbortSignal.timeout(12000)}).catch(()=>null);
 if(r?.ok&&(await r.text()).includes('uniquePlayerCards')){ready=true;break;}
 await sleep(10000);
}
assert.ok(ready,'Categorized board assets must be served by the actual deployment');
const registration=await fetch(base+'/api/account/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`smoke-${Date.now()}-board@smoke.autoscout.test`,password:`Smoke-${crypto.randomUUID()}!`}),signal:AbortSignal.timeout(15000)});
assert.ok(registration.ok,'Normal account registration required for authenticated QA');
const cookie=registration.headers.getSetCookie().map(c=>c.split(';')[0]).find(c=>c.startsWith('sp_account='));
assert.ok(cookie,'Account session is required; never bypass the account gate');
const [cookieName,...cookieParts]=cookie.split('=');
const browser=await chromium.launch({headless:true});
const report={scope:'Deployed signed-in board, actual upstream data, no interception or fixtures',viewports:[]};
try{
 for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]] ){
  const ctx=await browser.newContext({viewport});
  await ctx.addCookies([{name:cookieName,value:cookieParts.join('='),url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage(),errors=[],photos=new Map();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async r=>{if(r.url().includes('/api/apex/player-artwork?')){const h=await r.allHeaders();photos.set(r.url(),{status:r.status(),verified:h['x-artwork-status']==='verified',type:h['content-type']});}});
  await page.goto(base+'/apex',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForSelector('#asPropTypes .asTypeChip',{timeout:60000});
  await page.waitForSelector('.asCard .asResearchState.ready',{timeout:90000});
  const cards=await page.locator('.asCard').evaluateAll(nodes=>nodes.map(n=>({name:n.querySelector('.asPlayer')?.textContent,market:n.querySelector('.asCardMarket')?.textContent,metrics:[...n.querySelectorAll('.asBadge')].map(b=>({name:b.querySelector('small')?.textContent,value:b.querySelector('b')?.textContent})),history:n.querySelector('.asResearchState')?.textContent})));
  assert.ok(cards.length>0&&cards.length<=20);
  assert.equal(new Set(cards.map(c=>c.name)).size,cards.length,'No repeated player cards in selected prop type');
  assert.ok(cards.some(c=>c.metrics.some(m=>m.name==='L5'&&/^\d+(\.\d+)?%$/.test(m.value||''))),'Real rendered L5 values must be visible');
  await page.waitForFunction(()=>[...document.querySelectorAll('.asAvatar img')].some(i=>i.complete&&i.naturalWidth>128),null,{timeout:60000});
  assert.ok([...photos.values()].some(p=>p.verified&&p.status===200&&p.type?.startsWith('image/')),'Verified upstream photo response must reach the browser');
  const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
  assert.ok(noOverflow);assert.deepEqual(errors,[]);
  await page.screenshot({path:`artifacts/organized-board/${label}.png`,fullPage:true});
  await page.locator('[data-prop-type="all"]').click();
  await page.waitForSelector('.asCard [data-card-choice]',{timeout:30000});
  const allNames=await page.locator('.asCard .asPlayer').allTextContents();
  assert.equal(new Set(allNames).size,allNames.length,'All-players view must also avoid duplicate cards');
  assert.ok(await page.locator('.asCard [data-card-choice] option').count()>1);
  report.viewports.push({label,category:cards[0]?.market,visiblePlayers:cards.length,noRepeatedPlayers:true,groupedAllPlayers:true,noOverflow,pageErrors:errors,verifiedPhotoResponses:[...photos.values()].filter(p=>p.verified).length,sampleCards:cards.slice(0,3)});
  await ctx.close();
 }
 await writeFile('artifacts/organized-board/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
