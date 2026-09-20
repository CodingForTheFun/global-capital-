'use client';
import * as React from 'react';
import { Target } from 'lucide-react';
import type { PremiumPlayerResearchProps } from './premium-player-research';
import { PlayerPropDeepDiveCard } from './player-prop-deep-dive-card';
import { DefenseVsPosition } from './defense-vs-position';
import { AnalysisGameLog } from './analysis-game-log';
import { MatchContext } from './match-context';
import type { PropGroup, ResearchResponse } from '@/lib/types';
import { analysisOpponent, average, currentSeasonGames, finite, leagueKey, sportFamily, statLabels } from '@/lib/player-analysis';
import { sameTeamLabel } from '@/lib/opponent-options';
import { marketName } from '@/lib/market-display';
import s from './player-analysis.module.css';

export type AnalysisInput={group:PropGroup|null;history:ResearchResponse|null;line:number;loading:boolean;unavailable?:string|null};
const metricNames: Record<string,RegExp>={points:/^(points|pts)$/i,rebounds:/^(rebounds|reb)$/i,assists:/^(assists|ast)$/i,threes:/^(3-?pt made|3pm|3-pointers made|three pointers made|3 pointers made)$/i,passingYards:/^passing yards$/i,rushingYards:/^rushing yards$/i,receivingYards:/^receiving yards$/i,receptions:/^receptions$/i,aces:/^aces$/i,gamesWon:/^games won$/i,setsWon:/^sets won$/i};

/** The shared live research view. Both board URLs and canonical workspace URLs
 * retain their existing identity, quote selection, saves and provider adapters. */
export function PlayerAnalysisPage({analysis,...props}:PremiumPlayerResearchProps&{analysis:AnalysisInput}) {
  const {group,history,line,loading,unavailable}=analysis;
  const games=React.useMemo(()=>!loading&&!unavailable&&history?.available===true?(history.gameLog||[]).filter(g=>finite(g.value)!==null&&g.dnp!==true&&g.didNotPlay!==true):[],[history,loading,unavailable]);
  const opponent=group?analysisOpponent(group,history?.matchup?.opponent):history?.matchup?.opponent||null,sport=group?.sport||props.player.sport,family=sportFamily(sport),league=leagueKey(sport);
  const season=currentSeasonGames(games,history?.season);
  const sameOpponent=(value:unknown)=>family==='tennis'?String(value||'').trim().toLowerCase()===String(opponent||'').trim().toLowerCase():sameTeamLabel(value,opponent);
  const h2h=games.filter(g=>opponent&&sameOpponent(g.opponent));
  const splits=[{label:'Season',rows:season},{label:'Home',rows:season.filter(g=>g.isHome===true)},{label:'Away',rows:season.filter(g=>g.isHome===false)},{label:opponent?`vs ${opponent}`:'Next opponent',rows:h2h}];
  const applicable=Object.entries(metricNames).flatMap(([metric,pattern])=>{
    const market=props.player.markets.find(m=>m.period===props.market.period&&pattern.test(marketName(m)));
    return market?[{metric,market}]:[];
  });
  const averages=<section className={s.panel} id="analysis-averages"><div className={s.header}><h2><Target size={18}/> {marketName(props.market)} averages</h2><span className={s.muted}>{history?.season||'Season not reported'}</span></div><div className={`${s.averages} mt-4`}>{splits.filter(split=>family!=='tennis'||!['Home','Away'].includes(split.label)).map(split=><article key={split.label} className={s.average}><span>{split.label}</span><strong>{loading?'…':average(split.rows)?.toFixed(1)??'—'}</strong><span>{split.rows.length} verified games</span></article>)}</div>
    {!!applicable.length&&<div className={s.controls} role="group" aria-label="Switch analysis stat">{applicable.map(({metric,market})=><button key={market.key} className={s.button} aria-pressed={market.key===props.market.key} onClick={()=>props.onCategory(market.key)}>{statLabels[metric]}{season.some(g=>finite(g[metric])!==null)&&<strong className="ml-2">{average(season.map(g=>({...g,value:finite(g[metric])})))?.toFixed(1)}</strong>}</button>)}</div>}
    <p className={s.source}>Season and venue averages use returned current regular-season games; {history?.coverage?.seasonComplete===true?'the source reports complete coverage.':'coverage may be incomplete.'} Opponent average uses verified returned meetings.</p>
  </section>;
  const sections=<div className={s.grid}>
    {['NBA','WNBA','NFL'].includes(league)?<DefenseVsPosition key={`${league}-${opponent}`} sport={sport} opponent={opponent} position={history?.player?.position||group?.position}/>:<section className={s.panel} id="analysis-defense"><h2>{family==='tennis'?'Opponent matchup':'Matchup history'}</h2><h3>{opponent||'Next opponent not reported'}</h3><div className={s.averages}><article className={s.average}><span>Meetings returned</span><strong>{h2h.length}</strong></article><article className={s.average}><span>{marketName(props.market)} avg</span><strong>{average(h2h)?.toFixed(1)??'—'}</strong></article></div><p className={s.source}>{family==='tennis'?'Use H2H above to inspect this tennis opponent. Surface and ranking are shown only when verified by the source.':'Use the opponent filter above to explore individual matchups.'}</p></section>}
    {group&&<MatchContext key={JSON.stringify([sport,props.player.eventId])} group={group}/>}
    <AnalysisGameLog games={games} line={line} side={props.side} sport={sport} market={marketName(props.market)} loading={loading}/>
  </div>;
  return <PlayerPropDeepDiveCard analysis={analysis} {...props} supporting={averages} gameLog={undefined} analysisSections={sections}/>;
}
