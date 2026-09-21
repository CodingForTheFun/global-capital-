'use client';
// Release path marker: player prop deep-dive rollout is covered by the guarded frontend verification workflows.
// Release path marker: dense board acceptance verifies automatic visible-row PROJ and EV loading.
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight, Crown, Dog, RefreshCw, Search, Shield, Star } from 'lucide-react';
import { ApiError, fetchAccount, fetchBoard, fetchResearch } from '@/lib/api';
import { collapsePlayerCards, playerResearchHref, restrictBook, isSavedCard, toggleSavedCard, type PlayerCardGroup } from '@/lib/player-cards';
import type { BoardMeta, PropGroup, ResearchResponse } from '@/lib/types';
import { quotePriceLabel, quoteSeenLabel, quoteVariant, variantLabel, isDfs } from '@/lib/prop-signals';
import { cardHistory } from '@/lib/card-history';
import { marketName, periodName } from '@/lib/market-display';
import { legacyPeriod } from '@/lib/legacy-research-presentation';
import { fetchMarketReferences, referenceKey, type MarketReference } from '@/lib/market-reference';
import { bestEv, fetchPredictions, modelLabel, predictionKey, usablePrediction, type Prediction } from '@/lib/model-data';
import { DfsVariantIcon } from '@/components/dfs-variant-icon';
import { PlayerHeadshot } from '@/components/player-headshot';
import { SignInPanel } from '@/components/sign-in';
import styles from './premium-board.module.css';
const ALL = 'ALL', PAGE_SIZE = 12, RESEARCH_WORKERS = 3;
const text = (value: unknown) => String(value || '').trim();
const quoteBook = (row: PropGroup['quotes'][number]) => text(row.sportsbook || row.sportsbookKey);
function SelectPill({ label, value, options, onChange }: { label: string; value: string; options: {value: string; label: string}[]; onChange(value: string): void }) {
  return <label className={styles.filterPill}><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13}/></label>;
}
function statLabel(group: PropGroup) {
  const scope = legacyPeriod(group);
  return [marketName({label:scope.label,marketKey:group.marketId||scope.label}),scope.period?periodName(scope.period):''].filter(Boolean).join(' · ');
}
const SPORT_ORDER = ['NBA','WNBA','MLB','NFL','NHL','NCAAF','NCAAB'];
const SPORT_LABELS: Record<string,string> = { NCAAF:'CFB', NCAAB:'CBB' };
function sportLabel(value: string) { return SPORT_LABELS[value.toUpperCase()] || value.toUpperCase(); }
function orderedSports(values: string[]) {
  const rank = new Map(SPORT_ORDER.map((value,index)=>[value,index]));
  return [...new Set(values.map(value=>value.toUpperCase()))].sort((a,b)=>(rank.get(a)??99)-(rank.get(b)??99)||a.localeCompare(b));
}
function seasonLabel(group: PropGroup): string | null {
  if(!group.startsAt || !Number.isFinite(Date.parse(group.startsAt))) return null;
  const date=new Date(group.startsAt), year=date.getFullYear(), month=date.getMonth(), key=group.sport.toUpperCase();
  if(['NBA','NHL','NCAAB','CBB'].includes(key)){const start=month>=6?year:year-1;return `${start}-${String(start+1).slice(-2)}`;}
  if(['NFL','NCAAF','CFB'].includes(key)) return String(month>=6?year:year-1);
  return String(year);
}
function timeLabel(value: string | null) {
  if(!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  const date=new Date(value), now=new Date();
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const target=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
  const days=Math.round((target-start)/86400000);
  const day=days===0?'Today':days===1?'Tomorrow':date.toLocaleDateString(undefined,{weekday:'short'});
  return `${day} ${date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`;
}
function bookShort(name: string) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g,'');
  return ({draftkings:'DK',fanduel:'FD',fanatics:'FAN',betmgm:'MGM',betrivers:'BR',betus:'BUS',prizepicks:'PP',underdog:'UD',bovada:'BOV',pinnacle:'PIN',prophetx:'PX',fliff:'FL',hardrockbet:'HR',kalshi:'KAL'} as Record<string,string>)[key] || name;
}
function BookGlyph({name}:{name:string}) {
  const key=name.toLowerCase().replace(/[^a-z0-9]/g,'');
  if(key==='underdog') return <Dog size={14} strokeWidth={2.4}/>;
  if(key==='draftkings') return <Crown size={14} strokeWidth={2.4}/>;
  if(key==='fanduel') return <Shield size={14} strokeWidth={2.4}/>;
  return <span>{bookShort(name)}</span>;
}
export function PremiumBoard() {
  const router = useRouter();
  const [account,setAccount] = React.useState<{id: string; email?: string} | null>(null);
  const [checking,setChecking] = React.useState(true);
  const [sport,setSport] = React.useState('NBA');
  const [sports,setSports] = React.useState(['NBA','WNBA','MLB','NFL','NHL','NCAAF','NCAAB']);
  const [groups,setGroups] = React.useState<PropGroup[]>([]);
  const [meta,setMeta] = React.useState<BoardMeta>({});
  const [query,setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [market,setMarket] = React.useState(ALL), [opponent,setOpponent] = React.useState(ALL), [team,setTeam] = React.useState(ALL), [season,setSeason] = React.useState(ALL);
  const [book,setBook] = React.useState(ALL), [line,setLine] = React.useState(ALL), [variant,setVariant] = React.useState(ALL), [venue,setVenue] = React.useState(ALL);
  const [sort,setSort] = React.useState('EV'), [pageIndex,setPageIndex] = React.useState(0);
  const [savedOnly,setSavedOnly] = React.useState(false);
  const [saved,setSaved] = React.useState<string[]>([]);
  const [research,setResearch] = React.useState<Record<string,ResearchResponse | null>>({});
  const [predictions,setPredictions] = React.useState<Record<string,Prediction>>({});
  const [marketRefs,setMarketRefs] = React.useState<Record<string,MarketReference>>({});
  const [loading,setLoading] = React.useState(false), [error,setError] = React.useState('');
  const [refresh,setRefresh] = React.useState(0), [retry,setRetry] = React.useState(0), [now,setNow] = React.useState(Date.now());
  React.useEffect(() => { const c = new AbortController(); void fetchAccount(c.signal).then(value => {if(!c.signal.aborted){setAccount(value);setChecking(false);}}); return () => c.abort(); },[]);
  React.useEffect(() => {try { const data=JSON.parse(localStorage.getItem('oblige.reference.saved.v1') || '[]'); if(Array.isArray(data))setSaved(data.filter(value=>typeof value==='string').slice(0,200)); }catch{} },[]);
  React.useEffect(() => {const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  React.useEffect(() => {
    if(!account || checking)return;
    const c = new AbortController(); setLoading(true); setError('');
    // Sport switches never show the previous sport's cards beneath the new label.
    setGroups([]);setResearch({});setPredictions({});setMarketRefs({});setPageIndex(0);
    void fetchBoard(sport,c.signal).then(board=>{if(c.signal.aborted)return;setGroups(board.groups);setMeta(board.meta);if(board.supportedSports.length)setSports([...new Set(board.supportedSports.map(s=>text(s).toUpperCase()))]);})
      .catch(cause=>{if(c.signal.aborted)return;if(cause instanceof ApiError&&cause.status===401)setAccount(null);else setError(cause instanceof Error?cause.message:'The board could not load.');})
      .finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[account,checking,sport,refresh]);
  function changeSport(next: string) {setSport(next);setMarket(ALL);setOpponent(ALL);setTeam(ALL);setSeason(ALL);setBook(ALL);setLine(ALL);setVariant(ALL);setVenue(ALL);setPageIndex(0);}
  const options = React.useMemo(()=>({
    markets:[...new Map(groups.map(g=>[g.market,{value:g.market,label:statLabel(g)}])).values()].sort((a,b)=>a.label.localeCompare(b.label)),opponents:[...new Set(groups.map(g=>g.opponent).filter((v):v is string=>!!v))].sort(),teams:[...new Set(groups.map(g=>g.team).filter((v):v is string=>!!v))].sort(),
    seasons:[...new Set(groups.map(seasonLabel).filter((value): value is string=>Boolean(value)))].sort().reverse(),
    lines:[...new Set(groups.map(g=>String(g.line)))].sort((a,b)=>Number(a)-Number(b)),books:[...new Set(groups.flatMap(g=>g.quotes.map(quoteBook)).filter(Boolean))].sort(),
  }),[groups]);
  // Expensive identity reconciliation depends on filters, not each arriving history/forecast.
  const filtered = React.useMemo(()=>{
    const needle=deferredQuery.trim().toLowerCase();
    const rows=groups.map(g=>book===ALL?g:restrictBook(g,book)).filter(g=>
      (market===ALL||g.market===market)&&(opponent===ALL||g.opponent===opponent)&&(team===ALL||g.team===team)&&(season===ALL||seasonLabel(g)===season)&&(line===ALL||String(g.line)===line)&&
      (variant===ALL||quoteVariant(g.quotes[0])===variant)&&(book===ALL||g.quotes.some(q=>quoteBook(q)===book))&&
      (venue===ALL||(venue==='home'?!!g.team&&g.team===g.homeTeam:!!g.team&&g.team===g.awayTeam))&&
      (!needle||`${g.player} ${statLabel(g)} ${g.matchup} ${g.team||''}`.toLowerCase().includes(needle)));
    const cards=collapsePlayerCards(rows,groups).filter(g=>!savedOnly||isSavedCard(g,saved));
    const edge=(group:PropGroup)=>bestEv(group,predictions[predictionKey(group)],now)??((marketRefs[referenceKey(group)]?.expiresAt??0)>now?marketRefs[referenceKey(group)]?.ev:null);
    return cards.sort((a,b)=>sort==='LINE'?b.line-a.line:sort==='EV'?((edge(b)??Number.NEGATIVE_INFINITY)-(edge(a)??Number.NEGATIVE_INFINITY)||a.player.localeCompare(b.player)):a.player.localeCompare(b.player));
  },[groups,book,market,opponent,team,season,line,variant,venue,deferredQuery,savedOnly,saved,sort,predictions,marketRefs,now]);
  React.useEffect(()=>setPageIndex(0),[sport,market,opponent,team,season,line,book,variant,venue,deferredQuery,savedOnly,sort]);
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
  React.useEffect(()=>{
    if(!account||!page.length)return;
    const targets=page.filter(group=>predictions[predictionKey(group)]===undefined||marketRefs[referenceKey(group)]===undefined);
    if(!targets.length)return;
    const c=new AbortController();
    void Promise.allSettled([
      fetchPredictions(targets,c.signal,values=>{if(!c.signal.aborted)setPredictions(previous=>({...previous,...values}));},12000),
      fetchMarketReferences(targets,c.signal,values=>{if(!c.signal.aborted)setMarketRefs(previous=>({...previous,...values}));}),
    ]);
    return()=>c.abort();
    // Visible-page forecast/reference reads are bounded and do not widen provider polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[account,pageKey,retry]);
  function toggleSaved(group:PlayerCardGroup){setSaved(previous=>{const next=toggleSavedCard(group,previous);try{localStorage.setItem('oblige.reference.saved.v1',JSON.stringify(next));}catch{}return next;});}
  const choices=(values:string[],label:string)=>[{value:ALL,label},...values.map(value=>({value,label:value}))];
  const navSports=React.useMemo(()=>orderedSports(sports),[sports]);
  function openResearch(group:PlayerCardGroup){router.push(playerResearchHref(group,group.playerCardKey,book===ALL?null:book));}
  if(checking)return <div className={styles.loading} role="status">Opening your workspace…</div>;
  if(!account)return <div className={styles.signIn}><SignInPanel onSignedIn={setAccount}/></div>;
  return <section className={styles.shell} data-design="modern-dense">
    <div className={styles.board}>
      <div className={styles.heading}><div><h1>{savedOnly?'Saved props':'Player props'}</h1></div><button className={styles.refresh} aria-label="Refresh props" disabled={loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={16}/> <span>Refresh</span></button></div>
      <div className={styles.topRow}>
        <nav className={styles.sportNav} aria-label="Sports">{navSports.slice(0,7).map(value=><button key={value} aria-pressed={sport===value} onClick={()=>changeSport(value)}>{sportLabel(value)}</button>)}{navSports.length>7&&<label className={styles.moreSports}>More <ChevronDown size={13}/><select aria-label="All sports" value={sport} onChange={event=>changeSport(event.target.value)}>{navSports.map(value=><option key={value} value={value}>{sportLabel(value)}</option>)}</select></label>}</nav>
        <label className={styles.search}><Search size={18}/><input aria-label="Search players, teams, or props" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search players, teams, or props..."/></label>
        <button className={styles.savedToggle} aria-label="Show saved props" aria-pressed={savedOnly} onClick={()=>setSavedOnly(value=>!value)}><Star size={18} fill={savedOnly?'currentColor':'none'}/></button>
      </div>
      <div id="board-filters" className={styles.filters}>
        <SelectPill label="Opponent" value={opponent} onChange={setOpponent} options={choices(options.opponents,'Opponent')}/>
        <SelectPill label="Stat" value={market} onChange={setMarket} options={[{value:ALL,label:'Stat'},...options.markets]}/>
        <SelectPill label="Season" value={season} onChange={setSeason} options={choices(options.seasons,'Season')}/>
        <SelectPill label="Home/Away" value={venue} onChange={setVenue} options={[{value:ALL,label:'Home/Away'},{value:'home',label:'Home'},{value:'away',label:'Away'}]}/>
        <SelectPill label="Team" value={team} onChange={setTeam} options={choices(options.teams,'Team')}/>
        <SelectPill label="Book" value={book} onChange={setBook} options={choices(options.books,'Book')}/>
        <SelectPill label="Line" value={line} onChange={setLine} options={choices(options.lines,'Line')}/>
        <SelectPill label="More" value={variant} onChange={setVariant} options={[{value:ALL,label:'More'},{value:'standard',label:'Standard'},{value:'goblin',label:'Green Goblin'},{value:'demon',label:'Red Demon'},{value:'boost',label:'Underdog boost'},{value:'discount',label:'Underdog discount'},{value:'alternate',label:'Alternates'}]}/>
        <SelectPill label="EV% Sort" value={sort} onChange={setSort} options={[{value:'EV',label:'EV% Sort'},{value:'PLAYER',label:'Player A–Z'},{value:'LINE',label:'Highest line'}]}/>
        <button className={styles.reset} onClick={()=>{setMarket(ALL);setOpponent(ALL);setTeam(ALL);setSeason(ALL);setBook(ALL);setLine(ALL);setVariant(ALL);setVenue(ALL);setSort('EV');}}>Reset filters</button>
      </div>
      <div className={styles.resultBar}><span>{loading?'Loading slate…':`${filtered.length.toLocaleString()} players`} <i>·</i> {sport}</span><span>{meta.stale?'Cached feed':'Latest board snapshot'}</span></div>
      {error&&<div className={styles.empty} role="alert"><strong>We couldn’t load this slate.</strong><p>{error}</p><button onClick={()=>setRefresh(value=>value+1)}>Try again</button></div>}
      {loading&&<div className={styles.cards} aria-label="Loading props" aria-busy="true">{[0,1,2,3].map(value=><div key={value} className={styles.skeleton}><div/><div/><div/></div>)}</div>}
      {!loading&&!error&&page.length>0&&<div className={styles.tableWrap} role="region" aria-label="Scrollable prop comparison" tabIndex={0}><table className={styles.table} aria-label="Player props"><thead><tr><th>Player</th><th>Matchup</th><th>Stat</th><th>Line</th><th>Odds</th><th>Proj</th><th>EV%</th><th>Hit rate</th><th>Books</th><th>Action</th></tr></thead><tbody>{page.map(group=>{
        const result=research[group.key], hit=cardHistory(result,group).find(metric=>metric.label==='L10'), savedCard=isSavedCard(group,saved);
        const badges=[...new Map(group.specialVariants.map(item=>[quoteVariant(item.quotes[0]),item])).values()];
        const books=[...new Map(group.quotes.map(quote=>[quoteBook(quote),quote])).entries()];
        const prediction=predictions[predictionKey(group)], reference=marketRefs[referenceKey(group)];
        const valid=usablePrediction(prediction,now), fresh=reference&&reference.expiresAt>now?reference:null;
        const projection=valid?prediction.projection:fresh?.projection;
        const modelEv=bestEv(group,prediction,now), ev=modelEv??fresh?.ev;
        const pending=prediction===undefined||reference===undefined;
        const displayQuote=group.bestOver||group.bestUnder||group.quotes[0];
        return <tr key={group.playerCardKey} data-player-card={group.playerCardKey} onClick={event=>{if(!(event.target as HTMLElement).closest('button,a,select,input'))openResearch(group);}}>
          <td className={styles.playerCell}><div className={styles.player}><button className={styles.identity} onClick={()=>openResearch(group)} aria-label={`Research ${group.player}`}><PlayerHeadshot sport={group.sport} name={group.player} team={group.team} providerPlayerId={group.providerPlayerId}/><span><b>{group.player}</b><small>{[group.team,group.position].filter(Boolean).join(' · ')||group.sport}</small></span></button></div></td>
          <td data-label="Matchup" className={styles.matchupCell}><span className={styles.matchup}>{group.matchup}</span><small>{timeLabel(group.startsAt)}</small></td>
          <td data-label="Stat" className={styles.statCell}><button onClick={()=>openResearch(group)}>{statLabel(group)}</button>{group.categoryCount>1&&<small>{group.categoryCount} stats inside</small>}<div className={styles.variants}>{badges.map(item=><Link prefetch={false} key={item.key} className={styles.variant} data-variant={quoteVariant(item.quotes[0])} href={playerResearchHref(item,group.playerCardKey,item.quotes[0]?.sportsbookKey||item.quotes[0]?.sportsbook)}><DfsVariantIcon variant={quoteVariant(item.quotes[0])}/>{variantLabel(item.quotes[0])}</Link>)}</div></td>
          <td data-label="Line" className={styles.number}><span className={styles.linePill}>{group.line}</span></td>
          <td data-label="Odds"><span className={styles.odds}><DfsVariantIcon variant={quoteVariant(displayQuote)}/>{quotePriceLabel(displayQuote)}</span></td>
          <td data-label="Proj" className={styles.forecastCell}><strong>{projection!=null?projection.toFixed(1):pending?'…':'—'}</strong>{projection!=null&&<small>{valid?modelLabel(prediction):'Market implied'}</small>}</td>
          <td data-label="EV%" className={styles.ev} data-positive={ev!=null&&ev>0}><strong>{ev!=null?`${ev>0?'+':''}${ev.toFixed(1)}%`:pending?'…':'—'}</strong>{ev!=null&&<small>{modelEv!=null?modelLabel(prediction):fresh?.ev!=null?'Market no-vig':isDfs(displayQuote)?'DFS payout':'Verified edge'}</small>}</td>
          <td data-label="Hit rate" className={styles.historyCell}><div className={styles.hit}><span>{result===undefined?'…':hit?.value!=null?`${Math.round(hit.value)}%`:'Unavailable'}</span><i><b style={{width:`${Math.max(0,Math.min(100,hit?.value??0))}%`}}/></i></div><small>{hit?.sample?`L10 · ${hit.sample} games`:result===undefined?'Loading history':result===null?'History could not load':result?.message||'No verified L10 sample'}</small>{result!==undefined&&hit?.value==null&&<button onClick={()=>{setResearch(previous=>{const next={...previous};delete next[group.key];return next;});setRetry(value=>value+1);}}>Retry history</button>}</td>
          <td data-label="Books" className={styles.bookCell}><div className={styles.books}>{books.map(([name,quote])=><Link prefetch={false} key={name} title={name} aria-label={`Research ${name} quote`} href={playerResearchHref(group,group.playerCardKey,name)} data-book={quote.sportsbookKey}><BookGlyph name={name}/></Link>)}</div><small>{quoteSeenLabel(group.quotes[0],now)}</small></td>
          <td className={styles.actions}><div className={styles.actionControls}><button className={styles.save} aria-label={`${savedCard?'Unsave':'Save'} ${group.player}`} aria-pressed={savedCard} onClick={()=>toggleSaved(group)}><Star size={16} fill={savedCard?'currentColor':'none'}/></button><button className={styles.researchLink} aria-label={`Open ${group.player} research`} onClick={()=>openResearch(group)}><ChevronRight size={19}/></button></div></td>
        </tr>;
      })}</tbody></table></div>}
      {!loading&&!error&&!page.length&&<div className={styles.empty}><strong>{savedOnly?'No saved props in this slate':'No matching props'}</strong><p>{savedOnly?'Tap a star on any player to keep them here on this device.':'Try another sport or reset your filters.'}</p></div>}
      {filtered.length>PAGE_SIZE&&<nav className={styles.pagination} aria-label="Prop pages"><button disabled={currentPage===0} onClick={()=>{setPageIndex(currentPage-1);window.scrollTo({top:0,behavior:'instant'});}}><ChevronLeft size={16}/> Previous</button><span>{currentPage+1} / {lastPage+1}</span><button disabled={currentPage===lastPage} onClick={()=>{setPageIndex(currentPage+1);window.scrollTo({top:0,behavior:'instant'});}}>Next <ChevronRight size={16}/></button></nav>}
      <p className={styles.footnote}>Hit rates measure overs at the displayed line. Projection and EV use only verified current model or market-reference data. Open a row for the full player research view.</p>
    </div>
  </section>;
}
