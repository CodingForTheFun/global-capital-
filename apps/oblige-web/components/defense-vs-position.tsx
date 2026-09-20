'use client';
import * as React from 'react';
import { Shield } from 'lucide-react';
import { getJson } from '@/lib/api';
import { leagueKey, statLabels, type DvpData } from '@/lib/player-analysis';
import { sameTeamLabel } from '@/lib/opponent-options';
import s from './player-analysis.module.css';

const ordinal=(n:number)=>`${n}${n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[n%10]||'th'}`;
export function DefenseVsPosition({sport,opponent,position,onMetric,data:provided}:{sport:string;opponent?:string|null;position?:string|null;onMetric?:(metric:string)=>void;data?:DvpData}) {
  const [data,setData]=React.useState<DvpData|null>(provided||null),[team,setTeam]=React.useState(''),[selectedPosition,setPosition]=React.useState(position||''),[error,setError]=React.useState(''),[retry,setRetry]=React.useState(0);
  const league=leagueKey(sport);
  React.useEffect(()=>{
    if(provided){setData(provided);return;}
    const c=new AbortController();setData(null);setError('');
    void getJson<DvpData>(`/api/apex/research-defense-position?${new URLSearchParams({sport:league})}`,c.signal,90000,90000).then(value=>{if(!c.signal.aborted)setData(value);}).catch(()=>{if(!c.signal.aborted)setError('Position defense could not load.');});
    return()=>c.abort();
  },[league,provided,retry]);
  const teams=data?.teams||[],positions=data?.positions||(['NBA','WNBA'].includes(league)?['PG','SG','SF','PF','C']:league==='NFL'?['QB','RB','WR','TE']:[]);
  const defaultTeam=teams.find(t=>sameTeamLabel(t.abbreviation,opponent)||sameTeamLabel(t.name,opponent))?.id||'';
  const activeTeam=teams.some(t=>t.id===team)?team:defaultTeam;
  const activePosition=positions.includes(selectedPosition)?selectedPosition:positions.includes(position||'')?position!:'';
  const rows=(data?.rows||[]).filter(r=>r.teamId===activeTeam&&r.position===activePosition);
  return <section className={s.panel} id="analysis-defense" aria-label="Defense vs position">
    <div className={s.header}><h2><Shield size={18}/> Defense vs Position</h2><span className={s.muted}>{league}</span></div>
    <div className={s.controls}><label>Defense<select aria-label="Defense team" value={activeTeam} onChange={e=>setTeam(e.target.value)} disabled={!teams.length}>{<option value="">{teams.length?'Select defense':'Teams loading'}</option>}{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><div role="group" aria-label="Opponent position" className="flex flex-wrap gap-1">{positions.map(p=><button key={p} type="button" className={s.button} aria-pressed={p===activePosition} onClick={()=>setPosition(p)}>{p}</button>)}</div></div>
    {!data&&!error?<p className={s.empty} role="status">Loading completed-game position samples…</p>:error?<p className={s.empty} role="alert">{error} <button className={s.button} onClick={()=>setRetry(n=>n+1)}>Retry defense data</button></p>:!activeTeam||!activePosition?<p className={s.empty}>Select a defense and player position to view verified samples.</p>:!rows.length?<p className={s.empty}>{data?.message||'No verified sample for this team and position in the returned games.'}</p>:<div className={s.tableScroll}><table className={s.table}><caption className="sr-only">Stats allowed by the selected defense against {activePosition}</caption><thead><tr><th>Stat</th><th>Allowed / game</th><th>Rank</th><th>Over matchup</th></tr></thead><tbody>{rows.map(row=>{
      const tone=row.rank===null?'':row.rank/row.leagueSize>=.75?s.positive:row.rank/row.leagueSize<=.25?s.negative:'';
      return <tr key={row.metric}><td>{onMetric?<button className={s.metricButton} onClick={()=>onMetric(row.metric)}>{statLabels[row.metric]||row.metric}</button>:statLabels[row.metric]||row.metric}</td><td>{row.average.toFixed(2)}<small className="block text-slate-400">{row.games} games</small></td><td>{row.rank===null?'Unranked':`${ordinal(row.rank)} / ${row.leagueSize}`}</td><td><span className={`${s.badge} ${tone}`}>{row.rank===null?'League coverage incomplete':tone===s.positive?'Favorable':tone===s.negative?'Tough':'Neutral'}</span></td></tr>;
    })}</tbody></table></div>}
    <p className={s.source}>{data?.basis||'Lower allowed averages rank first (tougher for overs).'} {data?.sourceUrl&&<a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a>}</p>
  </section>;
}
