// One gate for every Odds API request in the data-core process. No credentials
// enter keys, diagnostics or errors. Callers cannot override provider cooldown.
const truthy=value=>['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());
const boundedInt=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback;};
export function createOddsRequestGate({concurrency=2, spacingMs=250, timeoutMs=12000,
  now=Date.now, random=Math.random, sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  onState=()=>{}, initialState={}, paused=()=>truthy(process.env.THE_ODDS_API_PAUSED),
  maxRequestsPerHour=()=>boundedInt(process.env.THE_ODDS_API_MAX_REQUESTS_PER_HOUR,12,1,1000)}={}) {
  const inflight=new Map(), queue=[], launchesAt=[];
  let active=0, nextStart=0, blockedUntil=Number(initialState.blockedUntil)||0;
  let failures=0, backoff=0, probe=false, launches=0, joins=0, rejected=0;
  const hourlyLimit=()=>boundedInt(maxRequestsPerHour(),12,1,1000);
  const pruneLaunches=()=>{const cutoff=now()-3600000;while(launchesAt.length&&launchesAt[0]<=cutoff)launchesAt.shift();};
  const state=()=>{pruneLaunches();return {active,queued:queue.length,inflight:inflight.size,blockedUntil,
    circuit:blockedUntil>now()?'OPEN':blockedUntil?'HALF_OPEN':'CLOSED',launches,joins,rejected,
    paused:Boolean(paused()),launchesLastHour:launchesAt.length,maxRequestsPerHour:hourlyLimit()};};
  const unavailable=()=>Object.assign(new Error('Odds provider is cooling down.'),{code:'PROVIDER_COOLDOWN',status:503,retryAt:blockedUntil});
  const budgetError=(code,message)=>Object.assign(new Error(message),{code,status:503});
  function assertRequestBudget(){
    if(paused())throw budgetError('PAID_PROVIDER_PAUSED','Paid odds provider is paused.');
    pruneLaunches();
    if(launchesAt.length>=hourlyLimit())throw budgetError('REQUEST_BUDGET_EXHAUSTED','Hourly paid-provider request budget reached.');
    launchesAt.push(now());
  }
  function trip(error) {
    failures++;
    if(error?.status!==429 && failures<3 && !probe)return;
    backoff++;
    const retry=String(error?.retryAfter??'').trim();
    const seconds=retry!==''?Number(retry):NaN;
    const specified=Number.isFinite(seconds)?now()+Math.max(0,seconds)*1000:Date.parse(retry);
    const fallback=Math.min(300000,10000*2**Math.min(backoff-1,5))*(0.8+random()*0.4);
    blockedUntil=Math.max(blockedUntil,Number.isFinite(specified)?Math.max(now()+1000,specified):now()+fallback);
    onState({blockedUntil});
  }
  function pump() {
    while(active<concurrency&&queue.length) {
      const job=queue.shift();active++;
      (async()=>{
        let ownsProbe=false;
        try {
          if(blockedUntil>now()||probe)throw unavailable();
          const at=Math.max(nextStart,now());nextStart=at+spacingMs;
          if(at>now())await sleep(at-now());
          if(blockedUntil>now()||probe)throw unavailable();
          if(blockedUntil){probe=true;ownsProbe=true;}
          assertRequestBudget();
          launches++;
          const value=await job.operation(AbortSignal.timeout(timeoutMs));
          if(!blockedUntil||ownsProbe){failures=0;backoff=0;}
          if(ownsProbe){blockedUntil=0;onState({blockedUntil:0});}
          if(ownsProbe)probe=false;
          job.resolve(value);
        } catch(error) {
          if(['PROVIDER_COOLDOWN','PAID_PROVIDER_PAUSED','REQUEST_BUDGET_EXHAUSTED'].includes(error?.code))rejected++;
          else if(error?.status===429||error?.status>=500||['TimeoutError','TypeError'].includes(error?.name))trip(error);
          if(ownsProbe)probe=false;job.reject(error);
        } finally {active--;pump();}
      })();
    }
  }
  return {state,restore(saved){blockedUntil=Math.max(blockedUntil,Number(saved?.blockedUntil)||0);},run(key,operation){
    if(inflight.has(key)){joins++;return inflight.get(key);}
    if(paused()){rejected++;return Promise.reject(budgetError('PAID_PROVIDER_PAUSED','Paid odds provider is paused.'));}
    if(blockedUntil>now()){rejected++;return Promise.reject(unavailable());}
    pruneLaunches();
    if(launchesAt.length>=hourlyLimit()){rejected++;return Promise.reject(budgetError('REQUEST_BUDGET_EXHAUSTED','Hourly paid-provider request budget reached.'));}
    const pending=new Promise((resolve,reject)=>{queue.push({operation,resolve,reject});});
    inflight.set(key,pending);pump();
    // Attach cleanup to both outcomes; never leave a rejecting finally promise.
    pending.then(()=>inflight.delete(key),()=>inflight.delete(key));
    return pending;
  }};
}
export function oddsRequestKey(path,params={}) {
  const sets=new Set(['markets','bookmakers','regions']);
  return path+'?'+Object.keys(params).sort().map(k=>k+'='+
    (sets.has(k)?[...new Set(String(params[k]).split(','))].sort().join(','):String(params[k]))).join('&');
}
