import type { PropCardData } from '@/lib/props';

export default function PropCard({ prop, selected, onSelect, onLocked }: { prop: PropCardData; selected: boolean; onSelect: () => void; onLocked: () => void }) {
  if (prop.locked) {
    return (
      <button onClick={onLocked} className="group relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-[#0b111d] p-4 text-left">
        <div className="select-none blur-[6px] opacity-50"><div className="flex justify-between"><b>{prop.player}</b><span>—</span></div><p className="mt-2 text-sm text-slate-500">Locked premium market • L5 80%</p></div>
        <div className="absolute inset-0 grid place-items-center bg-[#06090e]/35 p-3"><span className="rounded-xl border border-blue-500/30 bg-blue-600/15 px-4 py-2 text-center text-sm font-bold text-blue-300 transition group-hover:bg-blue-600 group-hover:text-white">Unlock 400+ daily props — Create Free Account</span></div>
      </button>
    );
  }

  return (
    <button onClick={onSelect} className={`w-full rounded-2xl border p-4 text-left transition ${selected ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_30px_rgba(37,99,235,.08)]' : 'border-slate-800 bg-[#0b111d] hover:border-slate-700 hover:bg-slate-900/70'}`}>
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="text-sm font-bold">{prop.player}</span><span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{prop.sport}</span></div><p className="mt-1 text-xs text-slate-500">{prop.team} vs {prop.opponent}</p></div><div className="text-right"><div className="font-bold">{prop.line}</div><div className="text-[10px] uppercase tracking-wider text-slate-500">{prop.stat}</div></div></div>
      <div className="mt-4 flex items-center justify-between"><span className="text-xs text-slate-500">Last 5 games</span><span className={`rounded-lg px-2 py-1 text-xs font-bold ${prop.l5 >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-300'}`}>L5 {prop.l5}%</span></div>
    </button>
  );
}
