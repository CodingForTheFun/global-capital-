import {normalizeCatalog,normalizeEvents,normalizeOffers,historyForMarket,sportCode,text,number} from './prop-workspace.mjs';

// Visit-scoped reads only. No scheduler, backfill or filesystem write.
// Paid reads reuse the existing client's cache, in-flight dedupe and reserve.
let accountSessions, modelStore;
async function authenticate(req) {
  const [{currentAccount},{createAccountSessions},{accountSecret}] = await Promise.all([
    import('../auth/routes.mjs'),import('../auth/session.mjs'),import('../auth/secret.mjs'),
  ]);
  accountSessions ||= createAccountSessions({secret:accountSecret()});
  return (await currentAccount(req,accountSessions)).user || null;
}
async function read(path, params, options) {
  const {proplineGet} = await import('../data-sources/propline/client.mjs');
  return proplineGet(path,params,options);
}
async function predict(target) {
  const {createMLStore} = await import('../ml/snapshot-store.mjs');
  modelStore ||= createMLStore(); // Snapshot-only: not an adaptive-history fallback.
  return modelStore.lookup(target);
}
async function publicHistory(params) {
  const {fetchPublicResearch} = await import('../data-sources/espn/research.mjs');
  const history=await fetchPublicResearch(params);
  if(history?.available!==true)return history;
  const identity=await fetchPublicResearch.eventIdentity({...params,gameLog:history.gameLog});
  if(identity?.available!==true)return {ok:true,available:false,code:identity?.code||'MATCHUP_IDENTITY_UNVERIFIED',message:'The selected game could not be matched safely across history sources.',gameLog:[],source:'Historical stats'};
  return {...history,selectedSourceGameId:identity.gameId||null,selectedSourceEventId:identity.sourceEventId||null};
}
const problem=(status,code,message)=>Object.assign(new Error(message),{status,code});
const send=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'Cookie','x-content-type-options':'nosniff',...(status===429?{'retry-after':'60'}:{}),...(status===405?{allow:'GET'}:{})});res.end(JSON.stringify(body));};
const nameKey=value=>text(value).normalize('NFKC').toLocaleLowerCase('en-US');

function normalizeMarketReference(projectionPayload,evPayload,player,market,offer) {
  const samePlayer=row=>{
    const id=text(row?.player_id);
    return (player.playerId && id && id===text(player.playerId)) || nameKey(row?.player_name ?? row?.description)===nameKey(player.name);
  };
  const projectionRows=Array.isArray(projectionPayload?.projections)?projectionPayload.projections:Array.isArray(projectionPayload?.data)?projectionPayload.data:Array.isArray(projectionPayload)?projectionPayload:[];
  const projectionRow=projectionRows.find(row=>samePlayer(row)&&text(row?.market??row?.market_key).toLowerCase()===market.marketKey.toLowerCase());
  const projection=number(projectionRow?.projection??projectionRow?.implied_value);

  const evRows=Array.isArray(evPayload?.plays)?evPayload.plays:Array.isArray(evPayload?.data)?evPayload.data:Array.isArray(evPayload)?evPayload:[];
  const exact=evRows.filter(row=>samePlayer(row)
    && text(row?.market??row?.market_key).toLowerCase()===market.marketKey.toLowerCase()
    && number(row?.point??row?.line)===offer.line)
    .map(row=>({
      evPercent:number(row?.ev_percent??row?.ev),
      fairProbability:number(row?.fair_probability??row?.no_vig_probability),
      fairPrice:number(row?.fair_price??row?.no_vig_price),
      bookmaker:text(row?.bookmaker??row?.bookmaker_key)||null,
    }))
    .filter(row=>row.evPercent!==null)
    .sort((a,b)=>(b.evPercent??-Infinity)-(a.evPercent??-Infinity));
  const best=exact[0]||null;
  if(projection===null&&!best)return null;
  return {
    available:true,
    projection,
    evPercent:best?.evPercent??null,
    fairProbability:best?.fairProbability??null,
    fairPrice:best?.fairPrice??null,
    bookmaker:best?.bookmaker??null,
    basis:'PropLine market-implied / no-vig',
  };
}

export function createWorkspaceHandler({authenticate:auth=authenticate,read:provider=read,predict:prediction=predict,historyFallback=publicHistory,now=Date.now}={}) {
  const rates=new Map(), eventCache=new Map(), eventInflight=new Map();
  async function catalog(signal) {
    const value=normalizeCatalog(await provider('/v1/sports',{}, {ttlSeconds:1800,timeoutMs:10000,signal}));
    if (!value.length) throw problem(502,'CATALOG_UNAVAILABLE','The sports catalog could not be loaded.');
    return value;
  }
  async function events(sport,signal) {
    const value=await provider(`/v1/sports/${sport}/events`,{}, {ttlSeconds:60,timeoutMs:10000,signal});
    if (!Array.isArray(value) && !Array.isArray(value?.events)) throw problem(502,'EVENTS_UNAVAILABLE','Events could not be loaded.');
    return normalizeEvents(value,sport);
  }
  async function event(sport,eventId,signal) {
    const cacheKey=`${sport}|${eventId}`, cached=eventCache.get(cacheKey);
    if (cached && cached.until>now()) return cached.value;
    if (eventInflight.has(cacheKey)) return eventInflight.get(cacheKey);
    const pending=(async()=>{
      const available=await events(sport,signal);
      const selected=available.find(e=>e.id===eventId || e.aliases.includes(eventId));
      if (!selected) throw problem(404,'EVENT_NOT_POSTED','This event is no longer on the current board.');
      const path=`/v1/sports/${sport}/events/${encodeURIComponent(selected.id)}`;
      const response=await provider(path+'/markets',{}, {ttlSeconds:300,timeoutMs:10000,signal});
      const list=Array.isArray(response)?response:response?.markets;
      if (!Array.isArray(list)) throw problem(502,'MARKETS_UNAVAILABLE','Market discovery could not be loaded.');
      const keys=[...new Set(list.map(m=>text(m.key)).filter(k=>/^[a-zA-Z0-9_-]{1,120}$/.test(k)))];
      if (keys.length>256) throw problem(503,'MARKET_LIMIT','This event exceeds the safe single-event market limit.');
      const payloads=[];
      for(let i=0;i<keys.length;i+=64) {
        const body=await provider(path+'/odds',{markets:keys.slice(i,i+64).join(','),period:'all',includeBookIds:true},{ttlSeconds:60,timeoutMs:10000,signal});
        if (!Array.isArray(body?.bookmakers) || (body.id && body.id!==selected.id && !selected.aliases.includes(body.id)) || (body.sport_key && body.sport_key!==sport)) throw problem(502,'ODDS_UNAVAILABLE','Prices could not be loaded.');
        payloads.push({...body,id:selected.id});
      }
      const value={event:selected,...normalizeOffers(payloads,selected),fetchedAt:new Date(now()).toISOString(),coverage:{discoveredMarketKeys:keys.length,periods:'Provider-returned periods; not a claim of every period market'}};
      eventCache.set(cacheKey,{until:now()+60000,value});
      while(eventCache.size>128)eventCache.delete(eventCache.keys().next().value);
      return value;
    })().finally(()=>eventInflight.delete(cacheKey));
    eventInflight.set(cacheKey,pending); return pending;
  }
  return async function handleWorkspace(req,res) {
    const url=new URL(req.url||'/','http://localhost');
    if(url.pathname!=='/api/oblige-workspace')return false;
    if(req.method!=='GET'){send(res,405,{ok:false,code:'METHOD_NOT_ALLOWED',message:'GET is required.'});return true;}
    try {
      const user=await auth(req);
      if(!user?.id){send(res,401,{ok:false,code:'AUTH_REQUIRED',message:'Sign in to research player props.'});return true;}
      for(const [id,item] of rates)if(now()-item.at>=60000)rates.delete(id);
      const rate=rates.get(user.id)||{at:now(),count:0};rate.count++;rates.set(user.id,rate);
      if(rate.count>90||rates.size>4000)throw problem(429,'RATE_LIMITED','Too many research requests. Please wait a minute.');
      const action=url.searchParams.get('action')||'catalog';
      if(!['catalog','events','event','history','model'].includes(action))throw problem(400,'UNKNOWN_ACTION','Unknown workspace action.');
      const signal=AbortSignal.timeout(40000);
      const sports=await catalog(signal);
      if(action==='catalog'){send(res,200,{ok:true,sports});return true;}
      const sport=text(url.searchParams.get('sport'));
      if(!sports.some(s=>s.key===sport))throw problem(400,'UNKNOWN_SPORT','Select a sport from the current catalog.');
      if(action==='events'){send(res,200,{ok:true,events:await events(sport,signal)});return true;}
      const eventId=text(url.searchParams.get('event'));
      if(!/^[a-zA-Z0-9:_-]{1,160}$/.test(eventId))throw problem(400,'INVALID_EVENT','A valid event is required.');
      const data=await event(sport,eventId,signal);
      if(action==='event'){send(res,200,{ok:true,...data});return true;}
      const playerKey=text(url.searchParams.get('player'));
      const player=data.players.find(p=>p.key===playerKey);
      const market=player?.markets.find(m=>m.key===url.searchParams.get('market'));
      if(!player||!market)throw problem(404,'SELECTION_NOT_POSTED','This exact player and market are not posted.');
      if(action==='history') {
        let primary;
        try {
          const body=await provider(`/v1/sports/${sport}/players/${encodeURIComponent(player.name)}/games`,{limit:100},{ttlSeconds:900,timeoutMs:12000,signal});
          primary=historyForMarket(body,player,market,{now:now()});
        } catch {
          primary={available:false,code:'PRIMARY_HISTORY_UNAVAILABLE',message:'PropLine historical game records are temporarily unavailable.',gameLog:[],source:'PropLine raw box scores'};
        }
        if(primary.available||market.period||/fantasy/i.test(market.marketKey)) { send(res,200,{ok:true,...primary});return true; }
        let fallback=null;
        try {
          fallback=await historyFallback({
            sport:sportCode(sport),playerName:player.name,providerPlayerId:player.playerId,
            market:market.label||market.marketKey,providerMarketKey:market.marketKey,
            homeTeam:player.homeTeam,awayTeam:player.awayTeam,gameStartTime:player.startsAt,
            games:20,now:now(),
          });
        } catch { fallback=null; }
        const cutoff=Date.parse(player.startsAt||'');
        const fallbackGameLog=Array.isArray(fallback?.gameLog)
          ? fallback.gameLog.filter(row=>Number.isFinite(cutoff)&&Number.isFinite(Date.parse(row?.date))&&Date.parse(row.date)<cutoff
            &&(!fallback.selectedSourceGameId||String(row?.gameId)!==String(fallback.selectedSourceGameId)))
          : [];
        if(fallback?.available===true&&fallbackGameLog.length) {
          const coverage=fallback.coverage&&typeof fallback.coverage==='object'
            ? {...fallback.coverage,returnedGames:fallbackGameLog.length,selectedEventCutoff:player.startsAt}
            : {returnedGames:fallbackGameLog.length,selectedEventCutoff:player.startsAt};
          send(res,200,{ok:true,...fallback,gameLog:fallbackGameLog,coverage,sourceProvider:'ESPN',fallback:true,primaryCode:primary.code,attemptedSources:['PropLine','ESPN']});return true;
        }
        send(res,200,{ok:true,...primary,attemptedSources:['PropLine','ESPN']});return true;
      }
      const offer=market.offers.find(o=>o.key===url.searchParams.get('offer'));
      if(!offer)throw problem(404,'SELECTION_NOT_POSTED','This exact posted offer is no longer available.');

      const modelEligible=offer.line!==null&&!!offer.side&&!!player.playerId&&!market.period&&market.variant==='standard'&&(offer.multiplier===null||offer.multiplier===1);
      const model=modelEligible?await prediction({sport:sportCode(sport),eventId:player.eventId,playerId:player.playerId,playerName:player.name,marketId:market.marketKey,sportsbookKey:offer.book,gameStartTime:player.startsAt,line:offer.line,entityType:'player',live:Date.parse(player.startsAt)<=now(),isAlternate:false}):null;
      const valid=model?.available===true&&model?.code==='READY'&&model?.modelVersion&&model?.validation?.method==='chronological-heldout-real-lines';

      // A market reference does not need a trained model. It is provider
      // market-implied/no-vig data for this exact event + market + posted line,
      // and is returned only as a clearly labelled fallback.
      let marketReference=null;
      if(!valid&&offer.line!==null&&!market.period&&market.variant==='standard') {
        const base=`/v1/sports/${sport}/events/${encodeURIComponent(player.eventId)}`;
        const query={markets:market.marketKey};
        const [projectionPayload,evPayload]=await Promise.all([
          provider(base+'/projections',query,{ttlSeconds:300,timeoutMs:10000,signal}).catch(()=>null),
          provider(base+'/ev',query,{ttlSeconds:60,timeoutMs:10000,signal}).catch(()=>null),
        ]);
        marketReference=normalizeMarketReference(projectionPayload,evPayload,player,market,offer);
      }
      send(res,200,{ok:true,
        prediction:valid?model:{available:false,code:model?.code||'MODEL_NOT_READY',message:marketReference?'Using live market-implied reference data for this selection.':'No trained model or market reference is available for this exact selection.'},
        marketReference,
      });
    } catch(error) {
      const status=[400,401,404,429,503].includes(error.status)?error.status:502;
      const local=new Set(['CATALOG_UNAVAILABLE','EVENTS_UNAVAILABLE','EVENT_NOT_POSTED','MARKETS_UNAVAILABLE','MARKET_LIMIT','ODDS_UNAVAILABLE','RATE_LIMITED','UNKNOWN_ACTION','UNKNOWN_SPORT','INVALID_EVENT','SELECTION_NOT_POSTED']);
      send(res,status,{ok:false,code:local.has(error.code)?error.code:'WORKSPACE_UNAVAILABLE',message:local.has(error.code)?error.message:'Research data could not be loaded. Try again shortly.'});
    }
    return true;
  };
}
export const handleWorkspace=createWorkspaceHandler();
