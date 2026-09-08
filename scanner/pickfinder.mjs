import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { evaluatePick, buildDiversifiedCard, numberOrNull } from './criteria.mjs';
import {
  clearPickFinderConnection, clearPickFinderSession, getPickFinderConnectionState,
  loadPickFinderCredentials, loadPickFinderSession, savePickFinderCredentials, savePickFinderSession
} from './secure-store.mjs';

const BASE = process.env.PICKFINDER_BASE_URL || 'https://www.pickfinder.app';
const PROPS = process.env.PICKFINDER_PROPS_URL || `${BASE}/props`;
const SIGNIN = process.env.PICKFINDER_SIGN_IN_URL || `${BASE}/sign-in`;
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const MAX = Math.max(1, Number(process.env.MAX_CANDIDATES || 60));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.SCAN_CONCURRENCY || 3)));
const DATA = path.resolve(process.env.DATA_DIR || './data');
const FLOOR = Number(process.env.MIN_FILTER_HIT_RATE || 75);
const TABS = ['GAMES','GAMES WON','GAMES LOST','BP WON','BP RET','BP W%','ACES','DF'];
const TEAM_SPORTS = ['NBA','WNBA','NHL','MLB','NFL','CFB','CBB'];
const ESPORTS = ['VAL','CS2','LOL','DOTA2','COD'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (cb, v) => { try { cb?.(v); } catch {} };
const clean = (v='') => String(v).replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

async function first(list, timeout=700) {
  for (const loc of list) try { const n=loc.first(); if (await n.isVisible({timeout})) return n; } catch {}
  return null;
}
async function bodyText(page) { return clean(await page.locator('body').innerText().catch(()=>'')); }
async function optionTexts(page) {
  const out=[];
  for (const sel of ['[role="option"]','[role="menuitem"]','[role="listbox"] button','[data-radix-collection-item]']) {
    const loc=page.locator(sel), n=Math.min(await loc.count().catch(()=>0),100);
    for(let i=0;i<n;i++){ const el=loc.nth(i); if(!await el.isVisible().catch(()=>false)) continue; const t=clean(await el.innerText().catch(()=>'')); if(t&&!out.includes(t)) out.push(t); }
  }
  return out;
}
async function clickName(page, names, exact=false) {
  for(const name of (Array.isArray(names)?names:[names]).filter(Boolean)){
    const re=name instanceof RegExp?name:new RegExp(exact?`^${esc(name)}$`:esc(name),'i');
    const el=await first([page.getByRole('button',{name:re}),page.getByRole('option',{name:re}),page.getByRole('menuitem',{name:re}),page.getByRole('link',{name:re}),page.getByText(re,{exact})]);
    if(!el) continue; try{await el.scrollIntoViewIfNeeded().catch(()=>{});await el.click({timeout:2500});await wait(220);return true;}catch{}
  }
  return false;
}
async function filterTrigger(page,label){
  const re=new RegExp(`^\\s*${esc(label)}(?:\\s|$)`,'i');
  return first([page.getByRole('button',{name:re}),page.locator('button').filter({hasText:new RegExp(esc(label),'i')}),page.locator('[role="combobox"]').filter({hasText:new RegExp(esc(label),'i')})],750);
}
async function selectFilter(page,label,values){
  const trigger=await filterTrigger(page,label); if(!trigger) return {opened:false,selected:false,value:null,options:[]};
  const before=clean(await trigger.innerText().catch(()=>'')); await trigger.click({timeout:2500}).catch(()=>{}); await wait(180);
  const opts=await optionTexts(page); const candidates=(Array.isArray(values)?values:[values]).filter(Boolean).map(String);
  for(const candidate of candidates){
    if(candidate.toLowerCase()==='current') continue;
    const found=opts.find(o=>o.toLowerCase()===candidate.toLowerCase())||opts.find(o=>o.toLowerCase().includes(candidate.toLowerCase()));
    if(found && await clickName(page,found,true)) return {opened:true,selected:true,value:found,options:opts};
  }
  if(candidates.some(v=>v.toLowerCase()==='current')){
    const current=before.replace(new RegExp(`^\\s*${esc(label)}\\s*`,'i'),'').trim();
    if(current && !/^all$/i.test(current) && current.toLowerCase()!==label.toLowerCase()){await page.keyboard.press('Escape').catch(()=>{});return {opened:true,selected:true,value:current,options:opts};}
    const usable=opts.filter(o=>!/^all$/i.test(o)&&o.toLowerCase()!==label.toLowerCase());
    if(usable.length===1 && await clickName(page,usable[0],true)) return {opened:true,selected:true,value:usable[0],options:opts};
  }
  await page.keyboard.press('Escape').catch(()=>{}); return {opened:true,selected:false,value:null,options:opts};
}
async function openAdvanced(page){
  const el=await first([page.locator('button[aria-label*="filter" i]'),page.locator('button[title*="filter" i]'),page.locator('button[aria-label*="setting" i]'),page.getByRole('button',{name:/advanced filters?|settings?/i})],650);
  if(!el) return false; try{await el.click({timeout:2200});await wait(220);return true;}catch{return false;}
}
function rate(text,label){
  for(const re of [new RegExp(`${esc(label)}\\s*[:\\-]?\\s*(\\d{1,3})%`,'i'),new RegExp(`${esc(label)}[^%]{0,30}?(\\d{1,3})%`,'i')]){const m=text.match(re);if(m)return Number(m[1]);}
  return null;
}
async function hitRate(page){const t=await bodyText(page);return rate(t,'Hit Rate')??rate(t,'Hit%')??rate(t,'L10');}
async function audit(page,label,values,required=false,{advanced=false,requiredWhenAvailable=false}={}){
  let r=await selectFilter(page,label,values); if(!r.selected&&advanced&&await openAdvanced(page)) r=await selectFilter(page,label,values);
  const must=required||(requiredWhenAvailable&&r.opened&&r.options.length>0);
  if(!r.selected)return{label,value:(Array.isArray(values)?values:[values]).join(' / ')||'Current',hitRate:null,required:must,enforceFloor:true,verified:false,availableOptions:r.options.slice(0,15)};
  await wait(300); return{label,value:r.value,hitRate:await hitRate(page),required:must,enforceFloor:true,floor:FLOOR,verified:true};
}
function propParts(href){try{return decodeURIComponent(new URL(href).searchParams.get('prop')||'').split(':');}catch{return[];}}
function lineOf(href,text=''){const p=propParts(href);const v=p.at(-1);if(/^[-+]?\d+(\.\d+)?$/.test(v||''))return Number(v);const m=text.match(/\b(?:line|projection)\s*[:\-]?\s*([-+]?\d+(?:\.\d+)?)/i);return m?Number(m[1]):null;}
function propOf(href){const p=propParts(href);return p[1]?p[1].replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):'Prop';}
function matchOf(href){const p=propParts(href);return p[2]||String(href).split('?')[0];}
function sportOf(t){return ['WNBA','NBA','MLB','NFL','CFB','TENNIS','SOCCER','LOL','DOTA2','CS2','VAL','COD','CBB','NHL'].find(s=>new RegExp(`\\b${s}\\b`,'i').test(t))||'UNKNOWN';}
function directionOf(t){const u=(t.match(/\bunder\b|\blower\b/gi)||[]).length,o=(t.match(/\bover\b|\bhigher\b/gi)||[]).length;return u>o?'UNDER':o>u?'OVER':'N/A';}
function opponentOf(t){for(const re of [/Opponent\s+(?!All\b)([A-Za-z0-9 .&'’-]{2,32})/i,/\bvs\.?\s+([A-Za-z0-9 .&'’-]{2,32})/i]){const m=t.match(re);if(m)return clean(m[1]).split(/\n|\s{2,}/)[0].trim();}return'';}
function venueOf(t){const m=t.match(/Home\/?Away\s+(Home|Away)/i);if(m)return m[1];return /\bHome\b/i.test(t)&&!/\bAway\b/i.test(t)?'Home':/\bAway\b/i.test(t)&&!/\bHome\b/i.test(t)?'Away':null;}
function outcomeOf(t){for(const re of [/Win Predictor[^%]{0,100}?(\d{1,3})%/i,/(?:Win Probability|Match Odds)[^%]{0,100}?(\d{1,3})%/i]){const m=t.match(re);if(m)return Number(m[1])>=50?'WIN':'LOSS';}return null;}
function surfaceOf(t){const m=t.match(/\b(Indoor Hard|Outdoor Hard|Hard|Clay|Grass|Carpet)\b/i);return m?.[1]||null;}
function signals(t,top){return{regularLine:!!top.regular&&!/\b(goblin|demon|green goblin|discount(?:ed)?|boosted)\b/i.test(t),prizePicksConfirmed:!!top.pp||/prize\s*picks|prizepicks/i.test(t),isToday:!!top.today||/\b(today|tonight)\b/i.test(t)};}
async function diagnostic(page,label){try{const dir=path.join(DATA,'diagnostics');await fs.mkdir(dir,{recursive:true});const controls=await page.locator('button,[role="combobox"]').allInnerTexts().catch(()=>[]);await fs.writeFile(path.join(dir,`${Date.now()}-${label.replace(/[^a-z0-9_-]/gi,'-').slice(0,50)}.json`),JSON.stringify({url:page.url(),controls},null,2));}catch{}}

async function login(page,context,logs,onProgress){
  progress(onProgress,{stage:'auth',message:'Checking PickFinder session'}); await page.goto(PROPS,{waitUntil:'domcontentloaded',timeout:45000}); await wait(900);
  const pw=()=>first([page.locator('input[type="password"]'),page.getByLabel(/password/i),page.getByPlaceholder(/password/i)],450);
  let pass=await pw(); let needs=!!pass||/sign[-_ ]?in|login/i.test(new URL(page.url()).pathname);
  if(!needs){const sign=await first([page.getByRole('link',{name:/sign in|log in|login/i}),page.getByRole('button',{name:/sign in|log in|login/i})],450);needs=!!sign&&!/\bProps\b|\bAnalysis\b/i.test(await bodyText(page));}
  if(!needs){logs.push('Authenticated PickFinder session confirmed');await savePickFinderSession(await context.storageState()).catch(()=>{});return;}
  const creds=await loadPickFinderCredentials();if(!creds)throw Object.assign(new Error('PickFinder is not connected. Connect it from the dashboard first.'),{code:'PICKFINDER_NOT_CONNECTED'});
  progress(onProgress,{stage:'auth',message:'Signing in to PickFinder'});
  await page.goto(SIGNIN,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});await wait(600);await clickName(page,/sign in|log in|login/i).catch(()=>{});await wait(350);
  const email=await first([page.locator('input[type="email"]'),page.getByLabel(/email/i),page.getByPlaceholder(/email/i),page.locator('input[name*="email" i]')],900);pass=await pw();
  if(!email||!pass)throw new Error('PickFinder sign-in form could not be found.');
  await email.fill(creds.email);await pass.fill(creds.password);const submit=await first([page.getByRole('button',{name:/sign in|log in|login|continue/i}),page.locator('button[type="submit"]')],900);if(!submit)throw new Error('PickFinder sign-in button could not be found.');
  await submit.click({timeout:3000});await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});await wait(900);
  if(await pw()||/sign[-_ ]?in|login/i.test(new URL(page.url()).pathname)){const t=await bodyText(page);if(/captcha|verify|verification|one[- ]?time|2fa|two[- ]factor/i.test(t))throw new Error('PickFinder requires interactive verification. Complete it in PickFinder, then reconnect.');throw new Error('PickFinder sign-in did not complete. Check the login.');}
  await page.goto(PROPS,{waitUntil:'domcontentloaded',timeout:45000});await savePickFinderSession(await context.storageState());logs.push('PickFinder login verified and encrypted session saved');
}
async function contextWithLogin(logs,onProgress){
  const browser=await chromium.launch({headless:HEADLESS});try{const saved=await loadPickFinderSession();const context=await browser.newContext({...saved?{storageState:saved}:{},viewport:{width:1440,height:1000},locale:'en-US'});const page=await context.newPage();await login(page,context,logs,onProgress);return{browser,context,page};}catch(e){await browser.close().catch(()=>{});throw e;}
}
async function topFilters(page,logs){
  const pp=await selectFilter(page,'Apps',['PrizePicks','Prize Picks']);const regular=await selectFilter(page,'Modifier',['Regular','Main','Standard']);const today=await selectFilter(page,'Date',['Today']);
  logs.push(`Top filters: PrizePicks=${pp.selected}, regular=${regular.selected}, today=${today.selected}`);return{pp:pp.selected,regular:regular.selected,today:today.selected};
}
async function candidates(page,logs,onProgress){
  progress(onProgress,{stage:'discover',message:'Finding tonight’s regular PrizePicks props',reviewed:0,total:0});await page.goto(PROPS,{waitUntil:'domcontentloaded',timeout:45000});await wait(700);const top=await topFilters(page,logs);await diagnostic(page,'props-controls');
  const anchors=page.locator('a[href*="/players/"]');const n=Math.min(await anchors.count().catch(()=>0),MAX*4),out=[],seen=new Set();
  for(let i=0;i<n&&out.length<MAX;i++){const a=anchors.nth(i),href=await a.getAttribute('href').catch(()=>null);if(!href)continue;const absolute=new URL(href,BASE).toString();if(seen.has(absolute))continue;const row=clean(await a.locator('xpath=ancestor::*[self::tr or @role="row" or self::article or self::div][1]').innerText().catch(()=>a.innerText().catch(()=>'')));if(!row)continue;if(/\b(goblin|demon|green goblin|discount(?:ed)?|boosted)\b/i.test(row))continue;const qm={l5:rate(row,'L5'),l10:rate(row,'L10'),l15:rate(row,'L15'),h2h:rate(row,'H2H')};if((qm.l5!==null&&qm.l5<80)||(qm.l10!==null&&qm.l10<75)||(qm.l15!==null&&qm.l15<75)||(qm.h2h!==null&&qm.h2h<75))continue;out.push({href:absolute,row,top});seen.add(absolute);}
  logs.push(`Found ${out.length} candidates`);progress(onProgress,{stage:'discover',message:`Found ${out.length} candidates`,reviewed:0,total:out.length});return out;
}
async function tabs(page){const rows=[];for(const tab of TABS){if(!await clickName(page,tab,true)){rows.push({tab,verified:false});continue;}await wait(180);const t=await bodyText(page),vals={l5:rate(t,'L5'),l10:rate(t,'L10'),l15:rate(t,'L15'),h2h:rate(t,'H2H')};const arr=Object.values(vals).filter(Number.isFinite);rows.push({tab,verified:true,...vals,score:arr.length?Math.round(arr.reduce((a,b)=>a+b,0)/arr.length):null});}const best=[...rows].filter(r=>Number.isFinite(r.score)).sort((a,b)=>b.score-a.score)[0];return{rows,strongestTab:best?.tab||null,strongestScore:best?.score??null};}
async function analyze(context,c,logs){
  const page=await context.newPage();try{await page.goto(c.href,{waitUntil:'domcontentloaded',timeout:45000});await wait(650);const body=await bodyText(page),all=`${c.row}\n${body}`,sport=sportOf(all),pick=directionOf(c.row)!=='N/A'?directionOf(c.row):directionOf(body),opponent=opponentOf(all),venue=venueOf(all),outcome=outcomeOf(all),s=signals(all,c.top),year=String(new Date().getFullYear());
    const auditRows=[];auditRows.push(opponent?await audit(page,'Opponent',[opponent],true):{label:'Opponent',value:'Current opponent',hitRate:null,required:true,enforceFloor:true,verified:false});
    if(TEAM_SPORTS.includes(sport)){auditRows.push(await audit(page,'Season',[year,'Current'],true));auditRows.push(venue?await audit(page,'Home/Away',[venue],['NBA','WNBA','NHL','MLB'].includes(sport)):{label:'Home/Away',value:'Current venue',hitRate:null,required:['NBA','WNBA','NHL','MLB'].includes(sport),enforceFloor:true,verified:false});auditRows.push(await audit(page,'Team',['Current'],true));}
    if(ESPORTS.includes(sport)){auditRows.push(await audit(page,'Team',['Current'],true));auditRows.push(await audit(page,'Event/Tournament',['Current'],true));auditRows.push(await audit(page,'LAN/Online',['Current','LAN','Online'],false,{advanced:true,requiredWhenAvailable:true}));}
    if(sport==='TENNIS'){auditRows.push(await audit(page,'Court Type',[surfaceOf(all)||'Current'],true));auditRows.push(await audit(page,'Season',[year,'Current'],true));for(const label of ['Opponent Hand','Opponent Rank','Match Format','Sets Played'])auditRows.push(await audit(page,label,['Current'],false,{advanced:true,requiredWhenAvailable:true}));}
    for(const label of ['Days Rest','Rank','Spread','Minutes Played'])auditRows.push(await audit(page,label,['Current'],false,{advanced:true,requiredWhenAvailable:true}));
    let outcomeRate=null;if(outcome){const r=await audit(page,'Win/Loss',[outcome,outcome==='WIN'?'Win':'Loss'],true,{advanced:true});auditRows.push(r);outcomeRate=r.hitRate;}else auditRows.push({label:'Win/Loss',value:'Expected outcome unresolved',hitRate:null,required:true,enforceFloor:true,verified:false});
    const tabAudit=sport==='TENNIS'?await tabs(page):{rows:[],strongestTab:null,strongestScore:null};if(auditRows.some(r=>r.required&&!r.verified))await diagnostic(page,`${sport}-missing-filter`);
    const avg=numberOrNull((all.match(/Avg(?:\s+L10)?\s*([-+]?\d+(?:\.\d+)?)/i)||[])[1]),diff=numberOrNull((all.match(/Diff\s*([-+]?\d+(?:\.\d+)?)/i)||[])[1]);
    return evaluatePick({id:c.href,player:clean(await page.locator('h1').first().innerText().catch(()=>c.row.split('\n')[0]||'Unknown')),prop:propOf(c.href),line:lineOf(c.href,c.row),sport,pick,opponent,matchId:matchOf(c.href),l5:rate(all,'L5'),l10:rate(all,'L10'),l15:rate(all,'L15'),h2h:rate(all,'H2H'),expectedOutcome:outcome,expectedOutcomeRate:outcomeRate,avg,diff,regularLine:s.regularLine,prizePicksConfirmed:s.prizePicksConfirmed,isToday:s.isToday,sourceUrl:c.href,filterAudit:auditRows,tabAudit:tabAudit.rows,strongestTab:tabAudit.strongestTab,strongestTabScore:tabAudit.strongestScore});
  }catch(e){logs.push(`Detail failure ${c.href}: ${e.message}`);return evaluatePick({id:c.href,player:'Unresolved',prop:propOf(c.href),line:lineOf(c.href,c.row),sport:'UNKNOWN',pick:directionOf(c.row),opponent:'',matchId:c.href,l5:null,l10:null,l15:null,h2h:null,expectedOutcome:null,expectedOutcomeRate:null,avg:null,diff:null,regularLine:false,prizePicksConfirmed:false,isToday:false,sourceUrl:c.href,filterAudit:[{label:'Detail page',value:'Failed to verify',hitRate:null,required:true,verified:false}]});}finally{await page.close().catch(()=>{});}
}

export async function verifyPickFinderConnection({email,password}={}){if(email||password)await savePickFinderCredentials({email,password});await clearPickFinderSession();const logs=[];try{const{browser,context,page}=await contextWithLogin(logs);try{await page.goto(PROPS,{waitUntil:'domcontentloaded',timeout:45000});await wait(500);if(await first([page.locator('input[type="password"]')],350))throw new Error('PickFinder session is not authenticated.');await savePickFinderSession(await context.storageState());return{connected:true,...await getPickFinderConnectionState(),logs};}finally{await context.close().catch(()=>{});await browser.close().catch(()=>{});}}catch(e){await clearPickFinderConnection().catch(()=>{});throw e;}}
export async function disconnectPickFinder(){await clearPickFinderConnection();return{connected:false,...await getPickFinderConnectionState()};}
export async function runLiveScan({onProgress}={}){const logs=[],warnings=[];progress(onProgress,{stage:'starting',message:'Starting live PickFinder scan',reviewed:0,total:0});const{browser,context,page}=await contextWithLogin(logs,onProgress);try{const list=await candidates(page,logs,onProgress),picks=new Array(list.length);let next=0,reviewed=0,qualifiedSoFar=0;async function worker(n){while(true){const i=next++;if(i>=list.length)return;progress(onProgress,{stage:'analyze',message:`Worker ${n}: auditing ${i+1}/${list.length}`,reviewed,total:list.length});const p=await analyze(context,list[i],logs);picks[i]=p;reviewed++;if(p.qualified)qualifiedSoFar++;progress(onProgress,{stage:'analyze',message:p.qualified?`${p.player} qualified`:`${p.player} rejected`,reviewed,total:list.length,currentPlayer:p.player,qualifiedSoFar});}}const workers=Math.min(CONCURRENCY,Math.max(1,list.length));await Promise.all(Array.from({length:workers},(_,i)=>worker(i+1)));await savePickFinderSession(await context.storageState()).catch(()=>{});const done=picks.filter(Boolean),qualified=done.filter(p=>p.qualified).sort((a,b)=>b.confidence-a.confidence);if(!qualified.length)warnings.push('No props passed every strict verification rule.');return{mode:'live',scannedAt:new Date().toISOString(),source:'PickFinder authenticated browser scan',totalReviewed:done.length,qualifiedCount:qualified.length,rejectedCount:done.length-qualified.length,scannerConcurrency:workers,picks:done,diversifiedCard:buildDiversifiedCard(done,4),warnings,logs};}finally{await context.close().catch(()=>{});await browser.close().catch(()=>{});}}
