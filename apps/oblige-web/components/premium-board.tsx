'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Menu, Search, SlidersHorizontal } from 'lucide-react';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, windowOf } from '@/lib/api';
import { computeWindow, playable, sortRecentFirst } from '@/lib/analytics';
import { collapsePlayerCards, playerResearchHref, restrictBook } from '@/lib/player-cards';
import type { BoardMeta, PropGroup, PropRow, ResearchResponse } from '@/lib/types';
import { pctValue } from '@/lib/utils';
import { finiteNumber as numberOf, isDfs, quotePriceLabel, quoteSeenLabel, quoteVariant, variantLabel } from '@/lib/prop-signals';
import { fetchMarketReferences, referenceKey, type MarketReference } from '@/lib/market-reference';
import { bestEv, fetchPredictions, modelLabel, predictionKey, usablePrediction, type Prediction } from '@/lib/model-data';
import { PlayerHeadshot } from '@/components/player-headshot';
import { SignInPanel } from '@/components/sign-in';
import styles from './premium-board.module.css';

const ALL = 'ALL';
const PAGE_SIZE = 60;
const RESEARCH_WORKERS = 6;

type ResearchStat = { rate: number | null; hits: number | null; sample: number; source: 'window' | 'game-log' | 'unavailable' } | null;

function text(value: unknown) {
  return String(value || '').trim();
}

function quoteBook(row: PropRow | null | undefined) {
  return text(row?.sportsbook || row?.sportsbookKey) || 'Book unavailable';
}

function displayQuote(group: PropGroup) {
  const candidates = [group.bestOver, group.bestUnder, ...group.quotes]
    .filter((row): row is PropRow => Boolean(row));
  return candidates.find((row) => {
    const price = numberOf(row.price);
    return !isDfs(row) && price !== null && price !== 0;
  }) || candidates[0] || null;
}

function boardResearchStat(response: ResearchResponse, line: number): ResearchStat {
  const last10 = windowOf(response, 'last10', 'l10', 'lastTen');
  const rate = pctValue(last10?.hitRate ?? null);
  const sampleRaw = numberOf(last10?.sampleSize ?? last10?.games);
  const hitsRaw = numberOf(last10?.hits);
  if (response.available !== false && last10?.available !== false && rate !== null && sampleRaw !== null && sampleRaw > 0) {
    return {
      rate,
      hits: hitsRaw,
      sample: sampleRaw === null ? 0 : Math.max(0, Math.round(sampleRaw)),
      source: 'window',
    };
  }

  // Some research providers return a verified game log before they materialize
  // window summaries. Recompute L10 from that exact log + posted line using the
  // same analytics policy as the player page; never invent missing history.
  const fallback = computeWindow(
    sortRecentFirst(playable(response.available === false ? [] : response.gameLog || [])),
    line,
    'OVER',
    'l10',
    'L10',
    10,
  );
  if (fallback.hitRate !== null) {
    return {
      rate: fallback.hitRate,
      hits: fallback.hits,
      sample: fallback.games,
      source: 'game-log',
    };
  }
  return { rate: null, hits: null, sample: 0, source: 'unavailable' };
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
  const [variant, setVariant] = React.useState(ALL);
  const [retry, setRetry] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());
  const [sort, setSort] = React.useState('EV');
  const [predictions, setPredictions] = React.useState<Record<string, Prediction>>({});
  const [marketRefs, setMarketRefs] = React.useState<Record<string, MarketReference>>({});
  const [research, setResearch] = React.useState<Record<string, ResearchStat>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

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
        setVariant(ALL);
        setPredictions({});
        setMarketRefs({});
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
        if (variant !== ALL && quoteVariant(group.quotes[0]) !== variant) return false;
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
      const ev = (group: PropGroup) => bestEv(group, predictions[predictionKey(group)], now) ?? (marketRefs[referenceKey(group)]?.expiresAt > now ? marketRefs[referenceKey(group)]?.ev : null) ?? -Infinity;
      return ev(b) - ev(a);
    });
  }, [book, groups, line, market, opponent, predictions, query, research, sort, team, variant, now, marketRefs]);

  const page = filtered.slice(0, PAGE_SIZE);
  const pageKey = page.map(predictionKey).sort().join('|');

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const pending = page.filter(group => predictions[predictionKey(group)] === undefined);
    void fetchPredictions(pending, controller.signal, results => {
      if (!controller.signal.aborted) setPredictions(current => ({ ...current, ...results }));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey, retry]);

  const referenceTargets = page.filter(group => predictions[predictionKey(group)] !== undefined && !usablePrediction(predictions[predictionKey(group)], now));
  const referencePageKey = referenceTargets.map(referenceKey).sort().join('|');
  React.useEffect(() => {
    if (!account || !referenceTargets.length) return;
    const controller = new AbortController();
    void fetchMarketReferences(referenceTargets.filter(group => marketRefs[referenceKey(group)] === undefined), controller.signal, values => {
      if (!controller.signal.aborted) setMarketRefs(current => ({ ...current, ...values }));
    });
    return () => controller.abort();
    // Visible selection changes and explicit retries are the only triggers; no provider polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, referencePageKey, retry]);

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const queue = page.filter((group) => research[group.key] === undefined);
    if (!queue.length) return () => controller.abort();

    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift();
        if (!group) break;
        try {
          const response = await fetchResearch(group, 'OVER', controller.signal);
          const result = boardResearchStat(response, group.line);
          if (!controller.signal.aborted) {
            setResearch((current) => ({ ...current, [group.key]: result }));
          }
        } catch {
          if (!controller.signal.aborted) {
            setResearch((current) => ({ ...current, [group.key]: null }));
          }
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(RESEARCH_WORKERS, queue.length) }, worker));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey, retry]);

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
          <SelectPill label="Prop type" value={variant} onChange={setVariant} options={[
            { value: ALL, label: 'All prop types' }, { value: 'standard', label: 'Standard' },
            { value: 'goblin', label: '🟢 Goblin' }, { value: 'demon', label: '🔴 Demon' },
            { value: 'boost', label: 'Underdog boost' }, { value: 'discount', label: 'Underdog discount' }, { value: 'alternate', label: 'Alternates' },
          ]} />
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
                const prediction = predictions[predictionKey(group)];
                const predictionLoading = prediction === undefined;
                const reference = marketRefs[referenceKey(group)];
                const freshReference = reference && reference.expiresAt > now ? reference : null;
                const modelEv = bestEv(group, prediction, now);
                const ev = modelEv ?? freshReference?.ev ?? null;
                const researchStat = research[group.key];
                const hitLoading = researchStat === undefined;
                const hit = researchStat?.rate ?? null;
                const projection = usablePrediction(prediction, now)
                  ? Number(prediction.projection)
                  : freshReference?.projection ?? null;
                const projectionSource = usablePrediction(prediction, now) ? modelLabel(prediction) : 'Market implied';
                const projectionLoading = predictionLoading || (!usablePrediction(prediction, now) && reference === undefined);
                const bestQuote = displayQuote(group);
                const badges = [...new Map(group.specialVariants.map(item => [quoteVariant(item.quotes[0]), item])).values()];
                const forecastReason = reference && reference.expiresAt <= now ? 'Market reference expired. Retry data to refresh.' : prediction?.available && !usablePrediction(prediction, now) ? 'Forecast expired. Retry data to refresh.' : [prediction?.message, reference?.reason].filter(Boolean).join(' ') || 'No verified projection for this selection.';
                const bookNames = group.bookNames.slice(0, 4);
                const sampleLabel = researchStat?.sample
                  ? `${researchStat.hits ?? '—'}/${researchStat.sample} L10`
                  : hitLoading ? 'Loading L10' : 'No verified L10 sample';
                return (
                  <tr
                    key={group.playerCardKey}
                    data-player-card={group.playerCardKey}
                    onClick={() => router.push(playerResearchHref(group, group.playerCardKey, book === ALL ? null : book))}
                  >
                    <td>
                      <div className={styles.player}>
                        <PlayerHeadshot sport={group.sport} name={group.player} team={group.team} providerPlayerId={group.providerPlayerId} />
                        <span><b>{group.player}</b><small>{group.team || 'Team unavailable'}</small></span>
                      </div>
                    </td>
                    <td data-label="Matchup"><span className={styles.matchup}>{group.matchup}</span><small>{matchupTime(group.startsAt)}</small></td>
                    <td data-label="Stat" className={styles.statCell}>
                      <span>{group.market}</span>
                      {group.categoryCount > 1 ? <small>{group.categoryCount} stats inside</small> : null}
                      {badges.length > 0 && <div className={styles.variants}>{badges.map(item => <a key={item.key} data-variant={quoteVariant(item.quotes[0])} href={playerResearchHref(item, group.playerCardKey, item.quotes[0]?.sportsbookKey || item.quotes[0]?.sportsbook)} onClick={event => event.stopPropagation()} title={`${item.market} · ${item.line} · ${item.quotes[0]?.sportsbook || ''}`}>{variantLabel(item.quotes[0])}</a>)}</div>}
                    </td>
                    <td data-label="Line" className={styles.number}>{Number.isFinite(group.line) ? group.line : 'N/A'}</td>
                    <td data-label="Odds"><span className={styles.odds}>{quotePriceLabel(bestQuote)}</span><small>{quoteSeenLabel(bestQuote, now)}</small>{numberOf(bestQuote?.liquidity) !== null && <small title="Provider-reported amount available at this quote">Liquidity {Number(bestQuote?.liquidity).toLocaleString()}</small>}</td>
                    <td data-label="Proj" className={styles.number} title={projection === null ? forecastReason : projectionSource === 'Market implied' ? `PropLine market reference · ${freshReference?.booksContributing ?? 'Unknown'} contributing books` : `${modelLabel(prediction)} · ${prediction?.modelVersion}`}>
                      {projectionLoading ? '…' : projection === null ? 'No estimate' : projection.toFixed(1)}
                      {projection !== null && <small>{projectionSource}</small>}
                    </td>
                    <td data-label="EV%" title={isDfs(bestQuote) ? 'DFS entry payouts do not provide single-leg sportsbook EV.' : ev === null ? forecastReason : modelEv !== null ? `${modelLabel(prediction)} · exact book and line, with pushes` : `PropLine no-vig reference · ${freshReference?.book} ${freshReference?.side} · line ${group.line}`} className={styles.ev} data-positive={ev !== null && ev > 0 ? 'true' : 'false'}>
                      {isDfs(bestQuote) ? 'Entry payout' : projectionLoading ? '…' : ev === null ? 'No estimate' : `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}%`}
                      {ev !== null && modelEv === null && <small>Market no-vig</small>}
                    </td>
                    <td data-label="Hit rate" title={sampleLabel}>
                      <div className={styles.hit}>
                        <span>{hitLoading ? '…' : hit === null ? 'No history' : `${Math.round(hit)}%`}</span>
                        <i><b style={{ width: hit === null ? '0%' : `${Math.max(0, Math.min(100, hit))}%` }} /></i>
                      </div>
                    </td>
                    <td data-label="Books">
                      <div className={styles.books}>
                        {bookNames.length
                          ? bookNames.map((name) => <span key={name} title={name}>{bookShort(name)}</span>)
                          : <em className={styles.unavailable}>No quotes</em>}
                        {group.bookCount > bookNames.length && <span title={`${group.bookCount} books at this stat and line`}>+{group.bookCount - bookNames.length}</span>}
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
          <span>{filtered.length.toLocaleString()} players</span>
          <button type="button" onClick={() => {
            setPredictions(current => Object.fromEntries(Object.entries(current).filter(([, value]) => usablePrediction(value))));
            setMarketRefs(current => Object.fromEntries(Object.entries(current).filter(([, value]) => value.expiresAt > Date.now() && (value.projection !== null || value.ev !== null))));
            setResearch(current => Object.fromEntries(Object.entries(current).filter(([, value]) => value?.rate !== null && value !== null)));
            setRetry(value => value + 1);
          }}>Retry missing data</button>
          <span>{(meta.sportsbookCount ?? books.length) || 0} books</span>
          <span>{meta.stale ? 'Cached feed' : 'Live board'}</span>
        </div>
      </div>
    </main>
  );
}
