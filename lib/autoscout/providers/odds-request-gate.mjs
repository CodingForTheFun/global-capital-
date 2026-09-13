// One gate for every Odds API request in the data-core process. No credentials
// enter keys, diagnostics or errors. Callers cannot override provider cooldown.
export function createOddsRequestGate({concurrency=2, spacingMs=250, timeoutMs=12000,
  now=Date.now, random=Math.random, sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  onState=()=>{}, initialState={}, maxLaunchesPerHour=null}={}) {
  const inflight=new Map(), queue=[], launchTimes=[];
  const configuredCap=maxLaunchesPerHour??process.env.THE_ODDS_API_MAX_REQUESTS_PER_HOUR;
  const parsedCap=Number(configuredCap);
  const hourlyLimit=Number.isFinite(parsedCap)&&parsedCap>0?Math.floor(parsedCap):Infinity;
  let active=0, nextStart=0, blockedUntil=Number(initialState.blockedUntil)||0;
  let failures=0, backoff=0, probe=false, launches=0, joins=0, rejected=0;
  const pruneLaunches=()=>{const cutoff=now()-3600_000;while(launchTimes.length&&launchTimes[0]<=cutoff)launchTimes.shift();};
  const state=()=>{pruneLaunches();return {active,queued:queue.length,inflight:inflight.size,blockedUntil,
    circuit:blockedUntil>now()?'OPEN':blockedUntil?'HALF_OPEN':'CLOSED',launches,joins,rejected,
    launchesLastHour:launchTimes.length,maxLaunchesPerHour:Number.isFinite(hourlyLimit)?hourlyLimit:null};};
  const unavailable=()=>Object.assign(new Error('Odds provider is cooling down.'),{code:'PROVIDER_COOLDOWN',status:503,retryAt:blockedUntil});
  const budgetUnavailable=()=>Object.assign(new Error('Odds provider hourly request budget reached.'),{code:'ODDS_HOURLY_BUDGET',status:503,retryAt:(launchTimes[0]||now())+3600_000});
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
          pruneLaunches();
          if(launchTimes.length>=hourlyLimit)throw budgetUnavailable();
          launchTimes.push(now());
          launches++;
          const value=await job.operation(AbortSignal.timeout(timeoutMs));
          if(!blockedUntil||ownsProbe){failures=0;backoff=0;}
          if(ownsProbe){blockedUntil=0;onState({blockedUntil:0});}
          if(ownsProbe)probe=false;
          job.resolve(value);
        } catch(error) {
          if(error?.code==='PROVIDER_COOLDOWN'||error?.code==='ODDS_HOURLY_BUDGET')rejected++;
          else if(error?.status===429||error?.status>=500||['TimeoutError','TypeError'].includes(error?.name))trip(error);
          if(ownsProbe)probe=false;job.reject(error);
        } finally {active--;pump();}
      })();
    }
  }
  return {state,restore(saved){blockedUntil=Math.max(blockedUntil,Number(saved?.blockedUntil)||0);},run(key,operation){
    if(inflight.has(key)){joins++;return inflight.get(key);}
    if(blockedUntil>now()){rejected++;return Promise.reject(unavailable());}
    pruneLaunches();
    if(launchTimes.length>=hourlyLimit){rejected++;return Promise.reject(budgetUnavailable());}
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
