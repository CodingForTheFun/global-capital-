'use client';
import * as React from 'react';
import { ArrowDownUp, List } from 'lucide-react';
import type { GameLogRow, Side } from '@/lib/types';
import { compareGames, finite, gameColumns, resultLabel, sportFamily, statLabels } from '@/lib/player-analysis';
import { shortDate } from '@/lib/utils';
import s from './player-analysis.module.css';

export function AnalysisGameLog({games,line,side,sport,market,loading}:{games:GameLogRow[];line:number;side:Side;sport:string;market:string;loading?:boolean}) {
  const [sort,setSort]=React.useState<{key:string;direction:1|-1}>({key:'date',direction:-1});
  const recent=[...games].filter(g=>finite(g.value)!==null&&g.dnp!==true&&g.didNotPlay!==true).sort((a,b)=>compareGames(a,b,'date',-1)).slice(0,15);
  const columns=[['date','Date'],['opponent','Matchup'],['gameResult','Result'],...(sportFamily(sport)!=='tennis'?[['minutes','MIN']]:[]),...gameColumns(sport,recent).map(key=>[key,statLabels[key]]),['value',market]];
  const rows=[...recent].sort((a,b)=>compareGames(a,b,sort.key,sort.direction));
  return <section className={`${s.panel} ${s.wide}`} id="analysis-log" aria-label="Detailed game log"><div className={s.header}><h2><List size={18}/> Game log</h2><span className={s.muted}>Last {recent.length} verified games · {side} {line}</span></div>
    {loading?<p className={s.empty} role="status">Loading game results…</p>:!recent.length?<p className={s.empty}>No verified completed-game results are available for this market.</p>:<div className={s.tableScroll} tabIndex={0} role="region" aria-label="Sortable game log; scroll for all statistics"><table className={s.table}><thead><tr>{columns.map(([key,label])=><th key={key} aria-sort={sort.key===key?sort.direction===1?'ascending':'descending':'none'}><button onClick={()=>setSort(old=>({key,direction:old.key===key&&old.direction===-1?1:-1}))}>{label}<ArrowDownUp size={12}/></button></th>)}<th>Prop result</th></tr></thead><tbody>{rows.map((g,i)=>{
      const v=Number(g.value),hit=side==='UNDER'?v<line:v>line,push=v===line;
      return <tr key={g.gameId||`${g.date}-${i}`}>{columns.map(([key])=><td key={key}>{key==='date'?shortDate(g.date):key==='opponent'?`${g.isHome===false?'@ ':g.isHome===true?'vs ':''}${g.opponent||'Not reported'}`:key==='gameResult'?resultLabel(g):finite(g[key])??<span title="Not returned by the data source">—</span>}</td>)}<td className={push?'':hit?s.positive:s.negative}>{push?'Push':hit?'Hit':'Miss'}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}
