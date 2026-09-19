// Synthetic browser fixtures only; no production research or provider calls.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.WORKSPACE_TEST_ORIGIN||'http://127.0.0.1:3100';
const out='artifacts/research-cooldown';await mkdir(out,{recursive:true});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const browser=await chromium.launch();let report={status:'FAILING'};
try {
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await page.clock.install();let calls=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());let body,status=200;
  if(u.pathname==='/api/account/me')body={authenticated:true,user:{id:'synthetic-cooldown-user'}};
  else if(u.pathname==='/api/apex/props')body={ok:true,supportedSports:['NFL'],props:[{sport:'NFL',playerName:'Fixture Player',providerPlayerId:'espn:42',eventId:'fixture-event',market:'Passing Yards',marketId:'player_pass_yds',line:200.5,price:-110,side:'OVER',sportsbook:'Fixture Book',sportsbookKey:'fixture-book',homeTeam:'Test Home',awayTeam:'Test Away'}]};
  else if(u.pathname==='/api/apex/research'){
   calls++;if(calls===1)return route.fulfill({status:429,headers:{'retry-after':'60'},contentType:'application/json',body:JSON.stringify({code:'RATE_LIMITED',message:'Too many research requests. Try again shortly.'})});
   body={ok:true,available:true,gameLog:[{date:'2050-09-17',gameId:'fixture-game',value:241,played:true,opponent:'Test Other',isHome:true}]};
  }else if(u.pathname==='/api/apex/player-artwork')return route.fulfill({status:200,contentType:'image/png',body:pixel});
  else{body={};status=404;}
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(base+'/research?sport=NFL&player=Fixture%20Player&market=Passing%20Yards&line=200.5');
 await page.getByText('Research temporarily paused',{exact:true}).first().waitFor();
 const retry=page.getByRole('button',{name:/Retry in \d+s/});await retry.waitFor();assert.equal(await retry.isDisabled(),true);
 await page.clock.fastForward(5000);assert.equal(calls,1,'no early five-second retry');assert.equal(await retry.isDisabled(),true);
 assert.equal(await page.getByText('Verified history unavailable',{exact:true}).count(),0,'429 is not missing history');
 await page.screenshot({path:out+'/mobile-paused.png',fullPage:true});
 await page.clock.fastForward(55000);const ready=page.getByRole('button',{name:'Retry research',exact:true});await ready.waitFor();assert.equal(await ready.isEnabled(),true);await ready.click();
 await page.getByText('1 of 1 verified games',{exact:true}).waitFor();assert.equal(calls,2,'one intentional retry after the complete cooldown');
 await page.screenshot({path:out+'/mobile-recovered.png',fullPage:true});assert.deepEqual(errors,[]);
 report={status:'HEALTHY',syntheticFixtures:true,researchCalls:calls,checks:['full-60-second-cooldown','no-early-retry','rate-limit-is-not-missing-history','manual-recovery','mobile-layout']};
} finally {await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
