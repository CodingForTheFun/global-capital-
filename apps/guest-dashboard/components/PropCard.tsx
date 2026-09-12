'use client';
import type { PropCardData } from '@/lib/props';
export default function PropCard({ prop, selected, onSelect, onLocked }: {
  prop: PropCardData; selected: boolean; onSelect: () => void; onLocked: () => void;
}) {
  if (prop.locked) return <button onClick={onLocked} type="button" aria-label="Unlock full prop board" className="group relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-[#0b111d] p-5 text-left">
    <div aria-hidden="true" className="select-none space-y-3 opacity-40 blur-[6px]"><div className="h-3 w-2/3 rounded bg-slate-600"/><div className="h-3 w-1/2 rounded bg-slate-700"/><div className="h-3 w-full rounded bg-slate-700"/></div>
    <span className="absolute inset-0 grid place-items-center bg-[#06090e]/40 p-3"><span className="rounded-xl border border-blue-500/30 bg-blue-600/15 px-4 py-2 text-center text-sm font-bold text-blue-300 transition group-hover:bg-blue-600 group-hover:text-white">Unlock the full board — Create Free Account</span></span>
  </button>;
  const hits = prop.recent.filter(n => n > prop.line).length;
  const rate = prop.recent.length ? Math.round(hits / prop.recent.length * 100) : null;
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={`w-full rounded-2xl border p-4 text-left transition duration-200 ${selected ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_30px_rgba(37,99,235,.08)]' : 'border-slate-800 bg-[#0b111d] hover:border-slate-600 hover:bg-slate-900/70'}`}>
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="grid h-10 w-10 place-items-center rounded-full border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300" aria-hidden="true">{prop.player.split(' ').map(x => x[0]).join('')}</span><div><b className="block text-sm">{prop.player}</b><span className="text-xs text-slate-500">{prop.team} vs {prop.opponent} · {prop.sport}</span></div></div></div><div className="text-right"><strong className="text-lg">{prop.line}</strong><span className="block text-[10px] uppercase tracking-wider text-slate-500">{prop.stat}</span></div></div>
    <div className="mt-4 flex items-center justify-between"><span className="text-xs text-slate-500">Sample · Over · Last 5</span><span className={`rounded-lg px-2 py-1 text-xs font-bold ${rate !== null && rate >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-300'}`}>L5 {rate === null ? 'Unavailable' : `${rate}%`}</span></div>
  </button>;
}
