'use client';
import * as React from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {ChevronRight} from 'lucide-react';
import {fetchAccount} from '@/lib/api';
import {PlayerHeadshot as VerifiedHeadshot} from '@/components/player-headshot';
import {odds,shortTime} from '@/lib/utils';
import {workspaceGet,WorkspaceError,booksFor,chooseOffer,toResearchGroup,expectedValue,type WorkspaceSport,type WorkspaceEvent,type WorkspacePlayer,type WorkspaceMarket,type WorkspaceOffer,type WorkspacePrediction,type WorkspaceHistory,type EventWorkspace} from '@/lib/workspace';
import {SignInPanel} from '@/components/sign-in';
import {PlayerView} from '@/components/player-view';
import {PropExplorer,type ExplorerState} from '@/components/prop-explorer';
import {GameLog} from '@/components/research';
import {PremiumPlayerResearch} from '@/components/premium-player-research';
import {marketName} from '@/lib/market-display';
import styles from './workspace.module.css';

type Account={id:string;email?:string}|null;
function useWorkspaceAccount(){
 const [account,setAccount]=React.useState<Account>(null),[checking,setChecking]=React.useState(true);
 React.useEffect(()=>{const c=new AbortController();void fetchAccount(c.signal).then(value=>{if(!c.signal.aborted)setAccount(value);}).finally(()=>{if(!c.signal.aborted)setChecking(false);});return()=>c.abort();},[]);
 return {account,setAccount,checking};
}
function message(error:unknown){return error instanceof Error?error.message:'Data could not be loaded.';}
function price(offer:WorkspaceOffer){return offer.conflict?'Unverified':offer.dfs?(offer.multiplier!==null&&offer.multiplier!==1?`${offer.multiplier}×`:'DFS projection'):odds(offer.price);}
function matchup(player:WorkspacePlayer){return [player.awayTeam,player.homeTeam].filter(Boolean).join(' @ ')||'Matchup unavailable';}
function usableOffer(offer:WorkspaceOffer){return !!offer&&!!String(offer.book||'').trim()&&!offer.conflict&&(offer.line!==null||!!String(offer.choice||'').trim())&&(offer.dfs||offer.price!==null||offer.multiplier!==null);}
function usableMarket(market:WorkspaceMarket){return !!market&&!!String(market.label||'').trim()&&Array.isArray(market.offers)&&market.offers.some(usableOffer);}
function cleanPlayer(player:WorkspacePlayer):WorkspacePlayer|null{
 const markets=(player.markets||[]).map(m=>({...m,offers:(m.offers||[]).filter(usableOffer)})).filter(usableMarket);
 return String(player.name||'').trim()&&markets.length?{...player,markets}:null;
}
function PlayerHeadshot({player}:{player:WorkspacePlayer}){
 return <span className={styles.avatar}><VerifiedHeadshot sport={player.sport} name={player.name} providerPlayerId={player.playerId}/></span>;
}
function researchHref(player:WorkspacePlayer,market?:WorkspaceMarket){return `/research?${new URLSearchParams({sportKey:player.sport,event:player.eventId,playerKey:player.key,...(market?{category:market.key}:{})})}`;}

export function WorkspaceBoard(){
 const {account,setAccount,checking}=useWorkspaceAccount();
 const [sports,setSports]=React.useState<WorkspaceSport[]>([]),[sport,setSport]=React.useState('');
 const [events,setEvents]=React.useState<WorkspaceEvent[]>([]),[shown,setShown]=React.useState(4);
 const [byEvent,setByEvent]=React.useState<Record<string,WorkspacePlayer[]>>({});
 const [eventErrors,setEventErrors]=React.useState<Record<string,string>>({});
 const [error,setError]=React.useState(''),[loading,setLoading]=React.useState(false);
 const [query,setQuery]=React.useState(''),[book,setBook]=React.useState('all'),[marketFilter,setMarketFilter]=React.useState('all');
 const [refresh,setRefresh]=React.useState(0);
 const previousSport=React.useRef('');
 React.useEffect(()=>{
  if(!account)return;const c=new AbortController();setError('');
  void workspaceGet<{sports:WorkspaceSport[]}>('catalog',{},c.signal).then(body=>{
   if(c.signal.aborted)return;setSports(body.sports);
   let saved='';try{saved=localStorage.getItem('oblige:workspace-sport')||'';}catch{}
   setSport(previous=>body.sports.some(s=>s.key===previous)?previous:body.sports.some(s=>s.key===saved)?saved:body.sports.find(s=>s.key==='football_nfl')?.key||body.sports.find(s=>s.active)?.key||body.sports[0]?.key||'');
  }).catch(cause=>{if(!c.signal.aborted){setError(message(cause));if(cause instanceof WorkspaceError&&cause.status===401)setAccount(null);}});
  return()=>c.abort();
 },[account,setAccount]);
 React.useEffect(()=>{
  if(!account||!sport)return;const c=new AbortController();setLoading(true);setError('');
  if(previousSport.current!==sport){previousSport.current=sport;setEvents([]);setByEvent({});setEventErrors({});setShown(4);setBook('all');setMarketFilter('all');}
  try{localStorage.setItem('oblige:workspace-sport',sport);}catch{}
  void workspaceGet<{events:WorkspaceEvent[]}>('events',{sport},c.signal).then(body=>{if(!c.signal.aborted){setEvents(body.events);const ids=new Set(body.events.map(e=>e.id));setByEvent(old=>Object.fromEntries(Object.entries(old).filter(([id])=>ids.has(id))));}}).catch(cause=>{if(!c.signal.aborted){setError(message(cause));if(cause instanceof WorkspaceError&&cause.status===401)setAccount(null);}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
  return()=>c.abort();
 },[account,sport,refresh,setAccount]);
 React.useEffect(()=>{
  if(!account||!sport||!events.length)return;const c=new AbortController();const queue=events.slice(0,shown);
  async function worker(){while(queue.length&&!c.signal.aborted){const next=queue.shift()!;try{
   const body=await workspaceGet<EventWorkspace>('event',{sport,event:next.id},c.signal);
   if(!c.signal.aborted){const cleaned=body.players.map(cleanPlayer).filter((p):p is WorkspacePlayer=>!!p);setByEvent(old=>({...old,[next.id]:cleaned}));setEventErrors(old=>{const copy={...old};delete copy[next.id];return copy;});}
  }catch(cause){if(!c.signal.aborted){setEventErrors(old=>({...old,[next.id]:message(cause)}));if(cause instanceof WorkspaceError&&cause.status===401)setAccount(null);}}}}
  void Promise.all([worker(),worker()]);return()=>c.abort();
 },[account,sport,events,shown,setAccount]);
 React.useEffect(()=>{
  const timer=setInterval(()=>{if(document.visibilityState==='visible')setRefresh(v=>v+1);},60000);
  return()=>clearInterval(timer);
 },[]);
 const players=React.useMemo(()=>[...new Map(Object.values(byEvent).flat().map(p=>[p.key,p])).values()].sort((a,b)=>a.name.localeCompare(b.name)),[byEvent]);
 const books=React.useMemo(()=>[...new Map(players.flatMap(p=>p.markets.flatMap(m=>m.offers.map(o=>[o.book,o.bookName] as const)))).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[players]);
 const categories=React.useMemo(()=>[...new Map(players.flatMap(p=>p.markets.map(m=>[m.key,m.label] as const))).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[players]);
 const visible=players.filter(p=>(!query||`${p.name} ${matchup(p)} ${p.markets.map(m=>m.label).join(' ')}`.toLowerCase().includes(query.toLowerCase()))&&p.markets.some(m=>(marketFilter==='all'||m.key===marketFilter)&&(book==='all'||m.offers.some(o=>o.book===book))));
 const resolved=events.slice(0,shown).filter(e=>byEvent[e.id]!==undefined||eventErrors[e.id]).length;
 const pending=resolved<Math.min(shown,events.length);
 if(checking)return <div className={styles.shell}><p className={styles.status}>Opening your workspace…</p></div>;
 if(!account)return <div className={styles.shell}><SignInPanel onSignedIn={setAccount}/></div>;
 return <main className={styles.shell} data-release="canonical-workspace-v1">
  <header className={styles.heading}><div><h1>Player props</h1><p>One player per game. Every stat, line and book inside.</p></div><span className={styles.count}>{players.length} players · {sports.length} sports</span></header>
  <div className={styles.controls}>
   <label>Sport<select aria-label="Sport" value={sport} onChange={e=>setSport(e.target.value)}><option value="" disabled>Loading sports…</option>{sports.map(s=><option key={s.key} value={s.key}>{s.title}{s.active?'':' · inactive'}</option>)}</select></label>
   <label>Search loaded players<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Player, team or stat"/></label>
   <label>Book<select aria-label="Board book filter" value={book} onChange={e=>setBook(e.target.value)}><option value="all">All books</option>{books.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
  </div>
  <div className={styles.controls}><label>Stat category<select aria-label="Board stat filter" value={marketFilter} onChange={e=>setMarketFilter(e.target.value)}><option value="all">All stat categories</option>{categories.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
  {error&&<p role="alert" className={`${styles.status} ${styles.error}`}>{error}</p>}
  {(loading||pending)&&<p role="status" className={styles.muted}>Loading verified offers{events.length?` · ${resolved}/${Math.min(shown,events.length)} games`:''}…</p>}
  {!loading&&!pending&&!visible.length&&!error&&<div className={styles.status}>{players.length?'No loaded players match these filters.':'No player props are posted in the loaded games. Other games can be opened below; this does not mean the sport is unsupported.'}</div>}
  <div className={styles.grid}>{visible.map(player=>{
   const category=player.markets.find(m=>(marketFilter==='all'||m.key===marketFilter)&&(book==='all'||m.offers.some(o=>o.book===book)))!;
   const offer=chooseOffer(category,book==='all'?null:book,null);
   const allBooks=new Set(player.markets.flatMap(m=>m.offers.map(o=>o.book))).size;
   return <Link key={player.key} href={researchHref(player,category)} className={styles.player} data-player-key={player.key}>
    <div className={styles.playerTop}><span className={styles.tag}>{sports.find(s=>s.key===sport)?.title||sport}</span><PlayerHeadshot player={player}/></div>
    <h2>{player.name}</h2><p>{matchup(player)}</p><p>{shortTime(player.startsAt)||'Start time unavailable'}</p>
    <div className={styles.preview}><span>{category.label}</span><strong>{offer?.line??offer?.choice??'—'}</strong></div>
    <div className={styles.cardFooter}><span>{player.markets.length} stat categories · {allBooks} books</span><span>Research <ChevronRight size={12} style={{display:'inline'}}/></span></div>
   </Link>;
  })}</div>
  {Object.entries(eventErrors).map(([id,reason])=><p key={id} className={`${styles.status} ${styles.error}`}>Game {id}: {reason} Previous loaded quotes, when present, are retained.</p>)}
  {shown<events.length&&<div className={styles.loadMore}><button className={styles.button} onClick={()=>setShown(n=>n+4)}>Load next {Math.min(4,events.length-shown)} games</button></div>}
  <p className={styles.muted}>Showing {Math.min(shown,events.length)} of {events.length} scheduled games. Book filters apply to loaded players. Quotes refresh while this page is open; history and model availability are verified separately.</p>
 </main>;
}
export function WorkspaceResearch(){
 const params=useSearchParams();
 // Preserve existing shared links; they are not a second prop board.
 if(!params.get('playerKey'))return <PlayerView/>;
 return <WorkspaceDetail sport={params.get('sportKey')||''} eventId={params.get('event')||''} playerKey={params.get('playerKey')||''} categoryKey={params.get('category')||''}/>;
}
function WorkspaceDetail({sport,eventId,playerKey,categoryKey}:{sport:string;eventId:string;playerKey:string;categoryKey:string}){
 const {account,setAccount,checking}=useWorkspaceAccount();
 const [player,setPlayer]=React.useState<WorkspacePlayer|null>(null),[error,setError]=React.useState('');
 const [category,setCategory]=React.useState(categoryKey),[selected,setSelected]=React.useState<WorkspaceOffer|null>(null);
 const [history,setHistory]=React.useState<WorkspaceHistory|null>(null),[historyError,setHistoryError]=React.useState(''),[historyLoading,setHistoryLoading]=React.useState(false),[retry,setRetry]=React.useState(0);
 const [analysis,setAnalysis]=React.useState<ExplorerState>({line:0,side:'OVER',book:null});
 const [favourite,setFavourite]=React.useState(false);
 React.useEffect(()=>{
  if(!account)return;const c=new AbortController();setError('');setPlayer(null);setSelected(null);
  void workspaceGet<EventWorkspace>('event',{sport,event:eventId},c.signal).then(body=>{if(c.signal.aborted)return;const found=body.players.find(p=>p.key===playerKey);if(!found){setError('This player no longer has current offers for this game.');return;}setPlayer(found);setCategory(found.markets.some(m=>m.key===categoryKey)?categoryKey:found.markets[0]?.key||'');}).catch(cause=>{if(!c.signal.aborted){setError(message(cause));if(cause instanceof WorkspaceError&&cause.status===401)setAccount(null);}});
  return()=>c.abort();
 },[account,sport,eventId,playerKey,categoryKey,setAccount]);
 const market=player?.markets.find(m=>m.key===category)||null;
 React.useEffect(()=>{
  if(!market)return;const offer=chooseOffer(market,null,null);setSelected(offer);
  if(offer)setAnalysis({line:offer.line??0,side:offer.side||'OVER',book:offer.book});
 },[market]);
 React.useEffect(()=>{
  if(!player||!market)return;const c=new AbortController();setHistory(null);setHistoryError('');setHistoryLoading(true);
  void workspaceGet<WorkspaceHistory>('history',{sport,event:eventId,player:player.key,market:market.key},c.signal).then(body=>{if(!c.signal.aborted)setHistory(body);}).catch(cause=>{if(!c.signal.aborted)setHistoryError(message(cause));}).finally(()=>{if(!c.signal.aborted)setHistoryLoading(false);});
  return()=>c.abort();
 },[player,market,sport,eventId,retry]);
 const group=React.useMemo(()=>player&&market&&selected&&selected.line!==null&&selected.side?toResearchGroup(player,market,selected):null,[player,market,selected]);
 const displayGroup=React.useMemo(()=>group&&market?{...group,market:marketName(market)}:group,[group,market]);
 React.useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('oblige-followed')||'[]');setFavourite(Array.isArray(saved)&&!!group&&saved.includes(group.key));}catch{setFavourite(false);}},[group]);
 function select(offer:WorkspaceOffer){setSelected(offer);setAnalysis({line:offer.line??0,side:offer.side||'OVER',book:offer.book});}
 function selectBook(book:string){if(market){const offer=chooseOffer(market,book,selected?.line??null,selected?.side||'OVER');if(offer)select(offer);}}
 function toggleFavourite(){if(!group)return;try{const raw=JSON.parse(localStorage.getItem('oblige-followed')||'[]');const saved=Array.isArray(raw)?raw:[];const next=favourite?saved.filter((x:unknown)=>x!==group.key):[...saved,group.key];localStorage.setItem('oblige-followed',JSON.stringify(next));setFavourite(!favourite);}catch{}}
 if(checking)return <main className={styles.shell}><p className={styles.status}>Opening research…</p></main>;
 if(!account)return <main className={styles.shell}><SignInPanel onSignedIn={setAccount}/></main>;
 if(error)return <main className={styles.shell}><Link href="/board" className={styles.back}>Back to props</Link><p role="alert" className={styles.status}>{error}</p></main>;
 if(!player||!market||!selected)return <main className={styles.shell}><p className={styles.status}>Loading this player’s markets…</p></main>;
 const unavailable=historyError||(history?.available===false?history.message||'No verified history for this exact statistic.':null);
 return <PremiumPlayerResearch player={player} market={market} selected={selected} side={analysis.side} favourite={favourite} canFollow={!!group} onCategory={setCategory} onBook={selectBook} onOffer={select} onFavourite={toggleFavourite}
  research={displayGroup?<>
   <PropExplorer group={displayGroup} games={unavailable?[]:history?.gameLog||[]} loading={historyLoading} unavailableReason={unavailable} hideBookFilter state={analysis} onState={next=>{if(next.side!==analysis.side){const quote=chooseOffer(market,selected.book,selected.line,next.side);if(quote?.side===next.side)setSelected(quote);}setAnalysis({...next,book:selected.book});}} favourite={favourite} onFavourite={toggleFavourite}/>
   {historyError&&<button className={styles.button} onClick={()=>setRetry(n=>n+1)}>Retry history</button>}
  </>:<p className={styles.status}>This is a {selected.choice} outcome, not a numeric Over/Under line. Its quote is preserved; a numeric history chart is not substituted.</p>}
  model={<ModelPanel player={player} market={market} offer={selected} researchLine={analysis.line} researchSide={analysis.side}/>}
  gameLog={group&&history?.available&&!historyError?<GameLog games={history.gameLog||[]} line={analysis.line} market={marketName(market)} loading={historyLoading}/>:null}
 />;
}
type MarketReference={available?:boolean;projection?:number|null;evPercent?:number|null;fairProbability?:number|null;fairPrice?:number|null;bookmaker?:string|null;basis?:string};
function ModelPanel({player,market,offer,researchLine,researchSide}:{player:WorkspacePlayer;market:WorkspaceMarket;offer:WorkspaceOffer;researchLine:number;researchSide:string}){
 const [model,setModel]=React.useState<WorkspacePrediction|null>(null),[reference,setReference]=React.useState<MarketReference|null>(null),[loading,setLoading]=React.useState(false),[error,setError]=React.useState(''),[now,setNow]=React.useState(Date.now());
 React.useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(id);},[]);
 React.useEffect(()=>{
  const c=new AbortController();setModel(null);setReference(null);setError('');setLoading(true);
  void workspaceGet<{prediction:WorkspacePrediction;marketReference?:MarketReference|null}>('model',{sport:player.sport,event:player.eventId,player:player.key,market:market.key,offer:offer.key},c.signal).then(body=>{if(!c.signal.aborted){setModel(body.prediction);setReference(body.marketReference||null);}}).catch(cause=>{if(!c.signal.aborted)setError(message(cause));}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
  return()=>c.abort();
 },[player.key,player.sport,player.eventId,market.key,offer.key]);
 const exact=offer.line!==null&&researchLine===offer.line&&researchSide===offer.side;
 const fresh=!!model?.expiresAt&&Number.isFinite(Date.parse(model.expiresAt))&&Date.parse(model.expiresAt)>now;
 const valid=exact&&fresh&&model?.available&&model.code==='READY'&&model.modelVersion&&model.validation?.method==='chronological-heldout-real-lines';
 const ev=valid?expectedValue(model,offer,now):null;
 const marketProjection=typeof reference?.projection==='number'?reference.projection:null;
 const marketEv=typeof reference?.evPercent==='number'?reference.evPercent:null;
 const fairProbability=typeof reference?.fairProbability==='number'?(reference.fairProbability<=1?reference.fairProbability*100:reference.fairProbability):null;
 return <section className={styles.panel} aria-label="Projection and EV reference"><h2>{valid?'Model prediction':reference?.available?'Market reference':'Projection / EV'}</h2>
  {valid?<><div className={styles.forecast}><span>Projection<strong>{typeof model.projection==='number'?model.projection.toFixed(2):'—'}</strong></span><span>Over<strong>{typeof model.probabilityOver==='number'?(model.probabilityOver*100).toFixed(1)+'%':'—'}</strong></span><span>Under<strong>{typeof model.probabilityUnder==='number'?(model.probabilityUnder*100).toFixed(1)+'%':'—'}</strong></span><span>Selected-quote EV<strong>{ev===null?'—':(ev>0?'+':'')+ev.toFixed(1)+'%'}</strong></span></div><p className={styles.muted}>Version {model.modelVersion} · Generated {shortTime(model.generatedAt)} · {model.validation?.events??'—'} held-out events. {offer.dfs?'DFS entry payouts are not treated as single-leg American odds.':'Pushes contribute zero profit to EV.'}</p></>
  :reference?.available?<><div className={styles.forecast}><span>Market projection<strong>{marketProjection===null?'—':marketProjection.toFixed(2)}</strong></span><span>No-vig market EV<strong>{marketEv===null?'—':(marketEv>0?'+':'')+marketEv.toFixed(1)+'%'}</strong></span><span>Fair probability<strong>{fairProbability===null?'—':fairProbability.toFixed(1)+'%'}</strong></span><span>Reference book<strong>{reference.bookmaker||'Market consensus'}</strong></span></div><p className={styles.muted}>PropLine market-implied and no-vig reference for this exact posted line. This does not depend on a trained model.</p></>
  :<p className={styles.muted}>{!exact?'Select a posted line to request an exact market reference. The adjusted research line is not a book quote.':loading?'Checking live market reference…':error||(model?.available&&!fresh?'This model forecast expired and no market reference was returned.':model?.message)||'No market-implied reference is available for this exact selection yet.'}</p>}
 </section>;
}
