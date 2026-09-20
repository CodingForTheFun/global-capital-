import { chromium } from 'playwright';

const BASE = process.env.AUTOSCOUT_PUBLIC_URL || 'https://autoprop-live-production.up.railway.app';
const EXPECTED_SHA = process.env.AUTOSCOUT_EXPECTED_SHA || '';
const SPORTS = (process.env.AUTOSCOUT_SMOKE_SPORTS || 'NFL,MLB').split(',').map(v=>v.trim()).filter(Boolean);
const SMOKE_EMAIL = String(process.env.AUTOSCOUT_SMOKE_EMAIL || '').trim();
const SMOKE_PASSWORD = String(process.env.AUTOSCOUT_SMOKE_PASSWORD || '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForHealth() {
  let last = 'no response';
  for (let i=0;i<18;i++) {
    try {
      const r=await fetch(`${BASE}/api/health`,{cache:'no-store'});
      const b=await r.json();
      if(r.ok&&b?.ok===true&&b?.service==='autoscout-apex'&&b?.provider?.configured===true&&(!EXPECTED_SHA||b.revision===EXPECTED_SHA))return b;
      last=`HTTP ${r.status} service=${b?.service||'unknown'} revision=${b?.revision||'none'}`;
    } catch(error){last=error?.message||String(error);}
    await sleep(10_000);
  }
  throw new Error(`Production health did not become ready: ${last}`);
}

async function sessionCookie() {
  const h=await fetch(`${BASE}/api/account/health`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(h?.gate?.active!==true)return null;
  if(!SMOKE_EMAIL||!SMOKE_PASSWORD)throw new Error('Authenticated production smoke requires a pre-provisioned AUTOSCOUT_SMOKE_EMAIL and AUTOSCOUT_SMOKE_PASSWORD; it will not create customer accounts.');
  if(h?.password?.available!==true)throw new Error('Account gate is active but password sign-in is unavailable.');
  const r=await fetch(`${BASE}/api/account/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:SMOKE_EMAIL,password:SMOKE_PASSWORD,rememberMe:false})});
  const b=await r.json().catch(()=>null);
  if(!r.ok||b?.ok!==true)throw new Error(`Could not sign in smoke account: HTTP ${r.status} ${b?.code||''}`.trim());
  const values=r.headers.getSetCookie?r.headers.getSetCookie():[];
  const cookie=values.map(v=>String(v).split(';')[0]).find(v=>v.startsWith('sp_account='));
  if(!cookie)throw new Error('Smoke sign-in returned no session cookie.');
  return cookie;
}

const requestInit = cookie => cookie?{cache:'no-store',headers:{cookie}}:{cache:'no-store'};
const validProp = row => row?.playerName&&row?.sportsbook&&Number.isFinite(Number(row.line))&&['OVER','UNDER'].includes(row.side)&&(row.providerUpdatedAt||row.updatedAt)&&row.ingestedAt;

async function verifyApi(cookie) {
  const init=requestInit(cookie), results=[];let sample=null;
  for(const sport of SPORTS){
    const r=await fetch(`${BASE}/api/apex/props?sport=${encodeURIComponent(sport)}`,init);
    if(!r.ok)throw new Error(`${sport} prop API returned HTTP ${r.status}`);
    const b=await r.json();
    const props=Array.isArray(b?.props)?b.props:[];
    results.push({sport,lines:Number(b?.meta?.lineCount??props.length),events:Number(b?.meta?.events||0),books:Number(b?.meta?.sportsbookCount||0),provider:b?.meta?.provider||null,cacheHit:b?.meta?.cacheHit===true,databaseConfigured:b?.persistence?.configured===true});
    sample ||= props.find(validProp)||null;
  }
  if(!sample)throw new Error('No complete real prop was available for the live smoke sports.');
  if(!sample.autoScout||!Array.isArray(sample.autoScout.checks)||!sample.autoScout.checks.length)throw new Error('Sample prop is missing Auto Scout rule audit.');

  const u=new URL(`${BASE}/api/apex/research`);
  for(const [k,v] of Object.entries({sport:sample.sport,playerName:sample.playerName,market:sample.market,line:sample.line,side:sample.side,team:sample.team||'',homeTeam:sample.homeTeam||'',awayTeam:sample.awayTeam||'',games:20}))u.searchParams.set(k,String(v));
  const rr=await fetch(u,init);if(!rr.ok)throw new Error(`Research API returned HTTP ${rr.status}`);
  const research=await rr.json();
  if(research?.ok!==true)throw new Error(`Research API returned unsafe failure shape: ${research?.code||'unknown'}`);
  if(research.available===true&&(!Array.isArray(research.gameLog)||!research.gameLog.length))throw new Error('Available research has no verified history rows.');
  if(research.available!==true&&!String(research.code||research.message||'').trim())throw new Error('Unavailable research gave no explanation.');

  let matchup={ok:true,available:false,code:'MATCHUP_IDENTITY_INCOMPLETE'};
  const keys=['sport','eventId','homeTeam','awayTeam','gameStartTime'];
  if(keys.every(k=>String(sample[k]||'').trim())){
    const mu=new URL(`${BASE}/api/apex/research-matchup`);for(const k of keys)mu.searchParams.set(k,String(sample[k]));
    const mr=await fetch(mu,init);matchup=await mr.json().catch(()=>null);
    if(!mr.ok||matchup?.ok!==true)throw new Error('Matchup research failed for a fully identified game.');
    if(matchup.available&&(matchup.eventId!==sample.eventId||Date.parse(matchup.gameStartTime)!==Date.parse(sample.gameStartTime)))throw new Error('Matchup research returned a different game.');
  }
  return {results,sample,research,matchup};
}

async function verifyBrowser(cookie){
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    if(cookie){const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),url:BASE,httpOnly:true,sameSite:'Lax'}]);}
    const page=await context.newPage(),urls=[];page.on('request',r=>urls.push(r.url()));
    const nav=await page.goto(`${BASE}/apex`,{waitUntil:'domcontentloaded',timeout:60_000});if(!nav?.ok())throw new Error(`Public /apex returned HTTP ${nav?.status()||'unknown'}`);
    await page.waitForSelector('#as5',{timeout:60_000});await page.waitForSelector('.asRow',{timeout:60_000});
    const rows=page.locator('.asRow'),count=await rows.count();if(count<1)throw new Error('No v5 prop row rendered.');
    for(const selector of ['#asSports','#asSearch','#asMarket','#asBooksOpen','#asSide','#asSort','#asSummary','#asList','.asBadges','.asOddsStrip','.asResearchState'])if(await page.locator(selector).count()<1)throw new Error(`Missing v5 surface: ${selector}`);

    const first=rows.first(),cardText=(await first.innerText()).trim();if(!cardText)throw new Error('First prop row rendered empty.');
    const odds=first.locator('.asOddsStrip'),oddsText=(await odds.innerText()).replace(/\s+/g,' ').trim();
    if(!/(?:^|\s)[OU]\s+-?\d/i.test(oddsText))throw new Error(`Production odds strip is missing its O/U side marker: ${oddsText.slice(0,160)}`);
    const badge=(await first.locator('.asBadges').innerText()).toUpperCase();for(const label of ['L5','L10','L15','H2H','STRK','AVG','DIFF','SZN'])if(!badge.includes(label))throw new Error(`Research badge missing: ${label}`);

    const avatar=first.locator('.asAvatar img');if(await avatar.count()){
      const src=await avatar.getAttribute('src');if(src){const ar=await fetch(new URL(src,BASE),requestInit(cookie));if(!ar.ok||!String(ar.headers.get('content-type')||'').toLowerCase().startsWith('image/'))throw new Error('Player artwork did not return an image.');}
    }

    await first.locator('.asPlayer').click();await page.waitForSelector('#asDrawerBg:not([hidden]) .asAnalyticsPage',{timeout:10_000});
    if(!page.url().includes('#prop/'))throw new Error('Prop click did not open analytics route.');
    if(!(await page.locator('.asNav').isVisible()))throw new Error('Global navigation is missing in analytics.');
    await page.waitForSelector('#asDrawerBody',{timeout:10_000});
    await page.waitForFunction(()=>{const x=document.querySelector('#asDrawerBody');return !!x&&(!!x.querySelector('.asSection')||!!x.querySelector('.asError'));},null,{timeout:30_000});
    const drawer=(await page.locator('#asDrawerBody').innerText()).trim();if(!drawer)throw new Error('Analytics drawer rendered empty.');
    const controls=await page.locator('#asMarketSwitch, #asLineMinus, #asLinePlus').count()>=1;
    const honest=/research availability|historical research|historical results|combo line only|fantasy line only|line only|historical hit rates are withheld|stat not reported|player match unavailable|no logs available/i.test(drawer);
    if(!controls&&!honest)throw new Error('Analytics exposes neither research controls nor an honest availability state.');
    if(urls.some(url=>/apiKey=|THE_ODDS_API_KEY|CLEARSPORTS_API_KEY|SPORTSDATAIO_API_KEY/i.test(url)))throw new Error('Provider credential appeared in browser URL.');
    return {cardCount:count,oddsPreview:oddsText.slice(0,180),analyticsVerified:true,researchControlsAvailable:controls};
  }finally{await browser.close();}
}

const before=await waitForHealth();
const cookie=await sessionCookie();
const api=await verifyApi(cookie);
const browser=await verifyBrowser(cookie);
const after=await waitForHealth();
if(after.startedAt!==before.startedAt)throw new Error('Data core restarted during smoke.');
const repeat=await fetch(`${BASE}/api/apex/props?sport=${encodeURIComponent(SPORTS[0]||'NFL')}`,requestInit(cookie));if(!repeat.ok)throw new Error(`Repeated board returned HTTP ${repeat.status}`);
const repeatBody=await repeat.json();if(repeatBody?.meta?.cacheHit!==true||!repeatBody?.props?.length)throw new Error('Repeated board was not a populated cache hit.');
console.log(JSON.stringify({ok:true,revision:after.revision,health:{provider:after.provider?.id,databaseConfigured:after.persistence?.configured===true},sports:api.results,sample:{sport:api.sample.sport,player:api.sample.playerName,market:api.sample.market,book:api.sample.sportsbook,side:api.sample.side,line:api.sample.line},research:{available:api.research.available===true,code:api.research.code||null,lineOnly:api.research.lineOnly===true},matchup:{available:api.matchup.available===true,code:api.matchup.code||null},browser,cacheVerified:true,stableProcess:true},null,2));
