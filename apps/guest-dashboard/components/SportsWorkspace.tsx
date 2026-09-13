'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, BarChart3, ChevronLeft, ChevronRight, Download, ExternalLink, Info, LoaderCircle, Radar, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Ticket, Trash2, UserRound, X } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import AuthModal from '@/components/AuthModal';
import { decimalOdds, displayPrice, exportCsv, groupQuotes, implied, quotesFromPayload, type Quote } from '@/lib/sports-workspace';

type View = 'sports' | 'live' | 'research' | 'analytics' | 'tools';
type Account = { id: string; email?: string };
const SPORTS = ['NFL', 'NBA', 'MLB', 'WNBA', 'NHL', 'NCAAF', 'NCAAB', 'MLS', 'EPL', 'UCL'];
const VIEWS: { id: View; label: string }[] = [
  { id: 'sports', label: 'Sports' }, { id: 'live', label: 'Live' }, { id: 'research', label: 'My Research' },
  { id: 'analytics', label: 'Analytics' }, { id: 'tools', label: 'Tools' },
];
const panel = 'rounded-2xl border border-slate-800 bg-[#111726]';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-emerald-500/50 hover:text-white disabled:opacity-40';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-[#06130f] transition hover:bg-emerald-400 disabled:opacity-40';
const input = 'min-w-0 rounded-xl border border-slate-800 bg-[#0b111d] px-3 py-3 text-sm text-slate-200 outline-none focus:border-emerald-500';

export default function SportsWorkspace() {
  const [view, setView] = useState<View>('sports');
  const [sport, setSport] = useState('NFL');
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [auth, setAuth] = useState<'register' | 'login' | null>(null);
  const [rows, setRows] = useState<Quote[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');
  const [query, setQuery] = useState('');
  const [book, setBook] = useState('all');
  const [market, setMarket] = useState('all');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Quote[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const pageSize = 15;

  useEffect(() => {
    const syncHash = () => { const id = window.location.hash.slice(1) as View; setView(VIEWS.some(v => v.id === id) ? id : 'sports'); setPage(1); };
    syncHash(); window.addEventListener('hashchange', syncHash);
    try { const saved = localStorage.getItem('autoscout-sport'); if (saved && SPORTS.includes(saved)) setSport(saved); } catch {}
    const controller = new AbortController();
    fetch('/api/account/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setAccount(data.authenticated && data.user?.id ? data.user : null); })
      .catch(() => { if (!controller.signal.aborted) setError('Account service is unavailable. Please refresh to reconnect.'); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { controller.abort(); window.removeEventListener('hashchange', syncHash); };
  }, []);

  useEffect(() => {
    if (!account) { setDraft([]); setDraftOwner(null); setRows([]); return; }
    try {
      const parsed = JSON.parse(sessionStorage.getItem(`edge-workspace:${account.id}`) || '[]');
      setDraft(quotesFromPayload({ props: Array.isArray(parsed) ? parsed.slice(0, 30) : [] }));
    } catch { setDraft([]); }
    setDraftOwner(account.id);
  }, [account]);

  useEffect(() => {
    if (!account || draftOwner !== account.id) return;
    try { sessionStorage.setItem(`edge-workspace:${account.id}`, JSON.stringify(draft)); } catch {}
  }, [account, draft, draftOwner]);

  useEffect(() => {
    if (checking || !account) return;
    const version = ++generation.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    setBusy(true); setError('');
    fetch(`/api/apex/props?sport=${encodeURIComponent(sport)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 401) { setAccount(null); throw new Error('Sign in to load the research board.'); }
        if (!response.ok) throw new Error('The board is temporarily unavailable. Existing research drafts are unchanged.');
        return response.json();
      })
      .then(data => {
        if (generation.current !== version || controller.signal.aborted) return;
        setRows(quotesFromPayload(data));
        setLoadedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      })
      .catch(err => { if (generation.current === version) setError(controller.signal.aborted ? 'The board request timed out. Try again.' : err.message); })
      .finally(() => { clearTimeout(timeout); if (generation.current === version) setBusy(false); });
    return () => { generation.current++; controller.abort(); clearTimeout(timeout); };
  }, [checking, account, sport, refresh]);

  useEffect(() => {
    const dialog = mobileDialog.current;
    if (drawer && !dialog?.open) dialog?.showModal();
    if (!drawer && dialog?.open) dialog.close();
    if (!drawer) return;
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [drawer]);

  const groups = useMemo(() => groupQuotes(rows), [rows]);
  const books = useMemo(() => [...new Map(rows.map(q => [q.sportsbookKey, q.sportsbook])).entries()], [rows]);
  const markets = useMemo(() => [...new Set(rows.map(q => q.market))].sort(), [rows]);
  const visibleBooks = book === 'all' ? books.slice(0, 4) : books.filter(([key]) => key === book);
  const filtered = groups.filter(g => (!query || `${g.player} ${g.matchup} ${g.market}`.toLowerCase().includes(query.trim().toLowerCase())) &&
    (market === 'all' || g.market === market) && (view !== 'live' || g.quotes.some(q => q.live)) &&
    (book === 'all' || g.quotes.some(q => q.sportsbookKey === book)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageGroups = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function pickSport(value: string) {
    if (value === sport) return;
    generation.current++; setRows([]); setLoadedAt(''); setSport(value); setPage(1); setBook('all'); setMarket('all');
    try { localStorage.setItem('autoscout-sport', value); } catch {}
  }
  function openScout() { try { localStorage.setItem('autoscout-sport', sport); } catch {} }
  function select(quote: Quote) {
    if (!account) { setAuth('login'); return; }
    if (draft.some(q => q.id === quote.id)) { setDraft(d => d.filter(q => q.id !== quote.id)); return; }
    if (draft.length >= 30) { toast.info('Keep up to 30 research selections in this session.'); return; }
    setDraft(d => [...d, quote]); toast.success('Added to your research slip', { description: 'Research only. No wager was placed.' });
  }
  function download(quoteRows = rows) {
    const blob = new Blob([exportCsv(quoteRows)], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = href; link.download = `obligepay-${sport.toLowerCase()}-research.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const navigation = <nav aria-label="Primary workspace navigation" className="flex min-w-0 items-center gap-1 overflow-x-auto">
    {VIEWS.map(v => <a key={v.id} href={`/sportsbooks#${v.id}`} aria-current={view === v.id ? 'page' : undefined}
      className={`whitespace-nowrap border-b-2 px-3 py-4 text-sm font-semibold transition ${view === v.id ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>{v.label}</a>)}
    <a data-testid="autoscout-nav" href="/apex" onClick={openScout} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-4 text-sm font-bold text-emerald-400 hover:border-emerald-500"><Radar size={17} aria-hidden="true"/>Auto Scout</a>
  </nav>;
  const slip = <div className={`${panel} overflow-hidden`}>
    <div className="flex items-center gap-2 border-b border-slate-800 p-5"><Ticket size={18} className="text-emerald-400"/><h2 className="font-bold">Research Slip</h2><span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-300">{draft.length}</span></div>
    <div className="max-h-[48vh] space-y-2 overflow-y-auto p-4">
      {!draft.length && <div className="py-8 text-center"><Ticket size={34} className="mx-auto mb-3 text-slate-600"/><p className="text-sm font-semibold text-slate-300">Build your research list</p><p className="mt-2 text-xs leading-5 text-slate-500">Select a book’s Over or Under line to keep it alongside your analysis.</p></div>}
      {draft.map(q => <article key={q.id} className="rounded-xl border border-slate-700/70 bg-[#0b111d] p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><b className="text-sm">{q.playerName}</b><p className="mt-1 text-xs text-emerald-400">{q.side} {q.line} · {q.market}</p></div><button aria-label={`Remove ${q.playerName}`} onClick={() => setDraft(d => d.filter(x => x.id !== q.id))} className="p-1 text-slate-500 hover:text-rose-400"><X size={16}/></button></div><div className="mt-3 flex justify-between text-[11px] text-slate-500"><span>{q.sportsbook}</span><span>{displayPrice(q.price)}</span></div></article>)}
    </div><div className="space-y-3 border-t border-slate-800 p-4"><a href="/apex" onClick={openScout} className={`${primary} w-full`}><Radar size={17}/>Open Auto Scout<ArrowRight size={16}/></a><div className="flex gap-2"><button disabled={!draft.length} onClick={() => download(draft)} className={`${secondary} flex-1`}><Download size={14}/>Export</button><button disabled={!draft.length} onClick={() => setDraft([])} className={`${secondary} flex-1`}><Trash2 size={14}/>Clear</button></div><p className="text-[11px] leading-5 text-slate-500">Session-only snapshots. Prices may change. This is not a betslip for placing wagers.</p></div>
  </div>;

  return <div className="min-h-screen bg-[#090d16] text-slate-100">
    <a href="#workspace-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded focus:bg-emerald-400 focus:p-3 focus:text-black">Skip to workspace</a>
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#090d16]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-x-5 px-4 lg:px-6">
        <a href="/sportsbooks" className="flex items-center gap-2 py-4 text-lg font-extrabold tracking-tight"><Activity size={26} className="text-emerald-400"/>ObligePay <span className="text-emerald-400">Edge</span></a>
        <div className="hidden min-w-0 xl:block">{navigation}</div>
        <div className="ml-auto flex items-center gap-2">{account ? <span className="inline-flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-300"><UserRound size={16}/><span className="hidden sm:inline">Connected account</span></span> : <button onClick={() => setAuth('login')} className={secondary}>Log in</button>}<a href="/preview" className={`${secondary} hidden sm:inline-flex`}>Guest preview</a></div>
        <div className="w-full min-w-0 xl:hidden">{navigation}</div>
      </div>
    </header>
    <div className="mx-auto max-w-[1700px] px-3 py-4 pb-24 sm:px-5 lg:px-6">
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Sport filters">{SPORTS.map(s => <button type="button" key={s} onClick={() => pickSport(s)} aria-pressed={sport === s} className={`whitespace-nowrap rounded-lg border px-4 py-2.5 text-xs font-bold transition ${sport === s ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-800 bg-[#111726] text-slate-400 hover:border-slate-600'}`}>{s}</button>)}</div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <main id="workspace-main" className="min-w-0">
          <section className="mb-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_210px]">
            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/60 via-[#101c24] to-[#111726] p-6"><Radar aria-hidden="true" size={150} className="pointer-events-none absolute -right-6 -top-5 text-emerald-500/10"/><p className="text-[10px] font-bold tracking-[.2em] text-emerald-400">SPORTSBOOK COMPARISON + AUTO SCOUT</p><h1 className="relative mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Smarter research. One workspace.</h1><p className="relative mt-3 max-w-xl text-sm leading-6 text-slate-400">Compare available player-prop lines, then open Auto Scout for game logs and predictions. Your existing account stays with you.</p></div>
            <div className={`${panel} flex flex-col justify-center p-5`}><span className="text-xs font-semibold text-slate-400">Available research</span><strong className="mt-2 text-4xl font-extrabold tabular-nums text-emerald-400">{account ? groups.length.toLocaleString() : '—'}</strong><span className="mt-1 text-xs text-slate-500">prop markets across {books.length} books</span><p className="mt-3 text-[10px] text-slate-500">{loadedAt ? `Board received ${loadedAt} · cached feed may be older` : 'No invented statistics'}</p></div>
          </section>
          <div className="mb-4 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-500"/><p>Research only. No wagers, deposits, or withdrawals. Only lines returned by your existing feed appear here; empty markets stay unavailable.</p></div>
          {checking ? <div role="status" className={`${panel} flex items-center gap-3 p-8 text-sm text-slate-400`}><LoaderCircle className="animate-spin" size={19}/>Checking your existing session…</div> : !account ? <section className={`${panel} p-8 text-center`}><Radar className="mx-auto mb-4 text-emerald-400" size={36}/><h2 className="text-xl font-bold">One account. Both workspaces.</h2><p className="mx-auto my-3 max-w-md text-sm leading-6 text-slate-400">Sign in with your ObligePay account to compare book lines. Auto Scout uses the same account and research feed.</p>{error && <p role="alert" className="mb-4 text-sm text-amber-300">{error}</p>}<div className="flex flex-wrap justify-center gap-3"><button onClick={() => setAuth('login')} className={primary}>Log in</button><button onClick={() => setAuth('register')} className={secondary}>Create free account</button><a href="/preview" className={secondary}>Explore sample preview</a></div></section> : <>
          {error && <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200"><Info size={16}/><span className="flex-1">{error}{rows.length ? ' Displayed rows may be stale.' : ''}</span><button onClick={() => setRefresh(n => n + 1)} className={secondary}>Retry</button></div>}
          {view === 'tools' ? <ResearchTools/> : view === 'analytics' ? <section className={`${panel} p-5`}><h2 className="flex items-center gap-2 text-lg font-bold"><BarChart3 size={20} className="text-emerald-400"/>Coverage analytics</h2><p className="mt-2 text-sm text-slate-500">Counts reflect this loaded {sport} board—not prediction accuracy, ROI, or profit.</p><div className="mt-6 space-y-4">{books.map(([key, label]) => { const count = rows.filter(q => q.sportsbookKey === key).length; return <div key={key}><div className="mb-2 flex justify-between text-sm"><span>{label}</span><span className="text-slate-500">{count} quotes</span></div><div className="h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${rows.length ? count / rows.length * 100 : 0}%` }}/></div></div>; })}{!books.length && <p className="text-sm text-slate-500">Load an available sport to see its coverage.</p>}</div></section> : view === 'research' ? <section className={`${panel} p-5`}><h2 className="text-lg font-bold">My research snapshots</h2><p className="mt-2 text-sm text-slate-500">Your session list. These selections are not synced into Auto Scout’s Saved Props and are not placed bets.</p><div className="mt-5 space-y-2">{draft.map(q => <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 p-4"><div><b className="text-sm">{q.playerName}</b><p className="mt-1 text-xs text-slate-400">{q.market} · {q.side} {q.line} · {q.sportsbook}</p></div><button onClick={() => setDraft(d => d.filter(x => x.id !== q.id))} className={secondary}><Trash2 size={14}/>Remove</button></div>)}{!draft.length && <p className="py-8 text-center text-sm text-slate-500">No research selections yet. Choose a line on the Sports board.</p>}</div></section> : <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_160px_160px_auto]"><label className="relative col-span-2 flex min-w-0 items-center sm:col-span-1"><Search size={17} className="absolute left-3 text-slate-500"/><input aria-label="Search players teams or markets" placeholder="Search players, teams, or markets…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} className={`${input} w-full pl-10`}/></label><select aria-label="Book filter" value={book} onChange={e => { setBook(e.target.value); setPage(1); }} className={input}><option value="all">All books</option>{books.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="Market filter" value={market} onChange={e => { setMarket(e.target.value); setPage(1); }} className={input}><option value="all">All markets</option>{markets.map(m => <option key={m}>{m}</option>)}</select><button aria-label="Refresh board" disabled={busy} onClick={() => setRefresh(n => n + 1)} className={`${secondary} col-span-2 sm:col-span-1`}><RefreshCw size={16} className={busy ? 'animate-spin' : ''}/><span className="sm:hidden">Refresh</span></button></div>
            <section className={`${panel} overflow-hidden`} aria-label="Sportsbook prop comparison"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-4"><h2 className="text-sm font-bold">{view === 'live' ? 'In-play player props' : 'Player props'} <span className="ml-2 text-slate-500">{filtered.length}</span></h2><button disabled={!rows.length} onClick={() => download()} className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-emerald-400"><Download size={14}/>Export board</button></div>
              {busy && !rows.length ? <p role="status" className="flex items-center gap-2 p-8 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/>Loading your research feed…</p> : !pageGroups.length ? <div className="p-10 text-center"><Activity size={30} className="mx-auto mb-3 text-slate-600"/><h3 className="font-semibold">{view === 'live' ? 'No confirmed in-play props' : 'No available props match'}</h3><p className="mt-2 text-xs leading-5 text-slate-500">Try another sport or clear filters. We do not substitute sample lines for unavailable feed data.</p></div> : <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead className="bg-[#0b111d] text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="min-w-[220px] p-4">Player / matchup</th>{visibleBooks.map(([key, label]) => <th key={key} className="min-w-[145px] p-3 text-center">{label}</th>)}</tr></thead><tbody>{pageGroups.map(g => <tr key={g.key} className="border-t border-slate-800/80"><td className="p-4"><div className="flex items-center gap-3"><span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-emerald-500/20 bg-emerald-500/5 text-[10px] font-bold text-emerald-300">{g.player.split(' ').map(w => w[0]).slice(0, 2).join('')}</span><div><b className="text-sm">{g.player}</b><p className="mt-1 text-[11px] text-slate-500">{g.matchup}</p><p className="mt-2 text-[11px] font-semibold text-slate-300">{g.market}</p></div></div></td>{visibleBooks.map(([key]) => <td key={key} className="p-2"><div className="grid grid-cols-2 gap-1">{(['OVER', 'UNDER'] as const).map(side => {
                const q = g.quotes.find(r => r.sportsbookKey === key && r.side === side);
                const chosen = q && draft.some(d => d.id === q.id);
                return q ? <button key={side} type="button" onClick={() => select(q)} aria-label={`${g.player} ${side} ${q.line} ${q.sportsbook}`} aria-pressed={!!chosen} className={`min-h-14 rounded-lg border px-2 py-2 text-center transition ${chosen ? 'border-emerald-500 bg-emerald-500/15 shadow-[0_0_16px_rgba(16,185,129,.08)]' : 'border-slate-700/70 bg-[#0b111d] hover:border-emerald-500/60'}`}><strong className="block whitespace-nowrap text-xs">{side === 'OVER' ? 'O' : 'U'} {q.line}</strong><span className="mt-1 block whitespace-nowrap text-[10px] text-emerald-400">{q.price === null ? 'Line only' : displayPrice(q.price)}</span></button> : <span key={side} className="grid min-h-14 place-items-center rounded-lg border border-dashed border-slate-800 px-1 text-[10px] text-slate-600">Unavailable</span>;
              })}</div></td>)}</tr>)}</tbody></table></div>}
              <div className="flex items-center justify-between gap-2 border-t border-slate-800 p-4 text-xs text-slate-500"><span>Page {currentPage} of {pages}{book === 'all' && books.length > 4 ? ' · first 4 books shown; select a book above for more' : ''}</span><div className="flex gap-2"><button aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)} className={secondary}><ChevronLeft size={15}/></button><button aria-label="Next page" disabled={currentPage >= pages} onClick={() => setPage(p => p + 1)} className={secondary}><ChevronRight size={15}/></button></div></div>
            </section>
          </>}
          <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5"><div><h2 className="flex items-center gap-2 font-bold"><Radar size={19} className="text-emerald-400"/>Go deeper with Auto Scout</h2><p className="mt-2 max-w-xl text-xs leading-5 text-slate-400">The original prop-prediction app is beside Tools. Open it for available L5/L10/L20 windows, game logs, and model analysis.</p></div><a href="/apex" onClick={openScout} className={secondary}>Launch Auto Scout<ArrowRight size={15}/></a></section>
          </>}
        </main>
        <aside className="hidden min-w-0 lg:block"><div className="sticky top-24 space-y-4">{slip}<section className={`${panel} p-5`}><h2 className="flex items-center gap-2 text-sm font-bold"><Radar size={18} className="text-emerald-400"/>Your prediction terminal</h2><p className="mt-3 text-xs leading-6 text-slate-500">Auto Scout remains the source for historical analysis and predictions. The comparison board never fabricates an edge score or hit rate.</p><a href="/apex" onClick={openScout} className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-400">Open Auto Scout<ExternalLink size={13}/></a></section></div></aside>
      </div>
    </div>
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-[#090d16]/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl lg:hidden"><div className="flex gap-3"><a href="/apex" onClick={openScout} className={`${secondary} flex-1`}><Radar size={17}/>Auto Scout</a><button onClick={() => setDrawer(true)} className={`${primary} flex-1`}><Ticket size={17}/>Research ({draft.length})</button></div></div>
    <dialog ref={mobileDialog} aria-label="Mobile research slip" onCancel={e => { e.preventDefault(); setDrawer(false); }} className="m-auto max-h-[90dvh] w-[calc(100%_-_24px)] max-w-md overflow-y-auto rounded-2xl bg-[#090d16] p-3 text-white backdrop:bg-black/75"><div className="mb-3 flex justify-end"><button aria-label="Close research slip" onClick={() => setDrawer(false)} className={secondary}><X size={16}/>Close</button></div>{slip}</dialog>
    <AuthModal open={auth !== null} initialMode={auth || 'register'} onClose={() => setAuth(null)}/>
    <Toaster position="bottom-right" theme="dark" richColors/>
  </div>;
}

function ResearchTools() {
  const [price, setPrice] = useState('-110');
  const [amount, setAmount] = useState('100');
  const numericPrice = price.trim() ? Number(price) : NaN;
  const probability = implied(numericPrice), decimal = decimalOdds(numericPrice);
  const numericAmount = amount.trim() ? Number(amount) : NaN;
  const total = decimal !== null && Number.isFinite(numericAmount) && numericAmount >= 0 ? numericAmount * decimal : null;
  return <section className={`${panel} p-5 sm:p-6`}><h2 className="flex items-center gap-2 text-lg font-bold"><SlidersHorizontal size={19} className="text-emerald-400"/>Research tools</h2><p className="mt-2 text-sm leading-6 text-slate-500">An odds-format calculator, not a prediction or staking recommendation. Example inputs are editable and do not submit a wager.</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400">American odds<input aria-label="American odds" type="number" value={price} onChange={e => setPrice(e.target.value)} className={`${input} mt-2 block w-full`}/></label><label className="text-xs text-slate-400">Reference amount<input aria-label="Reference amount" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={`${input} mt-2 block w-full`}/></label></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{[['Decimal odds', decimal?.toFixed(3) ?? 'Invalid odds'], ['Implied probability', probability === null ? 'Invalid odds' : `${(probability * 100).toFixed(2)}%`], ['Illustrative total return', total?.toFixed(2) ?? 'Unavailable']].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 bg-[#0b111d] p-4"><p className="text-[11px] text-slate-500">{label}</p><output className="mt-2 block text-xl font-bold tabular-nums text-emerald-400">{value}</output></div>)}</div><p className="mt-4 text-[11px] leading-5 text-slate-500">Implied probability is derived from the entered price and includes no adjustment for bookmaker margin. Total return includes the reference amount. No wallet or money movement is connected.</p></section>;
}
