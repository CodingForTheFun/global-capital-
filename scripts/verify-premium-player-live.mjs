// Read-only production acceptance. Existing QA login only; no new account, auth bypass or provider refresh.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='https://www.obligeprops.com',out='artifacts/premium-player-live';
await mkdir(out,{recursive:true});
const report={publicBundle:'UNVERIFIABLE',routes:[],signedOut:'UNVERIFIABLE',authenticated:'UNVERIFIABLE',viewports:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const get=path=>fetch(new URL(path,base),{signal:AbortSignal.timeout(15000),headers:{'cache-control':'no-cache'}});
async function isDeployed(){
 const response=await get('/research');if(!response.ok)return false;
 const html=await response.text(),scripts=[...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1].replace(/&amp;/g,'&')).filter(path=>path.startsWith('/_next/')))];
 for(const path of scripts.slice(0,25)){const asset=await get(path);if(asset.ok&&(await asset.text()).includes('premium-player-research-v1'))return true;}
 return false;
}
let browser;
try{
 for(let attempt=0;attempt<24;attempt++){try{if(await isDeployed()){report.publicBundle='PASS';break;}}catch{}await pause(10000);}
 assert.equal(report.publicBundle,'PASS','Healthy www domain must serve the premium research bundle');
 for(const path of ['/board','/research','/api/health','/app.webmanifest','/app-worker.js']){
  const response=await get(path);report.routes.push({path,status:response.status});assert.equal(response.status,200,`${path} must remain available`);
 }
 const denied=await get('/api/oblige-workspace?action=catalog');assert.equal(denied.status,401,'Signed-out workspace stays protected');report.signedOut='PASS';
 const email=process.env.REFERENCE_VISUAL_EMAIL,password=process.env.REFERENCE_VISUAL_PASSWORD;
 if(!email||!password){report.authenticatedReason='Existing verified QA credentials are not configured. No authenticated production claim is made.';}
 else{
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
  const login=await context.request.post(base+'/api/account/login',{data:{email,password,rememberMe:false},headers:{origin:base,referer:base+'/board'}});
  const me=await context.request.get(base+'/api/account/me'),identity=await me.json().catch(()=>null);
  if(!login.ok()||identity?.authenticated!==true){report.authenticatedReason='Existing QA login was not accepted. No registration or access bypass attempted.';}
  else{
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   for(const width of [390,1440]){
    await page.setViewportSize({width,height:width===390?844:1000});await page.goto(base+'/board',{waitUntil:'domcontentloaded'});
    await page.locator('[data-player-card]:visible').first().waitFor({timeout:45000});
    await page.locator('[data-player-card]:visible').first().locator('button').last().click();await page.waitForURL(/\/research\?/,{timeout:20000});
    const main=page.locator('[data-design="premium-player-research-v1"]');await main.waitFor({timeout:60000});
    await page.waitForFunction(()=>!!document.querySelector('.op-chart-section,.op-no-history'),null,{timeout:60000}).catch(()=>{});
    assert.ok(!(await main.innerText()).match(/\bplayer_[a-z_]+\b/),'No raw market identifier in visible research');
    assert.equal(await page.locator('.op-research-title:visible').count(),0,'No repeated research form title');
    const book=page.getByLabel('Selected book',{exact:true});await book.waitFor();
    const options=await book.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
    if(options.length>1){await book.selectOption(options[1]);assert.equal(await book.inputValue(),options[1]);}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Actual research fits the viewport');
    const photo=await main.locator('img[data-player-photo]').evaluateAll(nodes=>nodes.map(node=>({loaded:node.complete&&node.naturalWidth>0,state:node.getAttribute('data-player-photo')})));
    // Crop to research, not the account header; never save authentication state or cookies.
    await main.screenshot({path:`${out}/width-${width}.png`});
    report.viewports.push({width,passed:true,bookCount:options.length,photos:photo,chartVisible:await page.locator('.op-chart-section').count()>0,unavailableHistory:await page.locator('.op-no-history').count()>0});
   }
   assert.deepEqual(errors,[],'No research runtime errors');report.authenticated='PASS';
  }
  await context.close();
 }
}catch(error){report.failure=error instanceof assert.AssertionError?error.message:'Production verification did not finish; inspect the scoped status fields.';process.exitCode=1;}
finally{await browser?.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
