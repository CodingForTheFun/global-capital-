'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart3, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, RefreshCw, Search, SlidersHorizontal, Star, User } from 'lucide-react';
import { ApiError, fetchAccount, fetchBoard, fetchResearch } from '@/lib/api';
import { collapsePlayerCards, playerResearchHref, restrictBook, type PlayerCardGroup } from '@/lib/player-cards';
import type { BoardMeta, PropGroup, ResearchResponse } from '@/lib/types';
import { quotePriceLabel, quoteSeenLabel, quoteVariant, variantLabel, isDfs } from '@/lib/prop-signals';
import { cardHistory } from '@/lib/card-history';
import { fetchMarketReferences, referenceKey, type MarketReference } from '@/lib/market-reference';
import { bestEv, fetchPredictions, modelLabel, predictionKey, usablePrediction, type Prediction } from '@/lib/model-data';
import { PlayerHeadshot } from '@/components/player-headshot';
import { SignInPanel } from '@/components/sign-in';
import styles from './premium-board.module.css';
const ALL = 'ALL', PAGE_SIZE = 12, RESEARCH_WORKERS = 3;
const text = (value: unknown) => String(value || '').trim();
const quoteBook = (row: PropGroup['quotes'][number]) => text(row.sportsbook || row.sportsbookKey);
function SelectPill({ label, value, options, onChange }: { label: string; value: string; options: {value: string; label: string}[]; onChange(value: string): void }) {
  return <label className={styles.filterPill}><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13}/></label>;
}
function timeLabel(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'}) : 'Time unavailable';
}
export function PremiumBoard() {
  const router = useRouter();
  const [account,setAccount] = React.useState<{id: string; email?: string} | null>(null);
  const [checking,setChecking] = React.useState(true);
  const [sport,setSport] = React.useState('NFL');
  const [sports,setSports] = React.useState(['NFL']);
  const [groups,setGroups] = React.useState<PropGroup[]>([]);
  const [meta,setMeta] = React.useState<BoardMeta>({});
  const [query,setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [market,setMarket] = React.useState(ALL), [opponent,setOpponent] = React.useState(ALL), [team,setTeam] = React.useState(ALL);
  const [book,setBook] = React.useState(ALL), [line,setLine] = React.useState(ALL), [variant,setVariant] = React.useState(ALL), [venue,setVenue] = React.useState(ALL);
  const [sort,setSort] = React.useState('PLAYER'), [pageIndex,setPageIndex] = React.useState(0);
  const [filtersOpen,setFiltersOpen] = React.useState(false), [savedOnly,setSavedOnly] = React.useState(false);
  const [saved,setSaved] = React.useState<string[]>([]);
  const [research,setResearch] = React.useState<Record<string,ResearchResponse | null>>({});
  const [predictions,setPredictions] = React.useState<Record<string,Prediction>>({});
  const [marketRefs,setMarketRefs] = React.useState<Record<string,MarketReference>>({});
  const [forecastOpen,setForecastOpen] = React.useState<string[]>([]);
  const forecastRequests = React.useRef(new Map<string,AbortController>());
  const [loading,setLoading] = React.useState(false), [error,setError] = React.useState('');
  const [refresh,setRefresh] = React.useState(0), [retry,setRetry] = React.useState(0), [now,setNow] = React.useState(Date.now());
  React.useEffect(() => { const c = new AbortController(); void fetchAccount(c.signal).then(value => {if(!c.signal.aborted){setAccount(value);setChecking(false);}}); return () => c.abort(); },[]);
  React.useEffect(() => {try { const data=JSON.parse(localStorage.getItem('oblige.reference.saved.v1') || '[]'); if(Array.isArray(data))setSaved(data.filter(value=>typeof value==='string').slice(0,200)); }catch{} },[]);
  React.useEffect(() => {const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  React.useEffect(() => () => {for(const c of forecastRequests.current.values())c.abort();},[]);
  React.useEffect(() => {
    if(!account || checking)return;
    const c = new AbortController(); setLoading(true); setError('');
    // Sport switches never show the previous sport's cards beneath the new label.
    setGroups([]);setResearch({});setPredictions({});setMarketRefs({});setForecastOpen([]);setPageIndex(0);
    for(const controller of forecastRequests.current.values())controller.abort();forecastRequests.current.clear();
    void fetchBoard(sport,c.signal).then(board=>{if(c.signal.aborted)return;setGroups(board.groups);setMeta(board.meta);if(board.supportedSports.length)setSports([...new Set(board.supportedSports.map(s=>text(s).toUpperCase()))]);})
      .catch(cause=>{if(c.signal.aborted)return;if(cause instanceof ApiError&&cause.status===401)setAccount(null);else setError(cause instanceof Error?cause.message:'The board could not load.');})
      .finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[account,checking,sport,refresh]);
  function changeSport(next: string) {setSport(next);setMarket(ALL);setOpponent(ALL);setTeam(ALL);setBook(ALL);setLine(ALL);setVariant(ALL);setVenue(ALL);setPageIndex(0);}
  const options = React.useMemo(()=>({
    markets:[...new Set(groups.map(g=>g.market))].sort(),opponents:[...new Set(groups.map(g=>g.opponent).filter((v):v is string=>!!v))].sort(),teams:[...new Set(groups.map(g=>g.team).filter((v):v is string=>!!v))].sort(),
    lines:[...new Set(groups.map(g=>String(g.line)))].sort((a,b)=>Number(a)-Number(b)),books:[...new Set(groups.flatMap(g=>g.quotes.map(quoteBook)).filter(Boolean))].sort(),
  }),[groups]);
  // Expensive identity reconciliation depends on filters, not each arriving history/forecast.
  const filtered = React.useMemo(()=>{
    const needle=deferredQuery.trim().toLowerCase();
    const rows=groups.map(g=>book===ALL?g:restrictBook(g,book)).filter(g=>
      (market===ALL||g.market===market)&&(opponent===ALL||g.opponent===opponent)&&(team===ALL||g.team===team)&&(line===ALL||String(g.line)===line)&&
      (variant===ALL||quoteVariant(g.quotes[0])===variant)&&(book===ALL||g.quotes.some(q=>quoteBook(q)===book))&&
      (venue===ALL||(venue==='home'?!!g.team&&g.team===g.homeTeam:!!g.team&&g.team===g.awayTeam))&&
      (!needle||`${g.player} ${g.market} ${g.matchup} ${g.team||''}`.toLowerCase().includes(needle)));
    return collapsePlayerCards(rows,groups).filter(g=>!savedOnly||saved.includes(g.playerCardKey)).sort((a,b)=>sort==='LINE'?b.line-a.line:a.player.localeCompare(b.player));
  },[groups,book,market,opponent,team,line,variant,venue,deferredQuery,savedOnly,saved,sort]);
  React.useEffect(()=>setPageIndex(0),[sport,market,opponent,team,line,book,variant,venue,deferredQuery,savedOnly,sort]);
  const lastPage=Math.max(0,Math.ceil(filtered.length/PAGE_SIZE)-1), currentPage=Math.min(pageIndex,lastPage);
  const page=filtered.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  const pageKey=page.map(g=>g.key).join('|');
  React.useEffect(()=>{
    if(!account||!page.length)return;
    const c=new AbortController(),queue=page.filter(g=>research[g.key]===undefined);
    async function worker(){while(queue.length&&!c.signal.aborted){const group=queue.shift()!;try{const response=await fetchResearch(group,'OVER',c.signal);if(!c.signal.aborted)setResearch(previous=>({...previous,[group.key]:response}));}catch{if(!c.signal.aborted)setResearch(previous=>({...previous,[group.key]:null}));}}}
    void Promise.all(Array.from({length:Math.min(RESEARCH_WORKERS,queue.length)},worker));return()=>c.abort();
    // The page cohort stays stable while data streams in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[account,pageKey,retry]);
  function toggleSaved(key:string){setSaved(previous=>{const next=previous.includes(key)?previous.filter(value=>value!==key):[...previous,key].slice(-200);try{localStorage.setItem('oblige.reference.saved.v1',JSON.stringify(next));}catch{}return next;});}
  function loadForecast(group:PropGroup){
    setForecastOpen(previous=>previous.includes(group.key)?previous:[...previous,group.key]);
    if(forecastRequests.current.has(group.key))return;
    const c=new AbortController();forecastRequests.current.set(group.key,c);
    // Independent reads start together; a slow model never blocks a market reference.
    void Promise.allSettled([
      fetchPredictions([group],c.signal,values=>{if(!c.signal.aborted)setPredictions(previous=>({...previous,...values}));},12000),
      fetchMarketReferences([group],c.signal,values=>{if(!c.signal.aborted)setMarketRefs(previous=>({...previous,...values}));}),
    ]).finally(()=>{if(forecastRequests.current.get(group.key)===c)forecastRequests.current.delete(group.key);});
  }
  const choices=(values:string[],label:string)=>[{value:ALL,label},...values.map(value=>({value,label:value}))];
  function openResearch(group:PlayerCardGroup){router.push(playerResearchHref(group,group.playerCardKey,book===ALL?null:book));}
  if(checking)return <div className={styles.loading} role="status">Opening your workspace…</div>;
  if(!account)return <div className={styles.signIn}><SignInPanel onSignedIn={setAccount}/></div>;
  return <section className={styles.shell} data-design="reference-cards-v1">
    <aside className={styles.sidebar} aria-label="Workspace navigation">
      <span className={styles.sideCaption}>WORKSPACE</span>
      <button aria-pressed={!savedOnly} onClick={()=>setSavedOnly(false)}><LayoutGrid size={18}/> All props</button>
      <button aria-pressed={savedOnly} onClick={()=>setSavedOnly(true)}><Star size={18}/> Saved props <small>{saved.length}</small></button>
      <Link href="/research"><BarChart3 size={18}/> Player research</Link>
      <Link href="/account"><User size={18}/> My account</Link>
      <div className={styles.sideNote}><span/> Research with real numbers.<p>Compare the line. Explore the history. Make your own call.</p></div>
    </aside>
    <div className={styles.board}>
      <header className={styles.heading}><div><span className={styles.eyebrow}>THE RESEARCH DESK</span><h1>{savedOnly?'Saved props':'Player props'}</h1></div><button className={styles.refresh} aria-label="Refresh props" disabled={loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={16}/> <span>Refresh</span></button></header>
      <nav className={styles.sportNav} aria-label="Sports">{sports.slice(0,7).map(value=><button key={value} aria-pressed={sport===value} onClick={()=>changeSport(value)}>{value}</button>)}{sports.length>7&&<label className={styles.moreSports}>More <ChevronDown size={13}/><select aria-label="All sports" value={sport} onChange={event=>changeSport(event.target.value)}>{sports.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}</nav>
      <div className={styles.toolbar}><label className={styles.search}><Search size={18}/><input aria-label="Search players, teams, or props" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search players, teams, or props…"/></label><button className={styles.filterToggle} aria-expanded={filtersOpen} aria-controls="board-filters" onClick={()=>setFiltersOpen(value=>!value)}><SlidersHorizontal size={17}/><span>Filters</span>{[market,opponent,team,book,line,variant,venue].filter(value=>value!==ALL).length>0&&<i/>}</button><button className={styles.savedToggle} aria-label="Show saved props" aria-pressed={savedOnly} onClick={()=>setSavedOnly(value=>!value)}><Star size={18} fill={savedOnly?'currentColor':'none'}/></button></div>
      <div id="board-filters" className={styles.filters} data-open={filtersOpen}>
        <SelectPill label="Stat" value={market} onChange={setMarket} options={choices(options.markets,'All stats')}/><SelectPill label="Book" value={book} onChange={setBook} options={choices(options.books,'All books')}/>
        <SelectPill label="Prop type" value={variant} onChange={setVariant} options={[{value:ALL,label:'All prop types'},{value:'standard',label:'Standard'},{value:'goblin',label:'Green Goblin'},{value:'demon',label:'Red Demon'},{value:'boost',label:'Underdog boost'},{value:'discount',label:'Underdog discount'},{value:'alternate',label:'Alternates'}]}/>
        <SelectPill label="Opponent" value={opponent} onChange={setOpponent} options={choices(options.opponents,'Any opponent')}/><SelectPill label="Team" value={team} onChange={setTeam} options={choices(options.teams,'Any team')}/><SelectPill label="Line" value={line} onChange={setLine} options={choices(options.lines,'Any line')}/>
        <SelectPill label="Home/Away" value={venue} onChange={setVenue} options={[{value:ALL,label:'Home & away'},{value:'home',label:'Home'},{value:'away',label:'Away'}]}/>
        <SelectPill label="Sort" value={sort} onChange={setSort} options={[{value:'PLAYER',label:'Player name'},{value:'LINE',label:'Highest line'}]}/>
        <button className={styles.reset} onClick={()=>{setMarket(ALL);setOpponent(ALL);setTeam(ALL);setBook(ALL);setLine(ALL);setVariant(ALL);setVenue(ALL);}}>Reset filters</button>
      </div>
      <div className={styles.resultBar}><span>{loading?'Loading slate…':`${filtered.length.toLocaleString()} players`} <i>·</i> {sport}</span><span>{meta.stale?'Cached feed':'Latest board snapshot'}</span></div>
      {error&&<div className={styles.empty} role="alert"><strong>We couldn’t load this slate.</strong><p>{error}</p><button onClick={()=>setRefresh(value=>value+1)}>Try again</button></div>}
      {loading&&<div className={styles.cards} aria-label="Loading props" aria-busy="true">{[0,1,2,3].map(value=><div key={value} className={styles.skeleton}><div/><div/><div/></div>)}</div>}
      {!loading&&!error&&<div className={styles.cards}>{page.map(group=>{
        const result=research[group.key], metrics=cardHistory(result,group), savedCard=saved.includes(group.playerCardKey);
        const badges=[...new Map(group.specialVariants.map(item=>[quoteVariant(item.quotes[0]),item])).values()];
        const books=[...new Map(group.quotes.map(quote=>[quoteBook(quote),quote])).entries()];
        const prediction=predictions[predictionKey(group)], reference=marketRefs[referenceKey(group)];
        const valid=usablePrediction(prediction,now), fresh=reference&&reference.expiresAt>now?reference:null;
        const projection=valid?prediction.projection:fresh?.projection;
        const modelEv=bestEv(group,prediction,now), ev=modelEv??fresh?.ev;
        return <article key={group.playerCardKey} className={styles.card} data-player-card={group.playerCardKey}>
          <div className={styles.cardHeader}><button className={styles.identity} onClick={()=>openResearch(group)} aria-label={`Research ${group.player}`}><span className={styles.portrait}><PlayerHeadshot sport={group.sport} name={group.player} team={group.team} providerPlayerId={group.providerPlayerId}/></span><span className={styles.playerInfo}><strong>{group.player} {group.position&&<small>({group.position})</small>}</strong><span className={styles.propTitle}>O/U <b>{group.line}</b> {group.market}</span><small>{group.matchup} <i>·</i> {timeLabel(group.startsAt)}</small></span></button><button className={styles.save} aria-label={`${savedCard?'Unsave':'Save'} ${group.player}`} aria-pressed={savedCard} onClick={()=>toggleSaved(group.playerCardKey)}><Star size={19} fill={savedCard?'currentColor':'none'}/></button></div>
          <div className={styles.context}><span>{group.sport}</span>{group.team&&<span>{group.team}</span>}{group.categoryCount>1&&<button onClick={()=>openResearch(group)}>{group.categoryCount} stat categories <ChevronRight size={12}/></button>}{badges.map(item=><Link prefetch={false} key={item.key} className={styles.variant} data-variant={quoteVariant(item.quotes[0])} href={playerResearchHref(item,group.playerCardKey,item.quotes[0]?.sportsbookKey||item.quotes[0]?.sportsbook)}>{variantLabel(item.quotes[0])}</Link>)}</div>
          <div className={styles.metrics} aria-label="Historical over results">{metrics.map(metric=>{
            const tone=metric.value===null?'none':metric.tone||(metric.percent?(metric.value>=60?'positive':metric.value<40?'negative':'neutral'):metric.label==='DIFF'?(metric.value>=0?'positive':'negative'):'neutral');
            return <div key={metric.label} className={styles.metric} data-tone={tone} title={metric.value===null?(result===undefined?'Loading verified history':result===null?'History request failed. Use Retry history.':'No verified sample for this statistic'):`${metric.note||'Historical overs'}${metric.sample?` · ${metric.sample} games`:''}`}><span>{metric.label}</span><strong>{result===undefined?'…':metric.value===null?'—':`${metric.label==='DIFF'&&metric.value>0?'+':''}${Number(metric.value.toFixed(metric.percent?0:1))}${metric.percent?'%':''}`}</strong></div>;
          })}</div>
          <div className={styles.bookStrip} aria-label="Available sportsbook prices">{books.map(([name,quote])=>{const pair=group.quotes.filter(q=>quoteBook(q)===name);return <Link prefetch={false} key={name} href={playerResearchHref(group,group.playerCardKey,name)} className={styles.bookQuote}><span className={styles.bookLogo} data-book={quote.sportsbookKey}>{name.replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase()}</span><span><b>{name}</b><span data-label="Odds">{isDfs(quote)?quotePriceLabel(quote):<><i>O</i> {quotePriceLabel(pair.find(q=>q.side==='OVER'))} <em>U</em> {quotePriceLabel(pair.find(q=>q.side==='UNDER'))}</>}</span></span></Link>;})}</div>
          <footer className={styles.cardFooter}><span>{quoteSeenLabel(group.quotes[0],now)}</span><button onClick={()=>loadForecast(group)}>Forecast</button>{result===null&&<button onClick={()=>{setResearch(previous=>{const next={...previous};delete next[group.key];return next;});setRetry(value=>value+1);}}>Retry history</button>}<button className={styles.researchLink} onClick={()=>openResearch(group)}>Research <ArrowRight size={14}/></button></footer>
          {forecastOpen.includes(group.key)&&<div className={styles.forecast} aria-live="polite"><span data-label="Proj">Projection <strong>{projection!=null?projection.toFixed(1):prediction===undefined||reference===undefined?'…':'Unavailable'}</strong><small>{valid?modelLabel(prediction):'Market implied'}</small></span><span>EV <strong>{ev!=null?`${ev>0?'+':''}${ev.toFixed(1)}%`:isDfs(group.quotes[0])?'Entry payout':prediction===undefined||reference===undefined?'…':'Unavailable'}</strong><small>{modelEv!=null?modelLabel(prediction):'Market no-vig'}</small></span><button aria-label="Close forecast" onClick={()=>setForecastOpen(previous=>previous.filter(key=>key!==group.key))}>×</button></div>}
        </article>;
      })}</div>}
      {!loading&&!error&&!page.length&&<div className={styles.empty}><strong>{savedOnly?'No saved props in this slate':'No matching props'}</strong><p>{savedOnly?'Tap a star on any player to keep them here on this device.':'Try another sport or reset your filters.'}</p></div>}
      {filtered.length>PAGE_SIZE&&<nav className={styles.pagination} aria-label="Prop pages"><button disabled={currentPage===0} onClick={()=>{setPageIndex(currentPage-1);window.scrollTo({top:0,behavior:'instant'});}}><ChevronLeft size={16}/> Previous</button><span>{currentPage+1} / {lastPage+1}</span><button disabled={currentPage===lastPage} onClick={()=>{setPageIndex(currentPage+1);window.scrollTo({top:0,behavior:'instant'});}}>Next <ChevronRight size={16}/></button></nav>}
      <p className={styles.footnote}>History tiles measure overs at the displayed line. — means no verified sample. Saved props stay on this device.</p>
    </div>
  </section>;
}
