'use client';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import AuthModal from '@/components/AuthModal';
import PropCard from '@/components/PropCard';
import { sampleProps } from '@/lib/props';

type Sport = 'ALL' | 'NBA' | 'NFL' | 'MLB';
type Side = 'OVER' | 'UNDER';
const SPORTS: Sport[] = ['ALL', 'NBA', 'NFL', 'MLB'];
const USED = 'obligepay_edge_guest_ask_used';

export default function GuestDashboard() {
  const [sport, setSport] = useState<Sport>('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('tatum-pts');
  const [delta, setDelta] = useState(0);
  const [side, setSide] = useState<Side>('OVER');
  const [auth, setAuth] = useState<'register' | 'login' | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState(false);
  const version = useRef(0);
  const detail = useRef<HTMLElement>(null);
  const unlocked = sampleProps.filter(p => !p.locked);
  const rows = unlocked.filter(p => (sport === 'ALL' || sport === p.sport) && `${p.player} ${p.team} ${p.opponent} ${p.stat}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = rows.find(p => p.id === selectedId) ?? rows[0] ?? null;
  const line = selected ? Math.max(0, Math.min(1000, Number((selected.line + delta).toFixed(1)))) : 0;
  const results = useMemo(() => (selected?.recent ?? []).map(value => ({ value, result: value === line ? 'push' : (side === 'OVER' ? value > line : value < line) ? 'hit' : 'miss' })), [selected, line, side]);
  const hitCount = results.filter(g => g.result === 'hit').length;
  const pushes = results.filter(g => g.result === 'push').length;
  const resolved = results.length - pushes;
  const rate = resolved ? Math.round(hitCount / resolved * 100) : null;
  const average = selected ? selected.recent.reduce((a, b) => a + b, 0) / selected.recent.length : 0;
  const chartMax = Math.max(...(selected?.recent ?? [1]), line, 1) * 1.18;

  useEffect(() => {
    let active = true;
    fetch('/api/ask-prop', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.json()).then(data => {
      if (active) { setUsed(Boolean(data.used)); try { if (data.used) sessionStorage.setItem(USED, '1'); else sessionStorage.removeItem(USED); } catch {} }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  function resetContext() { version.current++; setAnswer(''); setError(''); }
  function choose(id: string) {
    setSelectedId(id); setDelta(0); setSide('OVER'); resetContext();
    if (window.matchMedia('(max-width: 1023px)').matches) detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function filterSport(value: Sport) { setSport(value); setDelta(0); setSide('OVER'); resetContext(); }
  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!selected || !question.trim() || busy) return;
    if (used) { setAuth('register'); return; }
    setBusy(true); setAnswer(''); setError('');
    const requestVersion = version.current;
    try {
      // Establish the HttpOnly signed guest session even when browser storage is disabled.
      const sessionResponse = await fetch('/api/ask-prop', { cache: 'no-store', credentials: 'same-origin' });
      if (!sessionResponse.ok) throw new Error('Unable to start your guest session.');
      const session = await sessionResponse.json();
      if (session.used) { setUsed(true); setAuth('register'); return; }
      const response = await fetch('/api/ask-prop', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: question.trim(), prop: { player: selected.player, team: selected.team, opponent: selected.opponent, stat: selected.stat, line, pickDirection: side, recentGameResults: selected.recent } }) });
      const data = await response.json();
      if (response.status === 403 && data.code === 'AUTH_REQUIRED') { setUsed(true); setAuth('register'); return; }
      if (!response.ok) throw new Error(data.message || 'Unable to answer right now.');
      setUsed(true); try { sessionStorage.setItem(USED, '1'); } catch {}
      if (requestVersion === version.current) setAnswer(data.answer);
    } catch (err) { if (requestVersion === version.current) setError(err instanceof Error ? err.message : 'Unable to connect.'); }
    finally { setBusy(false); }
  }

  const sportPills = SPORTS.map(s => <button key={s} type="button" onClick={() => filterSport(s)} aria-pressed={sport === s} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${sport === s ? 'bg-slate-100 text-slate-950' : 'border border-slate-800 text-slate-400 hover:text-white'}`}>{s === 'ALL' ? 'All sports' : s}</button>);
  return <main className="min-h-screen bg-[#06090e] text-slate-100">
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#06090e]/95 backdrop-blur-xl"><div className="mx-auto flex min-h-16 max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
      <a href="/" className="flex items-center gap-2 font-extrabold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-sm">O</span><span>ObligePay <em className="not-italic text-blue-400">Edge</em></span></a>
      <nav aria-label="Sports" className="ml-4 hidden items-center gap-2 md:flex">{sportPills}</nav>
      <div className="ml-auto flex items-center gap-1"><button onClick={() => setAuth('login')} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white">Log In</button><button onClick={() => setAuth('register')} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold transition hover:bg-blue-500">Try for free</button></div>
    </div></header>
    <div className="mx-auto grid max-w-[1500px] grid-cols-1 lg:grid-cols-[minmax(0,46%)_minmax(0,54%)]">
      <section className="border-b border-slate-800 p-4 lg:border-r lg:border-b-0 lg:p-6" aria-label="Projections board">
        <p className="text-xs font-bold tracking-[.2em] text-blue-400">RESEARCH BEFORE YOU REGISTER</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight">Find the story behind the line.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">Adjust a line. Explore five games. Ask a question. See how your research comes together.</p>
        <div className="my-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-200/80">Sample preview — illustrative game results and matchups, not current sportsbook lines or real game logs. The signed-in board uses available live feeds.</div>
        <div className="mb-4 flex gap-2"><input aria-label="Search player or team" value={search} onChange={e => { setSearch(e.target.value); setDelta(0); resetContext(); }} placeholder="Search player, team, market…" className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-[#0b111d] px-4 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-blue-500"/><button onClick={() => setAuth('register')} className="rounded-xl border border-slate-800 px-3 text-sm text-slate-400 hover:border-blue-500">Filters 🔒</button></div>
        <nav aria-label="Mobile sports" className="mb-4 flex gap-2 overflow-x-auto md:hidden">{sportPills}</nav>
        <div className="space-y-3">{rows.map(prop => <PropCard key={prop.id} prop={prop} selected={selected?.id === prop.id} onSelect={() => choose(prop.id)} onLocked={() => setAuth('register')}/>)}
          {!rows.length && <div className="rounded-2xl border border-slate-800 p-6 text-center"><p className="font-semibold">No sample cards match</p><p className="mt-2 text-sm text-slate-500">Change your search or sport. Sample coverage is limited.</p><button onClick={() => { setSearch(''); filterSport('ALL'); }} className="mt-4 text-sm text-blue-400">Reset filters</button></div>}
          {sampleProps.filter(p => p.locked).slice(0, 2).map(prop => <PropCard key={prop.id} prop={prop} selected={false} onSelect={() => setAuth('register')} onLocked={() => setAuth('register')}/>)}
        </div><p className="mt-5 text-xs leading-5 text-slate-500">Research tools, not a sportsbook. No wagers, deposits, or withdrawals are processed here.</p>
      </section>
      <section ref={detail} aria-label="Prop deep dive" className="scroll-mt-24 p-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-64px)] lg:overflow-y-auto lg:p-6">
      {selected ? <div className="rounded-3xl border border-slate-800 bg-[#0b111d] p-5 lg:p-6">
        <div className="flex flex-wrap justify-between gap-4 border-b border-slate-800 pb-5"><div><p className="text-xs font-bold tracking-widest text-blue-400">PROP DEEP DIVE · SAMPLE</p><h2 className="mt-2 text-2xl font-extrabold">{selected.player}</h2><p className="mt-1 text-sm text-slate-500">{selected.team} vs {selected.opponent} · {selected.sport}</p></div><select aria-label="Stat market" value={selected.stat} onChange={() => setAuth('register')} className="h-fit rounded-xl border border-slate-700 bg-[#06090e] px-3 py-2 text-sm"><option value={selected.stat}>{selected.stat}</option><option value="locked">More markets 🔒</option></select></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-slate-800 bg-[#06090e] p-4"><p className="text-xs font-bold tracking-wider text-slate-500">ADJUSTED LINE</p><div className="mt-3 flex items-center justify-between"><button aria-label="Decrease line" disabled={line <= 0 || busy} onClick={() => { setDelta(d => d - .5); resetContext(); }} className="h-10 w-10 rounded-xl border border-slate-700 text-xl hover:border-blue-500 disabled:opacity-30">−</button><strong data-testid="active-line" className="text-3xl">{line}</strong><button aria-label="Increase line" disabled={line >= 1000 || busy} onClick={() => { setDelta(d => d + .5); resetContext(); }} className="h-10 w-10 rounded-xl border border-slate-700 text-xl hover:border-blue-500 disabled:opacity-30">+</button></div></div>
        <div className="rounded-2xl border border-slate-800 bg-[#06090e] p-4"><p className="text-xs font-bold tracking-wider text-slate-500">PICK DIRECTION</p><div className="mt-3 grid grid-cols-2 gap-2">{(['OVER', 'UNDER'] as Side[]).map(s => <button key={s} aria-pressed={side === s} onClick={() => { setSide(s); resetContext(); }} className={`rounded-xl py-2.5 text-sm font-extrabold transition ${side === s ? 'bg-emerald-500 text-emerald-950' : 'border border-slate-700 text-slate-400 hover:text-white'}`}>{s}</button>)}</div></div></div>
        <div className="mt-4 rounded-2xl border border-slate-800 bg-[#06090e] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Last 5 sample games</p><p className="mt-1 text-xs text-slate-500">{side.toLowerCase()} {line} · average {average.toFixed(1)}</p></div><span data-testid="hit-rate" className="rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-400">{rate === null ? 'No decisions' : `${rate}% hit`}</span></div>
        <svg viewBox="0 0 420 220" className="mt-4 w-full" role="img" aria-label={`Last five sample results: ${results.map(r => `${r.value} ${r.result}`).join(', ')}. Line ${line}.`}>
          {[0, 1, 2, 3].map(i => <line key={i} x1="28" x2="405" y1={20 + i * 52} y2={20 + i * 52} stroke="#1e293b"/>)}
          {results.map((g, i) => { const h = g.value / chartMax * 158; return <g key={i}><rect x={43 + i * 73} y={178 - h} width="40" height={h} rx="5" fill={g.result === 'hit' ? '#10b981' : g.result === 'push' ? '#64748b' : '#9f4657'}/><text x={63 + i * 73} y={170 - h} textAnchor="middle" fontSize="12" fill="#cbd5e1">{g.value}</text><text x={63 + i * 73} y="202" textAnchor="middle" fontSize="10" fill="#64748b">G{i + 1}</text></g>; })}
          <line x1="28" x2="405" y1={178 - line / chartMax * 158} y2={178 - line / chartMax * 158} stroke="#60a5fa" strokeDasharray="5 4"/>
          <text x="402" y={171 - line / chartMax * 158} textAnchor="end" fill="#93c5fd" fontSize="10">LINE {line}</text>
        </svg><p className="text-xs text-slate-500">{hitCount} hits · {resolved - hitCount} misses · {pushes} pushes. Pushes are excluded from hit rate.</p></div>
        <form onSubmit={ask} className="mt-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4"><div className="flex items-center justify-between gap-2"><p className="font-bold">Ask about this prop</p><span className="text-[10px] font-bold tracking-wider text-blue-300">{used ? 'FREE QUESTION USED' : '1 FREE AI QUESTION'}</span></div><div className="mt-4 flex gap-2"><input aria-label="Question about this prop" maxLength={500} value={question} onChange={e => setQuestion(e.target.value)} placeholder="How many sample games beat this line?" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-[#06090e] px-3 py-3 text-sm outline-none focus:border-blue-500"/><button disabled={busy || !question.trim()} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold hover:bg-blue-500 disabled:opacity-40">{busy ? 'Asking…' : 'Ask'}</button></div>
          {answer && <p role="status" className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{answer}</p>}{error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
          <p className="mt-3 text-[11px] leading-5 text-slate-500">Answers come from the same data on this card. Not betting advice.</p></form>
        <button onClick={() => setAuth('register')} className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold transition hover:bg-blue-500">Create your free account →</button>
      </div> : <div className="rounded-3xl border border-slate-800 bg-[#0b111d] p-8 text-center text-slate-400">Select a sample prop to explore its numbers.</div>}
      </section>
    </div><AuthModal open={auth !== null} initialMode={auth ?? 'register'} onClose={() => setAuth(null)}/>
  </main>;
}
