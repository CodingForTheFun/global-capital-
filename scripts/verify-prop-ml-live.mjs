/** Actual deployed integration/state verification. No mocked forecasts or Taco metadata. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {verifiedTaco} from '../lib/ui/offer-promotion.mjs';
const base='https://autoprop-live-production.up.railway.app';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir('artifacts/prop-ml-live',{recursive:true});
let ready=false;
for(let i=0;i<30;i++){
  const r=await fetch(base+'/assets/lib/ui/ml-prediction.mjs',{signal:AbortSignal.timeout(12000)}).catch(()=>null);
  if(r?.ok&&(await r.text()).includes('createMLClient')){ready=true;break;}
  await pause(8000);
}
assert.ok(ready,'New ML integration assets must be live, not an old deployment');
const promo=await fetch(base+'/assets/lib/ui/offer-promotion.mjs',{signal:AbortSignal.timeout(12000)});
assert.ok(promo.ok&&(await promo.text()).includes('verifiedTaco'));
const anon=await fetch(base+'/api/props/ml',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({props:[]})});
assert.equal(anon.status,401,'Existing signed-in gate must protect the ML route');
const registration=await fetch(base+'/api/account/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`smoke-${Date.now()}-ml@smoke.autoscout.test`,password:`Smoke-${crypto.randomUUID()}!`}),signal:AbortSignal.timeout(15000)});
assert.ok(registration.ok,'Authenticated QA requires normal registration; no gate bypass');
const cookie=registration.headers.getSetCookie().map(c=>c.split(';')[0]).find(c=>c.startsWith('sp_account='));
assert.ok(cookie);const [name,...values]=cookie.split('=');
const browser=await chromium.launch({headless:true});
const report={scope:'Actual authenticated production state; no intercepted network, mocked predictions or generated Taco offers',anonymousStatus:anon.status,viewports:[]};
try{
  for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
    const context=await browser.newContext({viewport});
    await context.addCookies([{name,value:values.join('='),url:base,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage(),errors=[],rows=new Map();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',async response=>{
      if(response.url().includes('/api/apex/props')&&response.ok()){
        try{for(const r of (await response.json()).props||[])rows.set(r.id,r);}catch{}
      }
    });
    const pages=[];
    for(const path of ['/apex','/sportsbooks']){
      await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForSelector('.asML',{timeout:90000});
      await page.waitForFunction(()=>[...document.querySelectorAll('.asML')].length>0&&![...document.querySelectorAll('.asML')].some(e=>e.dataset.mlState==='loading'),null,{timeout:60000});
      const state=await page.locator('.asML').evaluateAll(nodes=>nodes.map(n=>({state:n.dataset.mlState,hasNumericForecast:!!n.querySelector('.asMLGrid'),label:n.innerText.slice(0,300)})));
      assert.ok(state.length>0);
      assert.ok(state.every(s=>s.state==='READY'||!s.hasNumericForecast),'Missing models must never invent numeric forecasts');
      if(path==='/apex')assert.equal(await page.locator('.asCard .asML').count(),await page.locator('.asCard').count(),'Each visible player prop needs exactly one ML panel');
      const badges=await page.locator('.asTacoBadge').evaluateAll(nodes=>nodes.map(n=>n.dataset.tacoOffer));
      for(const offer of badges)assert.ok(verifiedTaco(rows.get(offer)),'Taco must match the exact live source offer');
      assert.equal(await page.locator('.asCardHead .asTacoBadge').count(),0,'Tacos must not mark a player header');
      const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert.ok(noOverflow);
      await page.screenshot({path:`artifacts/prop-ml-live/${label}-${path.slice(1)}.png`,fullPage:true});
      pages.push({path,panels:state.length,readyPredictions:state.filter(s=>s.state==='READY').length,modelStates:[...new Set(state.map(s=>s.state))],tacoBadges:badges.length,exactTacoBinding:true,noOverflow,sample:state.slice(0,2)});
    }
    assert.deepEqual(errors,[]);report.viewports.push({label,pages,pageErrors:errors});await context.close();
  }
  await writeFile('artifacts/prop-ml-live/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
