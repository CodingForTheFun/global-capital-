'use client';
import * as React from 'react';
import {Minus,Plus,Star,RotateCcw} from 'lucide-react';
import type {GameLogRow,PropGroup,PropRow} from '@/lib/types';
import {applyFilters,buildWindows,computeWindow,distinct,EMPTY_FILTERS,filtersActive,headToHead,sampleFor,sortRecentFirst,type SampleFilters,type SampleId,type Window as ResearchWindow} from '@/lib/analytics';
import {isDfs,quotePriceLabel,quoteVariant} from '@/lib/prop-signals';
import {DfsVariantIcon} from '@/components/dfs-variant-icon';
import dynamic from 'next/dynamic';
import {currentSeasonGames,sportFamily} from '@/lib/player-analysis';
const HitRateChart=dynamic(()=>import('./hit-rate-chart').then(m=>m.HitRateChart),{ssr:false,loading:()=> <div style={{height:280}} role="status">Loading chart…</div>});
import {shortDate} from '@/lib/utils';
import {Skeleton} from '@/components/ui/skeleton';
import {AppliedFilter} from '@/components/applied-filter';
import {buildOpponentOptions} from '@/lib/opponent-options';
export type ExplorerState={line:number;side:'OVER'|'UNDER';book:string|null};
type ChartSample=SampleId|'l20';
const numberOrNull=(value:unknown):number|null=>{if(value==null||typeof value==='boolean'||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
function SampleTile({window:item,selected,onSelect}:{window:ResearchWindow;selected:boolean;onSelect():void}){
 return <button type="button" className="op-sample" aria-pressed={selected} onClick={onSelect}><span>{item.label==='All'?'Available':item.label}</span><strong data-tone={item.hitRate===null?'none':item.hitRate>=60?'positive':item.hitRate<45?'negative':'neutral'}>{item.hitRate===null?'—':`${item.hitRate}%`}</strong><span>Avg {item.average??'—'}</span><small>{item.games} games</small></button>;
}
/** Presentation over the existing research engine. Book controls may be supplied
 * by the canonical player workspace, which also knows books at other lines. */
export function PropExplorer({group,games,loading,unavailableReason,state,onState,favourite,onFavourite,hideBookFilter=false,currentOpponent=null,season=null}:{group:PropGroup;games:GameLogRow[];loading?:boolean;unavailableReason?:string|null;state:ExplorerState;onState(next:ExplorerState):void;favourite:boolean;onFavourite():void;hideBookFilter?:boolean;currentOpponent?:string|null;season?:number|string|null}){
 const tennis=sportFamily(group.sport)==='tennis';
 const [filters,setFilters]=React.useState<SampleFilters>(EMPTY_FILTERS),[sample,setSample]=React.useState<ChartSample>('l15');
 React.useEffect(()=>{setFilters(EMPTY_FILTERS);setSample('l15');},[group.key]);
 const played=React.useMemo(()=>unavailableReason?[]:sortRecentFirst(games.filter(g=>numberOrNull(g.value)!==null).map(g=>({...g,value:numberOrNull(g.value)}))),[games,unavailableReason]);
 const filtered=React.useMemo(()=>applyFilters(played,filters),[played,filters]);
 const windows=React.useMemo(()=>{const result=buildWindows(filtered,state.line,state.side);result[3]=computeWindow(currentSeasonGames(filtered,filters.season==='all'?season:filters.season),state.line,state.side,'season','Season');result.splice(3,0,computeWindow(filtered,state.line,state.side,'l20','L20',20));return result;},[filtered,state.line,state.side,filters.season,season]);
 const opponentIdentity=currentOpponent||group.opponent;
 const opponentOptions=React.useMemo(()=>buildOpponentOptions(distinct(played.map(g=>g.opponent)),{...group,opponent:opponentIdentity},tennis),[played,opponentIdentity,group.team,group.homeTeam,group.awayTeam,tennis]);
 const currentOpponentValue=React.useMemo(()=>opponentOptions.find(option=>option.label.endsWith(' ★'))?.value||null,[opponentOptions]);
 const h2hOpponent=filters.opponent!=='all'?filters.opponent:currentOpponentValue;
 const seasonGames=React.useMemo(()=>currentSeasonGames(filtered,filters.season==='all'?season:filters.season),[filtered,filters.season,season]);
 const h2h=React.useMemo(()=>headToHead(filtered,h2hOpponent,state.line,state.side),[filtered,h2hOpponent,state.line,state.side]);
 const chartGames=React.useMemo(()=>sample==='season'?seasonGames:sample==='l20'?filtered.slice(0,20):sampleFor(filtered,sample,h2hOpponent),[filtered,sample,h2hOpponent,seasonGames]);
 const summary=React.useMemo(()=>computeWindow(chartGames,state.line,state.side,'chart','Shown'),[chartGames,state.line,state.side]);
 const seasons=React.useMemo(()=>distinct(played.map(g=>g.season==null?null:String(g.season))).sort().reverse(),[played]);
 const books=React.useMemo(()=>{
  const map=new Map<string,{key:string;name:string;over:PropRow|null;under:PropRow|null}>();
  for(const quote of group.quotes){const name=String(quote.sportsbook||quote.sportsbookKey||'').trim();if(!name)continue;const key=(quote.sportsbookKey||name).toLowerCase();if(!map.has(key))map.set(key,{key,name,over:null,under:null});const book=map.get(key)!,p=numberOrNull(quote.price);if(!isDfs(quote)&&(p===null||p===0))continue;const side=String(quote.side||'').toUpperCase();if(side==='OVER'&&(!book.over||(p??-Infinity)>Number(book.over.price)))book.over=quote;if(side==='UNDER'&&(!book.under||(p??-Infinity)>Number(book.under.price)))book.under=quote;}
  return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
 },[group.quotes]);
 const activeBook=books.find(b=>b.key===state.book),over=activeBook?activeBook.over:group.bestOver||group.quotes.find(q=>q.side==='OVER'&&isDfs(q)&&!q.conflict),under=activeBook?activeBook.under:group.bestUnder||group.quotes.find(q=>q.side==='UNDER'&&isDfs(q)&&!q.conflict);
 const moved=Math.abs(state.line-group.line)>.001;
 const quoteOdds=(quote:PropRow|null|undefined)=>quote?quotePriceLabel(quote):'Not offered';
 const options=(values:string[])=>[{value:'all',label:'All'},...values.map(value=>({value,label:value}))];
 function step(amount:number){onState({...state,line:Math.max(-1e6,Math.min(1e6,Math.round((state.line+amount)*100)/100))});}
 return <div className="research-reference" data-release="canonical-workspace-v1">
  <div className="op-research-title"><div><span>PLAYER RESEARCH</span><h3>{group.market}</h3></div><button type="button" className="op-follow" aria-label={favourite?`Unfollow ${group.player}`:`Follow ${group.player}`} aria-pressed={favourite} onClick={onFavourite} title="Follow on this device"><Star size={19} fill={favourite?'currentColor':'none'}/></button></div>
  <div className="op-research-filters" style={{gridTemplateColumns:`repeat(${(tennis?2:3)+(hideBookFilter?0:1)},minmax(0,1fr))`}}>
   <AppliedFilter key={`${group.key}-opponent`} label="Opponent" value={filters.opponent} options={opponentOptions} onApply={opponent=>setFilters(old=>({...old,opponent}))}/>
   <AppliedFilter key={`${group.key}-season`} label="Season" value={filters.season} options={options(seasons)} onApply={season=>setFilters(old=>({...old,season}))}/>
   {!tennis&&<AppliedFilter key={`${group.key}-venue`} label="Home / Away" value={filters.venue} options={[{value:'all',label:'All'},{value:'home',label:'Home'},{value:'away',label:'Away'}]} onApply={venue=>setFilters(old=>({...old,venue:venue as SampleFilters['venue']}))}/>}
   {!hideBookFilter&&<AppliedFilter key={`${group.key}-book`} label="Book" value={state.book||'all'} options={[{value:'all',label:'Best prices'},...books.map(b=>({value:b.key,label:b.name}))]} onApply={book=>onState({...state,book:book==='all'?null:book})}/>}
  </div>
  <div className="op-sample-caption"><span className="op-sample-count">{unavailableReason?'History unavailable':`${filtered.length} of ${played.length} verified games`}</span>{filtersActive(filters)&&<button type="button" onClick={()=>setFilters(EMPTY_FILTERS)}><RotateCcw size={12}/> Clear all history filters</button>}</div>
  <div className="op-line-controls"><div className="op-line-stepper"><button type="button" aria-label="Lower research line" onClick={()=>step(-.5)}><Minus size={18}/></button><output className="op-line-number" aria-live="polite">{state.line}</output><button type="button" aria-label="Raise research line" onClick={()=>step(.5)}><Plus size={18}/></button></div><div className="op-side-picker" role="group" aria-label="Research side">{(['OVER','UNDER'] as const).map(side=><button key={side} type="button" aria-pressed={state.side===side} data-side={side} onClick={()=>onState({...state,side})}><strong>{side==='OVER'?'O':'U'} <DfsVariantIcon variant={quoteVariant(side==='OVER'?over:under)}/>{quoteOdds(side==='OVER'?over:under)}</strong><span>{side==='OVER'?'Over':'Under'}</span></button>)}</div></div>
  <p className="op-price-note">{activeBook?.name||'Best available book prices'} · Prices shown at posted line {group.line}.{moved&&<> Research line adjusted to {state.line}. <button type="button" onClick={()=>onState({...state,line:group.line})}>Reset line</button></>}</p>
  {loading?<Skeleton className="h-[90px]"/>:!unavailableReason&&<div className="op-samples" aria-label="History windows">{windows.map(item=><SampleTile key={item.id} window={item} selected={sample===item.id} onSelect={()=>setSample(item.id as ChartSample)}/>)}{h2h&&<SampleTile window={{...h2h,label:`H2H · ${h2hOpponent||opponentIdentity||'Opponent'}`}} selected={sample==='h2h'} onSelect={()=>setSample('h2h')}/>}</div>}
  {loading?<Skeleton className="h-[230px]"/>:unavailableReason?<div className="op-no-history"><strong>Verified history unavailable</strong><p>{unavailableReason}</p></div>:<section id="analysis-chart" className="op-chart-section" style={{scrollMarginTop:100}}><div className="op-chart-heading"><h4>{sample==='h2h'?`Head to head · ${h2hOpponent||opponentIdentity||'Opponent'}`:sample==='season'?'Season · available games':`Last ${sample.slice(1)} games`} · {group.market}</h4><span>{summary.hits}/{summary.games} hits · {summary.hitRate??'—'}{summary.hitRate===null?'':'%'} · Avg {summary.average??'—'}</span></div><div className="op-chart-legend"><span>Over</span><span>Under</span><span>Push</span><span>— Research line</span></div><HitRateChart games={chartGames} line={state.line}/></section>}
  <p className="op-research-footnote">Rates use verified games played. Pushes remain in the denominator. Missing/DNP values are excluded. “Available” describes the returned sample, not a claim of complete season coverage.</p>
 </div>;
}
