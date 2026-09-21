// Read-only production QA. Uses an existing verified QA login only when configured.
// Never logs credentials, cookies, account payloads, or browser storage.
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base='https://www.obligeprops.com',out='artifacts/player-card-live';
await mkdir(out,{recursive:true});
const report={expectedCommit:process.env.EXPECTED_FRONTEND_SHA||process.env.GITHUB_SHA||null,observedCommit:null,publicCode:'UNVERIFIABLE',photos:[],authenticated:'UNVERIFIABLE',viewports:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(path){return fetch(new URL(path,base),{signal:AbortSignal.timeout(12000),headers:{'cache-control':'no-cache'}});}
async function deployed(){
 const r=await get('/board');if(!r.ok)return false;
 const html=await r.text();if(!html.includes('<meta name="oblige-surface" content="prop-board"'))return false;
 report.observedCommit=r.headers.get('x-oblige-revision');
 if(!report.observedCommit||(report.expectedCommit&&report.observedCommit!==report.expectedCommit))return false;
 const paths=[...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&')).filter(p=>p.startsWith('/_next/')))];
 for(const path of paths.slice(0,20)){const asset=await get(path);if(!asset.ok)continue;const js=await asset.text();if(js.includes('data-player-card')&&js.includes('playerCardKey'))return true;}
 return false;
}
let browser;
try{
 for(let i=0;i<24;i++){
  try{if(await deployed()){report.publicCode='PASS';break;}}catch{}
  await pause(10000);
 }
 assert.equal(report.publicCode,'PASS','The public /board must serve the deduplicated-card bundle');
 for(const [sport,name] of [['NFL','Patrick Mahomes'],['MLB','Shohei Ohtani']]){
  const path='/api/apex/player-artwork?'+new URLSearchParams({sport,name,v:'player-cards-2'});
  const r=await get(path),bytes=new Uint8Array(await r.arrayBuffer()),type=r.headers.get('content-type')||'';
  const valid=r.ok&&r.headers.get('x-artwork-status')==='verified'&&/^image\/(png|jpeg|webp)/.test(type)&&bytes.length>1000;
  report.photos.push({sport,name,status:r.status,type,bytes:bytes.length,verified:valid});
  assert.ok(valid,`Real verified ${sport} artwork must be delivered, not an initials card`);
 }
 const email=process.env.REFERENCE_VISUAL_EMAIL,password=process.env.REFERENCE_VISUAL_PASSWORD;
 if(!email||!password){report.authenticatedReason='Existing verified QA credentials are not configured; no authenticated production-board claim is made.';}
 else{
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
  const login=await context.request.post(base+'/api/account/login',{data:{email,password,rememberMe:false},headers:{origin:base,referer:base+'/board'}});
  const me=await context.request.get(base+'/api/account/me'),identity=await me.json().catch(()=>null);
  if(!login.ok()||identity?.authenticated!==true){report.authenticatedReason='Existing QA login was not accepted; no registration or access bypass attempted.';}
  else{
   const page=await context.newPage();
   for(const [name,viewport] of [['mobile390',{width:390,height:844}],['desktop1440',{width:1440,height:1000}]]){
    await page.setViewportSize(viewport);await page.goto(base+'/board',{waitUntil:'domcontentloaded'});
    await page.locator('[data-player-card]:visible').first().waitFor({timeout:45000});
    const keys=await page.locator('[data-player-card]:visible').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-player-card')));
    assert.equal(new Set(keys).size,keys.length,'Actual visible player/game cards must not repeat');
    await page.waitForFunction(()=>[...document.querySelectorAll('img[data-player-photo]')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.top<innerHeight&&r.bottom>0;}).every(n=>n.complete),null,{timeout:15000}).catch(()=>{});
    const photos=await page.locator('[data-player-card]:visible img[data-player-photo]').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;}).map(n=>({loaded:n.complete&&n.naturalWidth>0,fallback:n.getAttribute('data-player-photo')==='unavailable'})));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Actual board fits viewport');
    await page.screenshot({path:`${out}/${name}-board.png`,fullPage:false});
    // The last button is Research in both layouts; quote buttons must not be clicked.
    await page.locator('[data-player-card]:visible').first().locator('button').last().click();
    await page.waitForURL(/\/research\?/,{timeout:15000});
    await page.getByLabel('Player stat category',{exact:true}).waitFor({timeout:45000});
    const categories=await page.getByLabel('Player stat category',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
    assert.equal(new Set(categories).size,categories.length,'Actual stat selector must not repeat categories');
    await page.getByLabel('Selected book',{exact:true}).waitFor();
    await page.screenshot({path:`${out}/${name}-research.png`,fullPage:false});
    report.viewports.push({viewport:name,cards:keys.length,duplicateCards:keys.length-new Set(keys).size,statCategories:categories.length,visiblePhotos:photos});
   }
   report.authenticated='PASS';
  }
  await context.close();
 }
}catch(error){report.failure=error instanceof assert.AssertionError?error.message:'Production verification could not complete; see scoped status fields.';process.exitCode=1;}
finally{await browser?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
