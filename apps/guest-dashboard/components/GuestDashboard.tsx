'use client';

import { FormEvent, useMemo, useState } from 'react';
import AuthModal from '@/components/AuthModal';
import PropCard from '@/components/PropCard';
import { sampleProps } from '@/lib/props';

type PickDirection = 'OVER' | 'UNDER';

type SportFilter = 'ALL' | 'NBA' | 'NFL' | 'MLB';

export default function GuestDashboard() {
  const [sport, setSport] = useState<SportFilter>('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('tatum-pts');
  const [lineDelta, setLineDelta] = useState(0);
  const [pick, setPick] = useState<PickDirection>('OVER');
  const [authOpen, setAuthOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);

  const selected = sampleProps.find((p) => p.id === selectedId && !p.locked) ?? sampleProps[0];
  const activeLine = Number((selected.line + lineDelta).toFixed(1));
  const filtered = sampleProps.filter((p) => {
    const sportMatch = p.locked || sport === 'ALL' || p.sport === sport;
    const q = search.trim().toLowerCase();
    const searchMatch = p.locked || !q || `${p.player} ${p.team} ${p.opponent} ${p.stat}`.toLowerCase().includes(q);
    return sportMatch && searchMatch;
  });
  const gameHits = useMemo(() => selected.recent.map((value) => ({ value, hit: pick === 'OVER' ? value > activeLine : value < activeLine })), [selected, activeLine, pick]);
  const maxValue = Math.max(...selected.recent, activeLine, 1);

  function chooseProp(id: string) {
    setSelectedId(id);
    setLineDelta(0);
    setPick('OVER');
    setAnswer('');
  }

  async function askProp(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    if (sessionStorage.getItem('obligepay_edge_guest_ask_used') === '1') {
      setAuthOpen(true);
      return;
    }
    setAsking(true);
    setAnswer('');
    try {
      const res = await fetch('/api/ask-prop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: question.trim(),
          prop: {
            player: selected.player,
            team: selected.team,
            opponent: selected.opponent,
            stat: selected.stat,
            line: activeLine,
            pickDirection: pick,
            recentGameResults: selected.recent,
          },
        }),
      });
      if (res.status === 403) {
        setAuthOpen(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to answer right now.');
      sessionStorage.setItem('obligepay_edge_guest_ask_used', '1');
      setAnswer(data.answer || 'No answer returned.');
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : 'Unable to answer right now.');
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#06090e] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#06090e]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-2 font-extrabold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-sm">O</span><span>ObligePay <em className="not-italic text-blue-400">Edge</em></span></div>
          <div className="hidden items-center gap-2 md:flex">{(['ALL','NBA','NFL','MLB'] as const).map((s) => <button key={s} onClick={() => setSport(s)} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${sport === s ? 'bg-slate-100 text-slate-950' : 'border border-slate-800 text-slate-400 hover:text-white'}`}>{s === 'ALL' ? 'All Sports' : s}</button>)}</div>
          <div className="ml-auto flex items-center gap-2"><button onClick={() => setAuthOpen(true)} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white">Log In</button><button onClick={() => setAuthOpen(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold transition hover:bg-blue-500">Try for free</button></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 lg:min-h-[calc(100vh-64px)] lg:grid-cols-[minmax(0,46%)_minmax(0,54%)]">
        <section className="border-b border-slate-800 p-4 lg:border-b-0 lg:border-r lg:p-6">
          <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-400">Guest Research Board</p><div className="mt-2 flex items-end justify-between gap-3"><div><h1 className="text-2xl font-extrabold tracking-tight">Preview today&apos;s props</h1><p className="mt-1 text-sm text-slate-500">Explore a few live-style cards before creating an account.</p></div><span className="hidden rounded-lg border border-slate-800 px-2.5 py-1 text-xs text-slate-500 sm:block">400+ props locked</span></div></div>
          <div className="mb-4 flex gap-2"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search player, team, market…" className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-[#0b111d] px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-blue-500"/><button onClick={() => setAuthOpen(true)} className="rounded-xl border border-slate-800 px-3 text-sm text-slate-400 hover:border-blue-500/60 hover:text-white">Filters 🔒</button></div>
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 md:hidden">{(['ALL','NBA','NFL','MLB'] as const).map((s) => <button key={s} onClick={() => setSport(s)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${sport === s ? 'bg-slate-100 text-slate-950' : 'border border-slate-800 text-slate-400'}`}>{s === 'ALL' ? 'All Sports' : s}</button>)}</div>
          <div className="space-y-3">{filtered.map((prop) => <PropCard key={prop.id} prop={prop} selected={selected.id === prop.id} onSelect={() => chooseProp(prop.id)} onLocked={() => setAuthOpen(true)}/>)}</div>
        </section>

        <section className="p-4 lg:sticky lg:top-16 lg:h-[calc(100vh-64px)] lg:overflow-y-auto lg:p-6">
          <div className="rounded-3xl border border-slate-800 bg-[#0b111d] p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5"><div><div className="flex items-center gap-2"><h2 className="text-2xl font-extrabold">{selected.player}</h2><span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-400">{selected.sport}</span></div><p className="mt-1 text-sm text-slate-500">{selected.team} vs {selected.opponent}</p></div><select value={selected.stat} onChange={() => setAuthOpen(true)} className="rounded-xl border border-slate-800 bg-[#06090e] px-3 py-2 text-sm outline-none"><option>{selected.stat}</option><option>More markets 🔒</option></select></div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-[#06090e] p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Adjusted Line</p><div className="mt-3 flex items-center justify-between"><button onClick={() => setLineDelta((v) => Number((v - .5).toFixed(1)))} className="h-10 w-10 rounded-xl border border-slate-800 text-xl hover:border-blue-500">−</button><strong className="text-3xl">{activeLine}</strong><button onClick={() => setLineDelta((v) => Number((v + .5).toFixed(1)))} className="h-10 w-10 rounded-xl border border-slate-800 text-xl hover:border-blue-500">+</button></div></div>
              <div className="rounded-2xl border border-slate-800 bg-[#06090e] p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Pick Direction</p><div className="mt-3 grid grid-cols-2 gap-2">{(['OVER','UNDER'] as PickDirection[]).map((side) => <button key={side} onClick={() => setPick(side)} className={`rounded-xl px-3 py-2.5 text-sm font-extrabold transition ${pick === side ? 'bg-emerald-500 text-emerald-950' : 'border border-slate-800 text-slate-400 hover:text-white'}`}>{side}</button>)}</div></div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-[#06090e] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Last 5 games</p><p className="mt-1 text-xs text-slate-500">Bars update against {pick.toLowerCase()} {activeLine}</p></div><span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-400">{gameHits.filter((g) => g.hit).length}/5 hit</span></div><div className="mt-6 flex h-48 items-end justify-between gap-2 border-b border-slate-800 pb-3">{gameHits.map((game, index) => <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-xs font-bold text-slate-300">{game.value}</span><div className={`w-full max-w-14 rounded-t-lg transition-all duration-300 ${game.hit ? 'bg-emerald-500' : 'bg-rose-500/45'}`} style={{ height: `${Math.max(12, Math.min(100, game.value / maxValue * 100))}%` }}/><span className="text-[10px] text-slate-600">G{index + 1}</span></div>)}</div></div>

            <form onSubmit={askProp} className="mt-4 rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0d1523] to-[#080d15] p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold">Ask about this prop</p><p className="mt-1 text-xs text-slate-500">Guests get one AI question.</p></div><span className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-300">AI DATA Q&A</span></div><div className="mt-4 flex gap-2"><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Why has ${selected.player.split(' ')[0]} been hitting this line?`} className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-[#06090e] px-4 py-3 text-sm outline-none focus:border-blue-500"/><button disabled={asking} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold disabled:opacity-50">{asking ? 'Thinking…' : 'Ask'}</button></div>{answer && <div className="mt-3 rounded-xl border border-slate-800 bg-black/20 p-3 text-sm leading-6 text-slate-300">{answer}</div>}<p className="mt-3 text-[11px] text-slate-600">Answers come from the same data on this card. Not betting advice.</p></form>
          </div>
        </section>
      </div>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)}/>
    </main>
  );
}
