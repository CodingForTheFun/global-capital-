'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Search, SlidersHorizontal, Telescope } from 'lucide-react';
import styles from './market-explorer.module.css';

type J = null | boolean | number | string | J[] | { [key: string]: J };
type Obj = { [key: string]: J };
type Capability = { id: string; label: string; group: string; scope: string; params: string[]; note: string };
type Result = { ok: boolean; state?: string; available?: boolean; data?: J; message?: string; note?: string; snapshotServedAt?: string; retryAfterSeconds?: number | null };
type Resource = { result: Result | null; loading: boolean };
const obj = (value: J | undefined): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const arr = (value: J | undefined): J[] => Array.isArray(value) ? value : [];
const str = (value: J | undefined): string => value == null ? '' : String(value);
const keyOf = (value: Obj) => str(value.reference_key ?? value.market_key ?? value.sport_key);
const primitive = (value: J): value is null | boolean | number | string => value === null || typeof value !== 'object';
const human = (key: string) => key.replace(/^reference_key$/, 'reference').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const titleOf = (value: Obj, index = 0) => str(value.player ?? value.player_name ?? value.description ?? value.title ?? value.name ?? value.book_title ?? value.reference_key ?? value.market_key) || `Record ${index + 1}`;
const groups = ['Markets', 'Games', 'Value', 'Movement', 'Players', 'Season', 'DFS', 'Coverage'];
const labels: Record<string, string> = {
  markets: 'Market keys', market: 'Market key', bookmakers: 'Book keys', bookmaker: 'Book key', period: 'Period',
  name: 'Selection / side', description: 'Player / subject', price: 'American odds', point: 'Line',
  opponent: 'Opponent', stat_type: 'Stat keys', dfs_odds_type: 'DFS flavor', limit: 'Game limit', days: 'Days',
  days_from: 'Recent days', leg_win_prob: 'Per-leg probability (0–1)', platform: 'Platform', devig: 'De-vig method',
  relative_from: 'From, relative to start', relative_to: 'To, relative to start', changes_only: 'Changes only', interval: 'Sampling', date: 'UTC date',
};
const choices: Record<string, [string, string][]> = {
  period: [['all', 'All periods'], ['full', 'Full game'], ...['q1','q2','q3','q4','h1','h2','p1','p2','p3','f3','f5','f7',...Array.from({length:9},(_,i)=>`i${i+1}`),...Array.from({length:7},(_,i)=>`map${i+1}`),...Array.from({length:5},(_,i)=>`s${i+1}`),...Array.from({length:7},(_,i)=>`g${i+1}`)].map((v): [string,string] => [v,v.toUpperCase()])],
  dfs_odds_type: [['standard','Standard'],['goblin','Goblin'],['demon','Demon']],
  devig: [['multiplicative','Multiplicative'],['shin','Shin']],
  interval: ['30s','1m','5m','15m','30m','1h'].map((v): [string, string] => [v,v]),
  changes_only: [['true','Changes only'],['false','Every sample']], platform: [['prizepicks','PrizePicks']],
};

function requestKey(params: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const name of Object.keys(params).sort()) if (params[name]) q.set(name, params[name]);
  return `/api/apex/market-explorer?${q}`;
}
function useResource(url: string | null): Resource {
  const [resource, setResource] = React.useState<Resource>({ result: null, loading: Boolean(url) });
  React.useEffect(() => {
    if (!url) { setResource({ result: null, loading: false }); return; }
    const controller = new AbortController();
    setResource({ result: null, loading: true });
    void fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as Result;
        if (!controller.signal.aborted) setResource({ result: { ...result, ok: response.ok && result.ok !== false, state: response.status === 401 ? 'sign-in' : result.state }, loading: false });
      })
      .catch(() => { if (!controller.signal.aborted) setResource({ result: { ok: false, state: 'unavailable', message: 'The research request could not be completed.' }, loading: false }); });
    return () => controller.abort();
  }, [url]);
  return resource;
}

function display(value: J | undefined, key = ''): string {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (/price$|price_american$/.test(key)) return value > 0 ? `+${value}` : String(value);
    if (/pct$|percent$/.test(key)) return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toLocaleString();
  return String(value);
}

/** A null-preserving, paginated evidence renderer for every supported response.
 * Unknown fields remain inspectable; object values are never interpolated as HTML.
 */
function Evidence({ value, depth = 0 }: { value: J; depth?: number }) {
  const [page, setPage] = React.useState(0);
  React.useEffect(() => setPage(0), [value]);
  if (primitive(value)) return <span>{display(value)}</span>;
  if (depth > 7) return <pre className={styles.raw}>{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value)) {
    if (!value.length) return <p className={styles.muted}>No records returned for this selection.</p>;
    const records = value.map(obj);
    const columns = [...new Set(records.flatMap((r) => Object.keys(r).filter((k) => primitive(r[k]))))];
    const visibleColumns = columns.slice(0, 7);
    const visible = value.slice(page * 25, (page + 1) * 25);
    if (!columns.length || value.some(primitive)) return <div className={styles.evidenceList}>{visible.map((v, i) => <details key={page * 25 + i}><summary>{primitive(v) ? display(v) : titleOf(obj(v), page * 25 + i)}</summary><Evidence value={v} depth={depth + 1} /></details>)}<Pager page={page} total={value.length} size={25} setPage={setPage} /></div>;
    return <><div className={styles.tableScroll}><table className={styles.table}><thead><tr>{visibleColumns.map((k) => <th key={k}>{human(k)}</th>)}<th>Evidence</th></tr></thead><tbody>{visible.map((v, i) => { const r = obj(v); return <tr key={page * 25 + i}>{visibleColumns.map((k) => <td key={k}>{display(r[k], k)}</td>)}<td><details><summary>Details</summary><div className={styles.detail}><Evidence value={r} depth={depth + 1} /></div></details></td></tr>; })}</tbody></table></div><Pager page={page} total={value.length} size={25} setPage={setPage} /></>;
  }
  const entries = Object.entries(value);
  const leaves = entries.filter(([, v]) => primitive(v));
  const nested = entries.filter(([, v]) => !primitive(v));
  return <div className={styles.evidence}>{value.redacted === true && <p className={styles.warning}>Some values are not enabled for this data source. Unavailable is not zero.</p>}{leaves.length > 0 && <dl className={styles.facts}>{leaves.map(([k,v]) => <div key={k}><dt>{human(k)}</dt><dd>{display(v,k)}</dd></div>)}</dl>}{nested.map(([k,v]) => <section className={styles.nested} key={k}><h3>{human(k)}{Array.isArray(v) ? ` · ${v.length}` : ''}</h3><Evidence value={v} depth={depth + 1} /></section>)}</div>;
}
function Pager({ page, total, size, setPage }: { page: number; total: number; size: number; setPage: (n: number) => void }) {
  if (total <= size) return null;
  return <div className={styles.pager}><span>{page * size + 1}–{Math.min(total, (page + 1) * size)} of {total.toLocaleString()}</span><button type="button" disabled={!page} aria-label="Previous records" onClick={() => setPage(page - 1)}><ArrowLeft size={16} /></button><button type="button" disabled={(page + 1) * size >= total} aria-label="Next records" onClick={() => setPage(page + 1)}><ArrowRight size={16} /></button></div>;
}

type Quote = { event: Obj; book: Obj; market: Obj; outcome: Obj; identity: string };
function quoteRows(data: J): Quote[] {
  return (Array.isArray(data) ? data : [data]).flatMap((value) => {
    const event = obj(value);
    return arr(event.bookmakers).flatMap((bookValue) => { const book = obj(bookValue); return arr(book.markets).flatMap((marketValue) => { const market = obj(marketValue); return arr(market.outcomes).map((outcomeValue, index) => {
      const outcome = obj(outcomeValue);
      return { event, book, market, outcome, identity: JSON.stringify([event.sport_key,event.id,keyOf(book),keyOf(market),market.period,market.team,market.description,outcome.player_id,outcome.description,outcome.name,outcome.point,outcome.dfs_odds_type,outcome.outcome_id,index]) };
    }); }); });
  });
}
function Quotes({ data }: { data: J }) {
  const [filter, setFilter] = React.useState('');
  const [page, setPage] = React.useState(0);
  const all = React.useMemo(() => quoteRows(data), [data]);
  const visible = React.useMemo(() => all.filter((r) => [r.outcome.name,r.outcome.description,r.book.title,keyOf(r.book),keyOf(r.market),r.market.period,r.market.team,r.outcome.dfs_odds_type].map(str).join(' ').toLowerCase().includes(filter.toLowerCase())), [all, filter]);
  React.useEffect(() => setPage(0), [data, filter]);
  const books = new Set(all.map((r) => keyOf(r.book)));
  const marketCount = new Set(all.map((r) => keyOf(r.market)));
  return <><div className={styles.summary}><span><b>{all.length.toLocaleString()}</b> selections</span><span><b>{books.size}</b> books</span><span><b>{marketCount.size}</b> market keys</span><label className={styles.search}><Search size={15}/><input aria-label="Filter displayed selections" placeholder="Player, book, market…" value={filter} onChange={(e) => setFilter(e.target.value)}/></label></div>
    {!all.length ? <p className={styles.empty}>No market lines returned for this event and filter. It may be unpriced, suspended, or outside source coverage.</p> : <><div className={styles.tableScroll}><table className={`${styles.table} ${styles.quotes}`}><thead><tr><th>Player / selection</th><th>Book</th><th>Market / period</th><th>Line</th><th>Price</th><th>Availability</th><th>Evidence</th></tr></thead><tbody>{visible.slice(page * 50, (page + 1) * 50).map(({ event, book, market, outcome, identity }) => {
      const synthetic = outcome.pricing_class === 'synthetic-dfs';
      const state = str(outcome.offer_state) || 'unverified';
      return <tr key={identity}><td><strong>{str(outcome.description || market.team || outcome.name) || 'Unidentified selection'}</strong><small>{str(outcome.name)}{outcome.dfs_odds_type ? ` · ${str(outcome.dfs_odds_type)}` : ''}</small></td><td>{str(book.title) || keyOf(book)}</td><td>{human(keyOf(market))}<small>{str(market.period) || 'Full game'}{market.team ? ` · ${str(market.team)}` : ''}</small></td><td>{outcome.point == null ? '—' : display(outcome.point)}</td><td>{synthetic ? <span title="Synthetic DFS prices are not per-pick sportsbook payouts.">Projection</span> : display(outcome.price,'price')}{outcome.payout_multiplier != null && <small>×{display(outcome.payout_multiplier)}</small>}</td><td><span data-state={state} className={styles.status}>{state === 'available' ? 'Observed' : human(state)}</span></td><td><details><summary>Details</summary><div className={styles.detail}><Evidence value={{ event_id: event.id ?? null, sport_key: event.sport_key ?? null, book: keyOf(book), market: keyOf(market), period: market.period ?? null, team: market.team ?? null, last_update: market.last_update ?? null, ...outcome }}/></div></details></td></tr>;
    })}</tbody></table></div>{!visible.length && <p className={styles.empty}>No displayed selections match your search.</p>}<Pager page={page} total={visible.length} size={50} setPage={setPage}/></>}
  </>;
}

export function MarketExplorer() {
  const search = useSearchParams();
  const [kind, setKind] = React.useState(search.get('kind') || 'odds');
  const [sport, setSport] = React.useState(search.get('sport') || '');
  const [eventId, setEventId] = React.useState(search.get('eventId') || '');
  const [draft, setDraft] = React.useState<Record<string,string>>(() => Object.fromEntries(search));
  const [committed, setCommitted] = React.useState(draft);
  const catalog = useResource(requestKey({ kind: 'capabilities' }));
  const sports = useResource(catalog.result?.ok ? requestKey({ kind: 'sports' }) : null);
  const caps = arr(catalog.result?.data).map((v) => obj(v) as unknown as Capability);
  const capability = caps.find((c) => c.id === kind);
  const sportRows = arr(Array.isArray(sports.result?.data) ? sports.result?.data : obj(sports.result?.data).sports).map(obj);
  const needsSport = capability && ['sport','event','player'].includes(capability.scope);
  const needsEvent = capability?.scope === 'event';
  const needsPlayer = capability?.scope === 'player';
  React.useEffect(() => {
    if (!sport && sportRows.length) setSport(keyOf(sportRows.find((r) => keyOf(r) === 'baseball_mlb') ?? sportRows.find((r) => r.active !== false) ?? sportRows[0]));
  }, [sport, sportRows]);
  const events = useResource(needsEvent && sport && sports.result?.ok ? requestKey({kind:'events',sport}) : null);
  const eventRows = arr(Array.isArray(events.result?.data) ? events.result?.data : obj(events.result?.data).events).map(obj);
  const args: Record<string,string> = {kind};
  if (needsSport) args.sport = sport;
  if (needsEvent) args.eventId = eventId;
  if (needsPlayer) args.playerName = committed.playerName || '';
  for (const param of capability?.params ?? []) if (committed[param]) args[param] = committed[param];
  const valid = Boolean(capability && (!needsSport || sport) && (!needsEvent || eventId) && (!needsPlayer || args.playerName)
    && (kind !== 'player-history' || args.market) && (kind !== 'ev-calc' || (args.market && args.name && args.price)));
  const result = useResource(valid ? requestKey(args) : null);
  const activeGroup = capability?.group || 'Markets';
  const setField = (name: string, value: string) => setDraft((current) => ({ ...current, [name]: value }));
  const apply = (e: React.FormEvent) => {
    e.preventDefault(); setCommitted({ ...draft });
    const q = new URLSearchParams({ kind, ...(sport ? {sport} : {}), ...(eventId ? {eventId} : {}) });
    for (const name of [...(capability?.params ?? []), ...(needsPlayer ? ['playerName'] : [])]) if (draft[name]) q.set(name, draft[name]);
    window.history.replaceState(null, '', `/explore?${q}`);
  };
  const error = catalog.result?.ok === false ? catalog.result : needsSport && sports.result?.ok === false ? sports.result : needsEvent && events.result?.ok === false ? events.result : result.result?.ok === false ? result.result : null;
  return <main className={styles.shell}>
    <div className={styles.heading}><div><p className={styles.eyebrow}><Telescope size={14}/> RESEARCH WORKSPACE</p><h1>Market Explorer</h1><p className={styles.subtitle}>More markets. Every returned book. The evidence stays attached.</p></div><Link href="/board" className={styles.back}><ArrowLeft size={15}/> Props board</Link></div>
    <nav className={styles.groups} aria-label="Research categories">{groups.map((group) => <button key={group} type="button" aria-pressed={group === activeGroup} onClick={() => { const next = caps.find((c) => c.group === group && c.id !== 'markets') ?? caps.find((c) => c.group === group); if (next) setKind(next.id); }}>{group}</button>)}</nav>
    <div className={styles.subnav} role="group" aria-label="Research views">{caps.filter((c) => c.group === activeGroup).map((c) => <button key={c.id} type="button" aria-pressed={c.id === kind} onClick={() => setKind(c.id)}>{c.label}</button>)}</div>
    <form className={styles.filters} onSubmit={apply}>
      <div className={styles.primaryFilters}>
        {needsSport && <label>Sport / competition<select value={sport} onChange={(e) => {setSport(e.target.value);setEventId('');}}><option value="">Select a sport</option>{sportRows.map((r) => <option key={keyOf(r)} value={keyOf(r)}>{str(r.title) || keyOf(r)}{r.active === false ? ' · inactive' : ''}</option>)}</select></label>}
        {needsEvent && <label className={styles.eventSelect}>Event<select value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={events.loading}><option value="">{events.loading ? 'Loading events…' : eventRows.length ? 'Select an event' : 'No upcoming events returned'}</option>{eventId && !eventRows.some((r) => str(r.id) === eventId) && <option value={eventId}>Selected event {eventId}</option>}{eventRows.map((r) => <option key={str(r.id)} value={str(r.id)}>{str(r.away_team)} at {str(r.home_team)} · {display(r.commence_time)}</option>)}</select></label>}
        {needsPlayer && <label>Player<input value={draft.playerName || ''} onChange={(e) => setField('playerName',e.target.value)} maxLength={160} placeholder="Exact player name" required/></label>}
        <button className={styles.apply} type="submit" disabled={catalog.loading || result.loading}>Apply filters <ArrowRight size={15}/></button>
      </div>
      {(capability?.params.length ?? 0) > 0 && <details className={styles.advanced} open={kind === 'ev-calc' || kind === 'player-history'}><summary><SlidersHorizontal size={14}/> View filters <span>{capability?.params.length}</span></summary><div className={styles.filterGrid}>{capability?.params.map((name) => <label key={name}>{labels[name] || human(name)}{choices[name] ? <select value={draft[name] || ''} onChange={(e) => setField(name,e.target.value)}><option value="">{name === 'period' && ['odds','game-lines'].includes(kind) ? 'All periods (default)' : 'Default / no filter'}</option>{choices[name].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select> : <input type={name === 'date' ? 'date' : 'text'} value={draft[name] || ''} onChange={(e) => setField(name,e.target.value)} placeholder={['markets','bookmakers'].includes(name) ? 'All available' : name === 'price' ? 'e.g. -110' : name === 'limit' ? '20' : name === 'relative_from' ? '-3h' : name === 'relative_to' ? '0' : ''} maxLength={['markets','bookmakers','stat_type'].includes(name) ? 16000 : 160}/>}</label>)}</div></details>}
    </form>
    {capability?.note && <p className={styles.note}>{capability.note}</p>}
    <section className={styles.results} aria-label={capability?.label || 'Market research'} aria-busy={result.loading}>
      <div className={styles.resultHeading}><h2>{capability?.label || 'Research'}</h2><span>Cached snapshots · no automatic paid refresh</span></div>
      {error ? <div className={styles.empty} role="status"><h3>{error.state === 'sign-in' ? 'Sign in to explore' : 'Data not available'}</h3><p>{error.message}</p>{error.state === 'sign-in' && <Link className={styles.apply} href="/account">Sign in</Link>}</div>
        : catalog.loading || result.loading ? <div className={styles.loading} role="status"><span/> Loading research…</div>
        : !valid ? <p className={styles.empty}>{needsEvent ? 'Choose an event to inspect its markets. No event-by-event requests run until you select one.' : needsPlayer ? 'Enter a player and apply filters to load their archive.' : 'Choose a view and complete its required filters.'}</p>
        : result.result?.data == null ? <p className={styles.empty}>No data returned for this selection.</p>
        : <>{result.result.state === 'limited' && <p className={styles.warning}>Some numerical values are unavailable for this data feature.</p>}{['odds','game-lines'].includes(kind) ? <Quotes data={result.result.data}/> : <Evidence value={result.result.data}/>}</>}
    </section>
    <p className={styles.footnote}>Research only. Historical hit rates and market-implied values are not guarantees. Unavailable statistics are never filled with invented values.</p>
  </main>;
}
