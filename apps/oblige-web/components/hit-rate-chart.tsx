'use client';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GameLogRow } from '@/lib/types';
import { finite, resultLabel } from '@/lib/player-analysis';
import { shortDate } from '@/lib/utils';
import s from './player-analysis.module.css';

function GameTooltip({active,payload}:{active?:boolean;payload?:ReadonlyArray<{payload?:GameLogRow}>}) {
  const game=payload?.[0]?.payload;
  if(!active||!game)return null;
  return <div className={s.tooltip}><strong>{shortDate(game.date)} · {game.isHome===false?'@':game.isHome===true?'vs':''} {game.opponent||'Opponent not reported'}</strong><p>Stat: {finite(game.value) ?? 'Not reported'}</p><p>Minutes: {finite(game.minutes)?.toFixed(1) ?? 'Not reported'}</p><p>{resultLabel(game)}</p></div>;
}
export function HitRateChart({games,line}:{games:GameLogRow[];line:number}) {
  const data=[...games].reverse().filter(g=>finite(g.value)!==null).map((g,i)=>({...g,chartKey:String(i),label:`${shortDate(g.date)} ${g.opponent||''}`}));
  if(!data.length)return <p className={s.empty}>No verified games match this sample. Choose another opponent or window.</p>;
  const values=data.map(g=>Number(g.value)),low=Math.min(0,line,...values),high=Math.max(1,line,...values),padding=(high-low)*.15;
  return <div className={s.chart} role="region" aria-label="Game values compared with the research line. Green over, red under, gray push. Use arrow keys for game details.">
    <ResponsiveContainer width="100%" height={280} minWidth={0}>
      <BarChart data={data} margin={{top:24,right:38,left:-24,bottom:16}} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="#253047" strokeDasharray="3 4"/>
        <XAxis dataKey="chartKey" tickFormatter={(_,i)=>shortDate(data[i]?.date)} tick={{fill:'#94a3b8',fontSize:10}} minTickGap={12} axisLine={false} tickLine={false}/>
        <YAxis domain={[low<0?low-padding:0,high+padding]} tick={{fill:'#94a3b8',fontSize:11}} axisLine={false} tickLine={false}/>
        <Tooltip content={<GameTooltip/>} cursor={{fill:'#ffffff08'}}/>
        <Bar dataKey="value" name="Stat value" radius={[3,3,0,0]} maxBarSize={38} isAnimationActive={false}>
          {data.map(g=><Cell key={g.chartKey} fill={Number(g.value)>line?'#22c55e':Number(g.value)<line?'#ef4444':'#94a3b8'}/>)}
        </Bar>
        <ReferenceLine y={line} stroke="#facc15" strokeDasharray="6 5" ifOverflow="extendDomain" label={{value:String(line),position:'right',fill:'#facc15',fontSize:12}}/>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
