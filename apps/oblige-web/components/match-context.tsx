'use client';
import * as React from 'react';
import { Clock, Users, TrendingUp } from 'lucide-react';
import { getJson } from '@/lib/api';
import { leagueKey, sportFamily, type LineupPlayer, type MatchupData } from '@/lib/player-analysis';
import { odds, shortTime } from '@/lib/utils';
import type { PropGroup } from '@/lib/types';
import s from './player-analysis.module.css';

function Roster({players,injuries}:{players:LineupPlayer[];injuries:LineupPlayer[]}) {
  if(!players.length)return <p className={s.muted}>Not published.</p>;
  return <ul className={s.roster}>{players.map(p=>{const status=injuries.find(i=>i.playerId===p.playerId)?.status||p.status||'Status not reported';return <li key={p.playerId}><span>{p.playerName}<small>{p.position}</small></span><span className={`${s.status} ${/out|inactive/i.test(status)?s.negative:/active|starter/i.test(status)?s.positive:''}`}>{status}</span></li>;})}</ul>;
}
export function MatchContext({group,data:provided}:{group:PropGroup;data?:MatchupData}) {
  const [data,setData]=React.useState<MatchupData|null>(provided||null),[error,setError]=React.useState(''),[retry,setRetry]=React.useState(0),[now,setNow]=React.useState(0);
  const eventId=group.quotes.find(q=>q.eventId)?.eventId||'',sport=leagueKey(group.sport);
  React.useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  React.useEffect(()=>{
    if(provided){setData(provided);return;}
    setData(null);setError('');
    if(!eventId||!group.homeTeam||!group.awayTeam||!group.startsAt){setError('The feed has not supplied the complete event identity for matchup context.');return;}
    const c=new AbortController(),params=new URLSearchParams({sport,eventId,homeTeam:group.homeTeam,awayTeam:group.awayTeam,gameStartTime:group.startsAt});
    void getJson<MatchupData>(`/api/apex/research-matchup?${params}`,c.signal).then(value=>{if(!c.signal.aborted)setData(value);}).catch(()=>{if(!c.signal.aborted)setError('Matchup context could not load.');});
    return()=>c.abort();
  },[eventId,sport,group.homeTeam,group.awayTeam,group.startsAt,provided,retry]);
  const fresh=data?.available&&!!data.expiresAt&&Date.parse(data.expiresAt)>now;
  const teams=fresh?data.teams||[]:[],home=teams.find(t=>t.side==='home'),away=teams.find(t=>t.side==='away');
  const p=data?.prediction,ready=fresh&&p?.available&&!!p.expiresAt&&Date.parse(p.expiresAt)>now&&Date.parse(group.startsAt||'')>now;
  const q=fresh&&data?.odds?.available&&Date.parse(data.odds.expiresAt||'')>now?data.odds:null;
  return <>
    <section className={s.panel} id="analysis-matchup" aria-label="Matchup and win predictor"><div className={s.header}><h2><TrendingUp size={18}/> Match context</h2><button className={s.button} onClick={()=>setRetry(v=>v+1)}>Refresh context</button></div>
      <h3>{group.matchup}</h3><p className={s.muted}><Clock size={12} className="inline"/> {shortTime(group.startsAt)||'Start time not reported'}</p>
      {q?<><div className={s.odds}><div><span>Moneyline</span>{away?.abbreviation} {q.awayMoneyline==null?'Not posted':odds(q.awayMoneyline)} / {home?.abbreviation} {q.homeMoneyline==null?'Not posted':odds(q.homeMoneyline)}</div><div><span>Spread</span>{q.spread||'Not posted'}</div><div><span>Total O/U</span>{q.total??'Not posted'}</div></div><p className={s.source}>{q.book} · Retrieved {shortTime(data?.retrievedAt)}</p></>:<p className={s.empty}>{!data&&!error?'Loading game odds…':data?.odds?.message||'Current game odds are unavailable.'}</p>}
      <h3>Win predictor</h3>{ready?<><div className={s.teamRow}><span>{away?.name}<strong>{p.awayPercent}%</strong></span><span className="text-right">{home?.name}<strong>{p.homePercent}%</strong></span></div><div className={s.winBar} role="img" aria-label={`${away?.name} ${p.awayPercent} percent, ${home?.name} ${p.homePercent} percent`}><div style={{width:`${p.awayPercent}%`,background:'#60a5fa'}}/><div style={{width:`${p.homePercent}%`,background:'#22c55e'}}/></div><p className={s.source}>{p.source} pregame estimates. Published percentages may not sum to 100%; a draw estimate is not supplied.</p></>:<p className={s.muted}>{error||(!data?'Loading published predictions…':!fresh?'Refresh for current game context.':p?.message||data.message||'No published win estimate is available for this matchup.')}</p>}
      {data?.sourceUrl&&<p className={s.source}><a href={data.sourceUrl} target="_blank" rel="noreferrer">Game report</a> · Retrieved {shortTime(data.retrievedAt)}</p>}
    </section>
    {sportFamily(group.sport)!=='tennis'&&<section className={`${s.panel} ${s.wide}`} id="analysis-lineups" aria-label="Lineups and depth chart"><h2><Users size={18} className="inline"/> Lineups & depth chart</h2>{!teams.length?<p className={s.empty}>{error||data?.message||'Lineups have not been published for this matchup.'}</p>:<div className={s.lineupGrid}>{teams.map(t=><div key={t.teamId}><h3>{t.name} {t.record&&<small className={s.muted}>· {t.record}</small>}</h3><h3>Starters</h3><Roster players={t.lineup?.starters||[]} injuries={t.injuries?.rows||[]}/><h3>Bench</h3><Roster players={t.lineup?.bench||[]} injuries={t.injuries?.rows||[]}/>{!!t.lineup?.probables?.length&&<><h3>Probable starters</h3><Roster players={t.lineup.probables} injuries={t.injuries?.rows||[]}/></>}<h3>Injury report</h3><Roster players={t.injuries?.rows||[]} injuries={[]}/></div>)}</div>}<p className={s.source}>No injury entry does not confirm a player is active. Starters and bench reflect the source’s published designations.</p></section>}
  </>;
}
