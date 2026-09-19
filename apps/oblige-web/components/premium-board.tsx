'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Menu, Search, SlidersHorizontal } from 'lucide-react';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, windowOf } from '@/lib/api';
import { collapsePlayerCards, playerResearchHref, restrictBook } from '@/lib/player-cards';
import type { BoardMeta, PropGroup, PropRow } from '@/lib/types';
import { pctValue } from '@/lib/utils';
import { PlayerHeadshot } from '@/components/player-headshot';
import { SignInPanel } from '@/components/sign-in';
import styles from './premium-board.module.css';

const ALL = 'ALL';
const PAGE_SIZE = 60;

type Prediction = {
  available?: boolean;
  projection?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
};

type ResearchStat = { rate: number | null } | null;

function text(value: unknown) {
  return String(value || '').trim();
}

function numberOf(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function americanDecimal(value: unknown) {
  const odds = Number(value);
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function quoteBook(row: PropRow | null | undefined) {
  return text(row?.sportsbook || row?.sportsbookKey) || 'Book unavailable';
}

function bestEv(group: PropGroup, prediction?: Prediction) {
  if (!prediction?.available) return null;
  const rows = [
    { probability: prediction.probabilityOver, quote: group.bestOver },
    { probability: prediction.probabilityUnder, quote: group.bestUnder },
  ];
  let best: number | null = null;
  for (const row of rows) {
    const raw = numberOf(row.probability);
    const probability = raw === null ? null : raw > 1 ? raw / 100 : raw;
    const price = numberOf(row.quote?.price);
    const decimal = americanDecimal(price);
    if (probability === null || decimal === null) continue;
    const ev = (probability * decimal - 1) * 100;
    if (best === null || ev > best) best = ev;
  }
  return best;
}

function priceLabel(value: unknown) {
  const n = numberOf(value);
  if (n === null || n === 0) return '—';
  return n > 0 ? `+${n}` : String(n);
}

function matchupTime(value: string | null) {
  if (!value) return 'Time unavailable';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return 'Time unavailable';
  return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function bookShort(name: string) {
  const clean = name.replace(/[^a-z0-9]/gi, '');
  return (clean.slice(0, 2) || '?').toUpperCase();
}

function SelectPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterPill}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}

export function PremiumBoard() {
  const router = useRouter();
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [sport, setSport] = React.useState('NFL');
  const [sports, setSports] = React.useState<string[]>(['NFL']);
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [query, setQuery] = React.useState('');
  const [market, setMarket] = React.useState(ALL);
  const [opponent, setOpponent] = React.useState(ALL);
  const [team, setTeam] = React.useState(ALL);
  const [book, setBook] = React.useState(ALL);
  const [line, setLine] = React.useState(ALL);
  const [sort, setSort] = React.useState('EV');
  const [predictions, setPredictions] = React.useState<Record<string, Prediction>>({});
  const [research, setResearch] = React.useState<Record<string, ResearchStat>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal).then(setAccount).finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (checking || !account) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchBoard(sport, controller.signal)
      .then((board) => {
        setGroups(board.groups);
        setMeta(board.meta);
        if (board.supportedSports.length) {
          setSports([...new Set(board.supportedSports.map((s) => text(s).toUpperCase()).filter(Boolean))]);
        }
        setMarket(ALL);
        setOpponent(ALL);
        setTeam(ALL);
        setBook(ALL);
        setLine(ALL);
        setPredictions({});
        setResearch({});
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) setAccount(null);
        else if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The live prop board is unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [account, checking, sport]);

  const markets = React.useMemo(() => [...new Set(groups.map((g) => g.market).filter(Boolean))].sort(), [groups]);
  const opponents = React.useMemo(() => [...new Set(groups.map((g) => g.opponent).filter((v): v is string => Boolean(v)))].sort(), [groups]);
  const teams = React.useMemo(() => [...new Set(groups.map((g) => g.team).filter((v): v is string => Boolean(v)))].sort(), [groups]);
  const lines = React.useMemo(() => [...new Set(groups.map((g) => String(g.line)))].sort((a, b) => Number(a) - Number(b)), [groups]);
  const books = React.useMemo(() => {
    const names = new Set<string>();
    for (const group of groups) {
      for (const quote of group.quotes) {
        const name = quoteBook(quote);
        if (name !== 'Book unavailable') names.add(name);
      }
    }
    return [...names].sort();
  }, [groups]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = groups
      .map((group) => (book === ALL ? group : restrictBook(group, book)))
      .filter((group) => {
        if (market !== ALL && group.market !== market) return false;
        if (opponent !== ALL && group.opponent !== opponent) return false;
        if (team !== ALL && group.team !== team) return false;
        if (line !== ALL && String(group.line) !== line) return false;
        if (book !== ALL && !group.quotes.some((quote) => quoteBook(quote) === book)) return false;
        if (needle && !`${group.player} ${group.market} ${group.matchup} ${group.team || ''} ${group.opponent || ''}`.toLowerCase().includes(needle)) return false;
        return true;
      });

    const collapsed = collapsePlayerCards(rows, groups);
    return [...collapsed].sort((a, b) => {
      if (sort === 'PLAYER') return a.player.localeCompare(b.player);
      if (sort === 'LINE') return b.line - a.line;
      if (sort === 'HIT') return (research[b.key]?.rate ?? -1) - (research[a.key]?.rate ?? -1);
      return (bestEv(b, predictions[b.key]) ?? -Infinity) - (bestEv(a, predictions[a.key]) ?? -Infinity);
    });
  }, [book, groups, line, market, opponent, predictions, query, research, sort, team]);

  const page = filtered.slice(0, PAGE_SIZE);
  const pageKey = page.map((g) => g.key).join('|');

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const targets = page
      .filter((group) => predictions[group.key] === undefined)
      .map((group, index) => {
        const quote = group.bestOver || group.bestUnder || group.quotes[0];
        if (!quote?.eventId || !group.providerPlayerId || !group.marketId || !group.startsAt) return null;
        const sportsbookKey = text(quote.sportsbookKey || quote.sportsbook);
        if (!sportsbookKey) return null;
        return {
          key: String(index),
          groupKey: group.key,
          payload: {
            sport: group.sport,
            eventId: quote.eventId,
            playerId: group.providerPlayerId,
            playerName: group.player,
            marketId: group.marketId,
            sportsbookKey,
            gameStartTime: group.startsAt,
            line: group.line,
            entityType: 'player',
            live: group.live,
            isAlternate: false,
            key: String(index),
          },
        };
      })
      .filter(Boolean) as Array<{ key: string; groupKey: string; payload: Record<string, unknown> }>;
    if (!targets.length) return () => controller.abort();

    fetch('/api/props/ml', {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ props: targets.map((t) => t.payload) }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((body) => {
        if (!body?.results || controller.signal.aborted) return;
        setPredictions((current) => {
          const next = { ...current };
          targets.forEach((target) => {
            next[target.groupKey] = body.results[target.key] || { available: false };
          });
          return next;
        });
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const queue = page.filter((group) => research[group.key] === undefined);
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift();
        if (!group) break;
        try {
          const response = await fetchResearch(group, 'OVER', controller.signal);
          const last10 = windowOf(response, 'last10', 'l10', 'lastTen');
          const rate = pctValue(last10?.hitRate ?? null);
          if (!controller.signal.aborted) setResearch((current) => ({ ...current, [group.key]: { rate } }));
        } catch {
          if (!controller.signal.aborted) setResearch((current) => ({ ...current, [group.key]: null }));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  if (checking) return <div className={styles.loading}>Loading prop board…</div>;
  if (!account) return <div className={styles.signIn}><SignInPanel onSignedIn={setAccount} /></div>;

  return (
    <main className={styles.shell}>
      <div className={styles.board}>
        <div className={styles.topRow}>
          <nav className={styles.sportNav} aria-label="Sports">
            {sports.slice(0, 7).map((option) => (
              <button key={option} type="button" className={sport === option ? styles.activeSport : ''} onClick={() => setSport(option)}>
                {option}
              </button>
            ))}
            {sports.length > 7 ? <button type="button">More <ChevronDown size={14} /></button> : null}
          </nav>

          <label className={styles.search}>
            <Search size={18} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players, teams, or props…" />
          </label>
          <button className={styles.menuButton} type="button" aria-label="Menu"><Menu size={22} /></button>
        </div>

        <div className={styles.filters}>
          <SelectPill label="Opponent" value={opponent} onChange={setOpponent} options={[{ value: ALL, label: 'Opponent' }, ...opponents.map((v) => ({ value: v, label: v }))]} />
          <SelectPill label="Stat" value={market} onChange={setMarket} options={[{ value: ALL, label: 'Stat' }, ...markets.map((v) => ({ value: v, label: v }))]} />
          <SelectPill label="Season" value={ALL} onChange={() => {}} options={[{ value: ALL, label: 'Season' }]} />
          <SelectPill label="Home/Away" value={ALL} onChange={() => {}} options={[{ value: ALL, label: 'Home/Away' }]} />
          <SelectPill label="Team" value={team} onChange={setTeam} options={[{ value: ALL, label: 'Team' }, ...teams.map((v) => ({ value: v, label: v }))]} />
          <SelectPill label="Book" value={book} onChange={setBook} options={[{ value: ALL, label: 'Book' }, ...books.map((v) => ({ value: v, label: v }))]} />
          <SelectPill label="Line" value={line} onChange={setLine} options={[{ value: ALL, label: 'Line' }, ...lines.map((v) => ({ value: v, label: v }))]} />
          <SelectPill label="More filters" value={ALL} onChange={() => {}} options={[{ value: ALL, label: 'More' }]} />
          <span className={styles.filterSpacer} />
          <button className={styles.sortIcon} type="button" aria-label="Sort"><SlidersHorizontal size={16} /></button>
          <SelectPill label="Sort" value={sort} onChange={setSort} options={[
            { value: 'EV', label: 'EV%' },
            { value: 'HIT', label: 'Hit rate' },
            { value: 'LINE', label: 'Line' },
            { value: 'PLAYER', label: 'Player' },
          ]} />
        </div>

        <section className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Matchup</th>
                <th>Stat</th>
                <th>Line</th>
                <th>Odds</th>
                <th>Proj</th>
                <th>EV%</th>
                <th>Hit rate</th>
                <th>Books</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {page.map((group) => {
                const prediction = predictions[group.key];
                const ev = bestEv(group, prediction);
                const hit = research[group.key]?.rate ?? null;
                const bestQuote = group.bestOver || group.bestUnder || group.quotes[0];
                const bookNames = [...new Set(group.quotes.map((q) => quoteBook(q)).filter((v) => v !== 'Book unavailable'))].slice(0, 4);
                return (
                  <tr key={group.key} data-player-card={group.key} onClick={() => router.push(playerResearchHref(group, undefined, book === ALL ? null : book))}>
                    <td>
                      <div className={styles.player}>
                        <PlayerHeadshot sport={group.sport} name={group.player} team={group.team} providerPlayerId={group.providerPlayerId} />
                        <span><b>{group.player}</b><small>{group.team || 'Team unavailable'}</small></span>
                      </div>
                    </td>
                    <td><span className={styles.matchup}>{group.matchup}</span><small>{matchupTime(group.startsAt)}</small></td>
                    <td>{group.market}</td>
                    <td className={styles.number}>{group.line}</td>
                    <td><span className={styles.odds}>{priceLabel(bestQuote?.price)}</span></td>
                    <td className={styles.number}>{prediction?.available && numberOf(prediction.projection) !== null ? Number(prediction.projection).toFixed(1) : '—'}</td>
                    <td className={styles.ev} data-positive={ev !== null && ev > 0 ? 'true' : 'false'}>{ev === null ? '—' : `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}%`}</td>
                    <td>
                      <div className={styles.hit}><span>{hit === null ? '—' : `${Math.round(hit)}%`}</span><i><b style={{ width: hit === null ? '0%' : `${Math.max(0, Math.min(100, hit))}%` }} /></i></div>
                    </td>
                    <td>
                      <div className={styles.books}>
                        {bookNames.map((name) => <span key={name} title={name}>{bookShort(name)}</span>)}
                      </div>
                    </td>
                    <td className={styles.chevron}>›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {loading ? <div className={styles.overlay}>Refreshing board…</div> : null}
          {error ? <div className={styles.empty}>{error}</div> : null}
          {!loading && !error && !page.length ? <div className={styles.empty}>No props match these filters.</div> : null}
        </section>

        <div className={styles.footerMeta}>
          <span>{filtered.length.toLocaleString()} props</span>
          <span>{(meta.sportsbookCount ?? books.length) || 0} books</span>
          <span>{meta.stale ? 'Cached feed' : 'Live board'}</span>
        </div>
      </div>
    </main>
  );
}
