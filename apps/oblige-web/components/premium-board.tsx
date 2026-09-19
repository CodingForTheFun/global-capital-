'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Menu, Search, SlidersHorizontal } from 'lucide-react';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, windowOf } from '@/lib/api';
import { computeWindow, playable, sortRecentFirst } from '@/lib/analytics';
import { collapsePlayerCards, playerResearchHref, restrictBook } from '@/lib/player-cards';
import type { BoardMeta, PropGroup, PropRow, ResearchResponse } from '@/lib/types';
import { pctValue } from '@/lib/utils';
import { PlayerHeadshot } from '@/components/player-headshot';
import { SignInPanel } from '@/components/sign-in';
import styles from './premium-board.module.css';

const ALL = 'ALL';
const PAGE_SIZE = 60;
const RESEARCH_WORKERS = 6;
const MARKET_REFERENCE_WORKERS = 4;

type Prediction = {
  available?: boolean;
  projection?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
};

type ResearchStat = {
  rate: number | null;
  hits: number | null;
  sample: number;
  source: 'window' | 'game-log' | 'propline-graded' | 'unavailable';
} | null;

type MarketReference = {
  projection: number | null;
  ev: number | null;
  projectionBasis: 'market-implied' | null;
  evBasis: 'no-vig-market' | null;
};

function text(value: unknown) {
  return String(value || '').trim();
}

function numberOf(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
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

function canonical(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function quoteProduct(row: PropRow | null) {
  if (!row) return null;
  const book = quoteBook(row).toLowerCase();
  const special = text(row.specialType || row.dfsOddsType || row.dfs_odds_type).toLowerCase();
  if (special === 'goblin') return 'Goblin';
  if (special === 'demon') return 'Demon';
  if (special && special !== 'standard') return special;
  const multiplier = numberOf(row.multiplier ?? row.payoutMultiplier ?? row.payout_multiplier);
  if (multiplier !== null && multiplier > 0 && multiplier !== 1) return `${multiplier}×`;
  const payout = text(row.payoutType || row.payout_type).toLowerCase();
  if (payout === 'pickem' || payout === 'pick_em' || payout === 'pick-em') {
    return book.includes('draftkings') ? 'Pick6' : "Pick'em";
  }
  if (special === 'standard') {
    if (book.includes('draftkings')) return 'Pick6';
    if (book.includes('prizepicks') || book.includes('underdog')) return "Pick'em";
    return 'DFS';
  }
  if (book.includes('prizepicks') || book.includes('underdog')) return "Pick'em";
  return null;
}

function displayQuote(group: PropGroup) {
  const candidates = [group.bestOver, group.bestUnder, ...group.quotes]
    .filter((row): row is PropRow => Boolean(row));
  return candidates.find((row) => {
    const price = numberOf(row.price);
    return price !== null && price !== 0;
  }) || candidates[0] || null;
}

function quotePriceLabel(row: PropRow | null) {
  const price = numberOf(row?.price);
  if (price !== null && price !== 0) return priceLabel(price);
  return quoteProduct(row) || '—';
}

function marketReferenceFrom(
  group: PropGroup,
  projections: unknown,
  evPayload: unknown,
): MarketReference {
  const marketKey = canonical(group.marketId || group.market);
  const playerName = canonical(group.player);
  const projectionRows = Array.isArray((projections as { projections?: unknown[] } | null)?.projections)
    ? (projections as { projections: Array<Record<string, unknown>> }).projections
    : [];
  const projectionRow = projectionRows.find((row) =>
    canonical(row.playerName) === playerName && canonical(row.marketKey) === marketKey
  );
  const projection = numberOf(projectionRow?.projection);

  const plays = Array.isArray((evPayload as { plays?: unknown[] } | null)?.plays)
    ? (evPayload as { plays: Array<Record<string, unknown>> }).plays
    : [];
  const exact = plays.filter((row) => {
    if (canonical(row.playerName) !== playerName || canonical(row.marketKey) !== marketKey) return false;
    const line = numberOf(row.line);
    return line !== null && Math.abs(line - group.line) < 1e-9;
  });
  const ev = exact
    .map((row) => numberOf(row.evPercent))
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a)[0] ?? null;

  return {
    projection,
    ev,
    projectionBasis: projection === null ? null : 'market-implied',
    evBasis: ev === null ? null : 'no-vig-market',
  };
}

async function propLineJson(path: string, signal: AbortSignal) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { available?: boolean; data?: unknown } | null;
  return body?.available ? body.data ?? null : null;
}

async function propLineTrendStat(group: PropGroup, signal: AbortSignal): Promise<ResearchStat> {
  if (!group.marketId || !group.player) return null;
  const params = new URLSearchParams({
    kind: 'trends',
    sport: group.sport,
    playerName: group.player,
  });
  const data = await propLineJson(`/api/apex/propline?${params}`, signal) as {
    markets?: Array<{
      marketKey?: string;
      windows?: { l10?: { hitRate?: number | null; over?: number | null; games?: number | null } | null };
    }>;
  } | null;
  const row = data?.markets?.find((candidate) => canonical(candidate.marketKey) === canonical(group.marketId));
  const window = row?.windows?.l10;
  const rate = pctValue(window?.hitRate ?? null);
  if (rate === null) return null;
  return {
    rate,
    hits: numberOf(window?.over),
    sample: Math.max(0, Math.round(numberOf(window?.games) ?? 0)),
    source: 'propline-graded',
  };
}

function boardResearchStat(response: ResearchResponse, line: number): ResearchStat {
  const last10 = windowOf(response, 'last10', 'l10', 'lastTen');
  const rate = pctValue(last10?.hitRate ?? null);
  const sampleRaw = numberOf(last10?.sampleSize ?? last10?.games);
  const hitsRaw = numberOf(last10?.hits);
  if (rate !== null) {
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
    sortRecentFirst(playable(response.gameLog || [])),
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
  const [sort, setSort] = React.useState('EV');
  const [predictions, setPredictions] = React.useState<Record<string, Prediction>>({});
  const [marketRefs, setMarketRefs] = React.useState<Record<string, MarketReference | null>>({});
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
      const evB = bestEv(b, predictions[b.key]) ?? marketRefs[b.key]?.ev ?? -Infinity;
      const evA = bestEv(a, predictions[a.key]) ?? marketRefs[a.key]?.ev ?? -Infinity;
      return evB - evA;
    });
  }, [book, groups, line, market, marketRefs, opponent, predictions, query, research, sort, team]);

  const page = filtered.slice(0, PAGE_SIZE);
  const pageKey = page.map((g) => g.key).join('|');

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const targets: Array<{ key: string; groupKey: string; payload: Record<string, unknown> }> = [];
    const unavailable: string[] = [];

    page
      .filter((group) => predictions[group.key] === undefined)
      .forEach((group) => {
        const quote = group.bestOver || group.bestUnder || group.quotes[0];
        const sportsbookKey = text(quote?.sportsbookKey || quote?.sportsbook);
        if (!quote?.eventId || !group.providerPlayerId || !group.marketId || !group.startsAt || !sportsbookKey) {
          unavailable.push(group.key);
          return;
        }
        const key = String(targets.length);
        targets.push({
          key,
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
            key,
          },
        });
      });

    if (unavailable.length) {
      setPredictions((current) => {
        const next = { ...current };
        unavailable.forEach((key) => { if (next[key] === undefined) next[key] = { available: false }; });
        return next;
      });
    }
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
        if (controller.signal.aborted) return;
        setPredictions((current) => {
          const next = { ...current };
          targets.forEach((target) => {
            next[target.groupKey] = body?.results?.[target.key] || { available: false };
          });
          return next;
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPredictions((current) => {
          const next = { ...current };
          targets.forEach((target) => { next[target.groupKey] = { available: false }; });
          return next;
        });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const unresolved = page.filter((group) => marketRefs[group.key] === undefined);
    if (!unresolved.length) return () => controller.abort();

    const byEvent = new Map<string, PropGroup[]>();
    for (const group of unresolved) {
      const eventId = text(group.quotes.find((quote) => quote.eventId)?.eventId);
      if (!eventId || !group.marketId) {
        setMarketRefs((current) => ({ ...current, [group.key]: null }));
        continue;
      }
      const key = JSON.stringify([group.sport, eventId]);
      const rows = byEvent.get(key) || [];
      rows.push(group);
      byEvent.set(key, rows);
    }
    const jobs = [...byEvent.values()];
    let cursor = 0;

    const worker = async () => {
      while (cursor < jobs.length && !controller.signal.aborted) {
        const rows = jobs[cursor++];
        const first = rows[0];
        const eventId = text(first.quotes.find((quote) => quote.eventId)?.eventId);
        const markets = [...new Set(rows.map((group) => group.marketId).filter((value): value is string => Boolean(value)))].join(',');
        const common = new URLSearchParams({ sport: first.sport, eventId, ...(markets ? { markets } : {}) });
        try {
          const [projections, ev] = await Promise.all([
            propLineJson(`/api/apex/propline?kind=projections&${common}`, controller.signal),
            propLineJson(`/api/apex/propline?kind=ev&${common}`, controller.signal),
          ]);
          if (!controller.signal.aborted) {
            setMarketRefs((current) => {
              const next = { ...current };
              rows.forEach((group) => { next[group.key] = marketReferenceFrom(group, projections, ev); });
              return next;
            });
          }
        } catch {
          if (!controller.signal.aborted) {
            setMarketRefs((current) => {
              const next = { ...current };
              rows.forEach((group) => { next[group.key] = null; });
              return next;
            });
          }
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(MARKET_REFERENCE_WORKERS, jobs.length) }, worker));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

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
          let result = boardResearchStat(response, group.line);
          if (!result?.rate && result?.rate !== 0) {
            result = await propLineTrendStat(group, controller.signal) || result;
          }
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
                const reference = marketRefs[group.key];
                const predictionLoading = prediction === undefined || reference === undefined;
                const modelProjection = prediction?.available ? numberOf(prediction.projection) : null;
                const projection = modelProjection ?? reference?.projection ?? null;
                const modelEv = bestEv(group, prediction);
                const ev = modelEv ?? reference?.ev ?? null;
                const projectionBasis = modelProjection !== null ? 'model' : reference?.projectionBasis;
                const evBasis = modelEv !== null ? 'model' : reference?.evBasis;
                const researchStat = research[group.key];
                const hitLoading = researchStat === undefined;
                const hit = researchStat?.rate ?? null;
                const bestQuote = displayQuote(group);
                const bookNames = group.bookNames.slice(0, 4);
                const sampleLabel = researchStat?.source === 'propline-graded'
                  ? researchStat.sample
                    ? `${researchStat.hits ?? '—'}/${researchStat.sample} PropLine graded L10 market trend · historical posted lines may differ from this line`
                    : 'PropLine graded L10 market trend'
                  : researchStat?.sample
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
                    </td>
                    <td data-label="Line" className={styles.number}>{group.line}</td>
                    <td data-label="Odds"><span className={styles.odds}>{quotePriceLabel(bestQuote)}</span></td>
                    <td
                      data-label="Proj"
                      className={styles.number}
                      title={projectionBasis === 'market-implied' ? 'PropLine market-implied projection' : projectionBasis === 'model' ? 'Validated model projection' : 'No projection source returned'}
                    >
                      {predictionLoading ? '…' : projection === null ? '—' : projection.toFixed(1)}
                      {projectionBasis === 'market-implied' ? <small className={styles.sourceTag}>market</small> : null}
                    </td>
                    <td
                      data-label="EV%"
                      className={styles.ev}
                      data-positive={ev !== null && ev > 0 ? 'true' : 'false'}
                      title={evBasis === 'no-vig-market' ? 'PropLine no-vig market EV' : evBasis === 'model' ? 'Model probability EV' : 'No comparable priced market returned'}
                    >
                      {predictionLoading ? '…' : ev === null ? '—' : `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}%`}
                      {evBasis === 'no-vig-market' ? <small className={styles.sourceTag}>no-vig</small> : null}
                    </td>
                    <td data-label="Hit rate" title={sampleLabel}>
                      <div className={styles.hit}>
                        <span>{hitLoading ? '…' : hit === null ? '—' : `${Math.round(hit)}%`}</span>
                        <i><b style={{ width: hit === null ? '0%' : `${Math.max(0, Math.min(100, hit))}%` }} /></i>
                      </div>
                      {researchStat?.source === 'propline-graded' ? <small className={styles.sourceTag}>graded</small> : null}
                    </td>
                    <td data-label="Books">
                      <div className={styles.books}>
                        {bookNames.map((name) => <span key={name} title={name}>{bookShort(name)}</span>)}
                        {group.bookNames.length > bookNames.length ? <span title={group.bookNames.slice(bookNames.length).join(', ')}>+{group.bookNames.length - bookNames.length}</span> : null}
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
          <span>{(meta.sportsbookCount ?? books.length) || 0} books</span>
          <span>{meta.stale ? 'Cached feed' : 'Live board'}</span>
        </div>
      </div>
    </main>
  );
}
