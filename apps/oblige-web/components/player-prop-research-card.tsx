'use client';

import * as React from 'react';
import { ChevronDown, Flame, Minus, Plus, Star } from 'lucide-react';
import type { GameLogRow, PropGroup, PropRow, ResearchResponse, Side } from '@/lib/types';
import {
  applyFilters,
  computeWindow,
  headToHead,
  sortRecentFirst,
  type SampleFilters,
} from '@/lib/analytics';
import { buildOpponentOptions, currentOpponentLabels, sameTeamLabel } from '@/lib/opponent-options';
import { catalogBookRows, type CatalogBookRow } from '@/lib/book-catalog';
import { expectedValueFor, expectedValueSourceLabel, type ExpectedValueSelection } from '@/lib/expected-value.mjs';
import { PlayerAvatar } from '@/components/face-card';
import { marketDisplayLabel, odds, shortDate, shortTime } from '@/lib/utils';

export type PlayerPropResearchState = {
  line: number;
  side: Side;
  book: string | null;
};

type Props = {
  group: PropGroup;
  markets: PropGroup[];
  research: ResearchResponse | null;
  loading: boolean;
  state: PlayerPropResearchState;
  onState(next: PlayerPropResearchState): void;
  favourite: boolean;
  onFavourite(): void;
  onMarket(group: PropGroup): void;
};

type SampleId = 'l5' | 'l10' | 'l15' | 'season' | 'h2h';

type ModelPrediction = {
  available?: boolean;
  projection?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
  probabilityPush?: number;
  engine?: string;
  code?: string;
  message?: string;
  modelVersion?: string;
  sampleSize?: number;
  validation?: {
    method?: string;
    observations?: number;
    events?: number;
    rmse?: number | null;
    baselineRmse?: number | null;
    selectedStrategy?: string;
  };
};

type MlTarget = {
  sport: string;
  eventId: string;
  playerId: string;
  playerName: string;
  marketId: string;
  sportsbookKey: string;
  gameStartTime: string;
  line: number;
  entityType: 'player';
  live: boolean;
  isAlternate: false;
};

type SupportMetric = {
  label: string;
  value: string;
  sample: number;
};

const EMPTY_FILTERS: SampleFilters = { opponent: 'all', season: 'all', venue: 'all' };
const text = (value: unknown) => String(value ?? '').trim();

function numberOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function rateLabel(value: number | null) {
  return value === null ? '—' : String(value) + '%';
}

function metricValue(value: unknown, digits = 1) {
  const number = numberOf(value);
  return number === null ? 'Unavailable' : number.toFixed(digits);
}

function probabilityLabel(value: unknown) {
  const number = numberOf(value);
  if (number === null || number < 0) return 'Unavailable';
  const percent = number <= 1 ? number * 100 : number;
  return percent.toFixed(1) + '%';
}

function periodLabel(value: string | null) {
  const raw = text(value).toLowerCase();
  if (!raw || ['game', 'full', 'fullgame', 'match', 'singlestat', 'single_stat'].includes(raw)) return 'Full game';
  const direct = raw.match(/^([1-9])([qhpis])$/);
  if (direct) {
    const suffix: Record<string, string> = { q: 'Q', h: 'H', p: 'P', i: 'I', s: 'S' };
    return direct[1] + (suffix[direct[2]] || direct[2].toUpperCase());
  }
  return raw.toUpperCase();
}

function quoteBook(row: PropRow | null | undefined) {
  return text(row?.sportsbook || row?.sportsbookKey) || 'Book unavailable';
}

function bookInitials(name: string) {
  const clean = name.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return clean.slice(0, 4) || 'BOOK';
}

function quoteModifier(row: PropRow | null | undefined) {
  if (!row) return null;
  const special = text(row.specialType || row.dfsOddsType || row.payoutType);
  if (special && !/^(standard|regular|normal|none|straight)$/i.test(special)) {
    return special.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  const multiplier = numberOf(row.payoutMultiplier);
  if (multiplier !== null && Math.abs(multiplier - 1) > 0.0001) return multiplier + 'x payout';
  if (row.isAlternate === true) return 'Alternate';
  return null;
}

function mlTargetFor(group: PropGroup, quote: PropRow | null): MlTarget | null {
  const eventId = text(quote?.eventId);
  const playerId = text(group.providerPlayerId);
  const marketId = text(group.marketId);
  const sportsbookKey = text(quote?.sportsbookKey || quote?.sportsbook);
  const gameStartTime = text(group.startsAt);
  if (!eventId || !playerId || !marketId || !sportsbookKey || !Number.isFinite(Date.parse(gameStartTime))) {
    return null;
  }
  return {
    sport: group.sport,
    eventId,
    playerId,
    playerName: group.player,
    marketId,
    sportsbookKey,
    gameStartTime: new Date(gameStartTime).toISOString(),
    line: group.line,
    entityType: 'player',
    live: group.live,
    isAlternate: false,
  };
}

async function fetchHistoryModel(group: PropGroup, quote: PropRow | null, signal?: AbortSignal): Promise<ModelPrediction> {
  const target = mlTargetFor(group, quote);
  if (!target) {
    return {
      available: false,
      code: 'TARGET_UNVERIFIED',
      message: 'Verified model inputs are unavailable for this exact prop.',
    };
  }
  const response = await fetch('/api/props/ml', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ props: [{ ...target, key: 'player' }] }),
  });
  if (!response.ok) {
    return {
      available: false,
      code: 'MODEL_FEED_UNAVAILABLE',
      message: 'History model is temporarily unavailable.',
    };
  }
  const body = await response.json() as { ok?: boolean; results?: Record<string, ModelPrediction> };
  return body.ok && body.results?.player
    ? body.results.player
    : { available: false, code: 'MODEL_FEED_UNAVAILABLE', message: 'History model is temporarily unavailable.' };
}

function averageField(games: GameLogRow[], field: string) {
  const values = games
    .map((game) => numberOf((game as unknown as Record<string, unknown>)[field]))
    .filter((value): value is number => value !== null);
  if (!values.length) return { value: 'Unavailable', sample: 0 };
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { value: average.toFixed(1), sample: values.length };
}

function supportingMetrics(group: PropGroup, games: GameLogRow[]): SupportMetric[] {
  const sport = group.sport.toUpperCase();
  const maps: Record<string, Array<[string, string]>> = {
    NFL: [['PASS YDS', 'passingYards'], ['PASS TD', 'passingTouchdowns'], ['RUSH YDS', 'rushingYards'], ['REC', 'receptions'], ['TARGETS', 'targets']],
    NCAAF: [['PASS YDS', 'passingYards'], ['PASS TD', 'passingTouchdowns'], ['RUSH YDS', 'rushingYards'], ['REC', 'receptions'], ['TARGETS', 'targets']],
    NBA: [['MIN', 'minutes'], ['PTS', 'points'], ['REB', 'rebounds'], ['AST', 'assists'], ['3PM', 'threes']],
    WNBA: [['MIN', 'minutes'], ['PTS', 'points'], ['REB', 'rebounds'], ['AST', 'assists'], ['3PM', 'threes']],
    NCAAB: [['MIN', 'minutes'], ['PTS', 'points'], ['REB', 'rebounds'], ['AST', 'assists'], ['3PM', 'threes']],
    MLB: [['HITS', 'hits'], ['TB', 'totalBases'], ['RBI', 'runsBattedIn'], ['RUNS', 'runs'], ['SO', 'strikeouts']],
    NHL: [['SOG', 'shotsOnGoal'], ['GOALS', 'goals'], ['AST', 'assists'], ['PTS', 'points'], ['SAVES', 'saves']],
    SOCCER: [['GOALS', 'goals'], ['AST', 'assists'], ['SHOTS', 'shots'], ['SOT', 'shotsOnGoal'], ['TACKLES', 'tackles']],
    MLS: [['GOALS', 'goals'], ['AST', 'assists'], ['SHOTS', 'shots'], ['SOT', 'shotsOnGoal'], ['TACKLES', 'tackles']],
    EPL: [['GOALS', 'goals'], ['AST', 'assists'], ['SHOTS', 'shots'], ['SOT', 'shotsOnGoal'], ['TACKLES', 'tackles']],
    UCL: [['GOALS', 'goals'], ['AST', 'assists'], ['SHOTS', 'shots'], ['SOT', 'shotsOnGoal'], ['TACKLES', 'tackles']],
    TENNIS: [['ACES', 'aces'], ['DOUBLE FAULTS', 'doubleFaults'], ['GAMES WON', 'gamesWon'], ['SETS WON', 'setsWon'], ['1ST SERVE PTS', 'firstServePointsWon']],
  };
  const rows = maps[sport] || [];
  const output = rows.slice(0, 5).map(([label, field]) => ({ label, ...averageField(games, field) }));
  const values = games.map((game) => numberOf(game.value)).filter((value): value is number => value !== null);
  output.push({
    label: 'AVG / GM',
    value: values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : 'Unavailable',
    sample: values.length,
  });
  return output.slice(0, 6);
}

function MarketPill({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'h-10 shrink-0 rounded-full border px-4 text-[11px] font-extrabold tracking-[0.04em] transition',
        active
          ? 'border-[#2A9FFF] bg-[#112235] text-[#53B8FF] shadow-[0_0_20px_rgba(42,159,255,0.16)]'
          : 'border-[#263548] bg-[#0F1722] text-[#73829A]',
      )}
    >
      {children}
    </button>
  );
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
  onChange(value: string): void;
}) {
  const selected = options.find((option) => option.value === value)?.label || 'Unavailable';
  return (
    <label className="relative flex h-10 shrink-0 items-center gap-2 rounded-full border border-[#2B3A50] bg-[#111927] px-4 pr-8 text-[11px] font-medium text-[#93A2B8]">
      <span className="whitespace-nowrap">{label}: <b className="font-semibold text-[#C6D0DE]">{selected}</b></span>
      <select
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5" />
    </label>
  );
}

function HistoryChart({
  games,
  line,
  market,
  period,
}: {
  games: GameLogRow[];
  line: number;
  market: string;
  period: string;
}) {
  if (!games.length) {
    return (
      <section className="rounded-2xl border border-[#1E2D3D] bg-[#0E1823] p-3">
        <div className="flex items-center gap-2 text-[13px] font-black text-white">
          <Flame className="h-4 w-4 text-[#FF8B2B]" fill="currentColor" />
          Historical results
        </div>
        <div className="mt-3 grid min-h-[160px] place-items-center rounded-xl border border-dashed border-[#263548] px-5 text-center text-[11px] text-[#7E8FA5]">
          Verified historical games are unavailable for this selection.
        </div>
      </section>
    );
  }

  const rows = games.slice().reverse();
  const values = rows.map((game) => numberOf(game.value)).filter((value): value is number => value !== null);
  const maxValue = Math.max(1, line, ...values);
  const ceiling = maxValue * 1.18;
  const threshold = Math.max(0, Math.min(100, (line / ceiling) * 100));

  return (
    <section className="rounded-2xl border border-[#1E2D3D] bg-[#0E1823] p-3">
      <div className="flex items-center gap-2 text-[13px] font-black text-white">
        <Flame className="h-4 w-4 text-[#FF8B2B]" fill="currentColor" />
        Last {rows.length} Games – {market}
      </div>
      <div className="mt-1 text-[10px] font-medium text-[#8A9AB0]">
        Current target: {line} · {period}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-[#94A3B8]">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />Over</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#FF4D76]" />Under</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-[#64748B]" />DNP</span>
        <span className="flex items-center gap-1.5"><i className="w-4 border-t-2 border-dashed border-[#FBBF24]" />Prop line</span>
      </div>
      <div className="mt-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="relative h-[188px] min-w-[390px] border-b border-[#263548] bg-[repeating-linear-gradient(to_top,transparent_0,transparent_54px,rgba(71,85,105,.16)_54px,rgba(71,85,105,.16)_55px)]">
          <div
            className="pointer-events-none absolute inset-x-0 z-20 border-t border-dashed border-[#FBBF24]"
            style={{ bottom: String(threshold) + '%' }}
          >
            <span className="absolute right-0 -top-4 rounded bg-[#211d10] px-1 py-0.5 text-[8px] font-black text-[#FBBF24]">{line}</span>
          </div>
          <div
            className="absolute inset-0 grid items-end gap-[5px] px-1 pt-5"
            style={{ gridTemplateColumns: 'repeat(' + rows.length + ', minmax(18px, 1fr))' }}
          >
            {rows.map((game, index) => {
              const value = numberOf(game.value);
              const unavailable = value === null;
              const height = unavailable ? 5 : Math.max(2, Math.min(100, (value / ceiling) * 100));
              const tone = unavailable ? 'dnp' : value > line ? 'over' : value < line ? 'under' : 'push';
              return (
                <div key={(game.gameId || game.date || 'game') + '-' + index} className="relative flex h-full items-end">
                  <span
                    className="absolute inset-x-0 text-center text-[7px] font-black text-[#EEF3F8]"
                    style={{ bottom: 'calc(' + height + '% + 3px)' }}
                  >
                    {unavailable ? 'DNP' : value}
                  </span>
                  <span
                    title={shortDate(game.date) + ' · ' + (game.opponent || 'Opponent unavailable') + ' · ' + (unavailable ? 'DNP' : value)}
                    className={cx(
                      'block w-full rounded-t-[3px] border',
                      tone === 'over' && 'border-emerald-400/25 bg-gradient-to-t from-emerald-600 to-emerald-400',
                      tone === 'under' && 'border-rose-400/25 bg-gradient-to-t from-rose-700 to-rose-400',
                      tone === 'push' && 'border-slate-400/30 bg-slate-500',
                      tone === 'dnp' && 'border-slate-600 bg-[repeating-linear-gradient(45deg,#111827_0,#111827_5px,#475569_5px,#475569_7px)]',
                    )}
                    style={{ height: String(height) + '%' }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div
          className="mt-1 grid gap-[5px] px-1 text-center"
          style={{ gridTemplateColumns: 'repeat(' + rows.length + ', minmax(18px, 1fr))' }}
        >
          {rows.map((game, index) => (
            <span key={'label-' + (game.gameId || game.date || index)} className="min-w-0 overflow-hidden text-[7px] text-[#718198]">
              <b className="block truncate font-semibold text-[#93A2B8]">{shortDate(game.date)}</b>
              <span className="block truncate">{game.isHome === false ? '@' : 'vs'}{game.opponent || '—'}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function HistoryModel({
  group,
  selectedBook,
  line,
}: {
  group: PropGroup;
  selectedBook: CatalogBookRow | null;
  line: number;
}) {
  const [prediction, setPrediction] = React.useState<ModelPrediction | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [revision, setRevision] = React.useState(0);

  const modelQuotes = React.useMemo(() => {
    if (!selectedBook) return group.quotes;
    return group.quotes.filter((quote) => {
      const key = text(quote.sportsbookKey || quote.sportsbook).toLowerCase().replace(/[^a-z0-9]/g, '');
      return key === selectedBook.key.toLowerCase().replace(/[^a-z0-9]/g, '');
    });
  }, [group, selectedBook]);

  const modelGroup = React.useMemo(
    () => modelQuotes.length ? { ...group, quotes: modelQuotes } : group,
    [group, modelQuotes],
  );
  const targetQuote = selectedBook?.over || selectedBook?.under || group.bestOver || group.bestUnder || group.quotes[0] || null;
  const exactPostedLine = Math.abs(line - group.line) < 0.0001;

  React.useEffect(() => {
    if (!exactPostedLine) {
      setPrediction({
        available: false,
        code: 'TARGET_UNVERIFIED',
        message: 'The History Model is available only for a verified posted line.',
      });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetchHistoryModel(group, targetQuote, controller.signal)
      .then(setPrediction)
      .catch(() => setPrediction({ available: false, code: 'MODEL_FEED_UNAVAILABLE', message: 'History model is temporarily unavailable.' }))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [group.key, targetQuote?.sportsbookKey, targetQuote?.sportsbook, exactPostedLine, revision]);

  const selectedEv: ExpectedValueSelection | null = React.useMemo(
    () => exactPostedLine ? expectedValueFor(modelGroup, prediction || undefined) : null,
    [exactPostedLine, modelGroup, prediction],
  );
  const selectedEvSource = expectedValueSourceLabel(selectedEv);
  const available = prediction?.available === true;

  return (
    <div className="rounded-2xl border border-[#1E2D3D] bg-[#101925] p-2.5">
      <div className="text-[13px] font-black text-white">History model</div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="min-w-0"><div className="text-[8px] text-[#8494AA]">Projection</div><div className="mt-0.5 text-[17px] font-black leading-none text-white">{available ? metricValue(prediction?.projection) : 'Unavailable'}</div></div>
        <div className="min-w-0"><div className="text-[8px] text-[#8494AA]">Over</div><div className="mt-0.5 text-[17px] font-black leading-none text-white">{available ? probabilityLabel(prediction?.probabilityOver) : 'Unavailable'}</div></div>
        <div className="min-w-0"><div className="text-[8px] text-[#8494AA]">Under</div><div className="mt-0.5 text-[17px] font-black leading-none text-white">{available ? probabilityLabel(prediction?.probabilityUnder) : 'Unavailable'}</div></div>
        <div className="min-w-0"><div className="whitespace-nowrap text-[7px] text-[#8494AA]">Selected-quote EV</div><div className={cx('mt-0.5 whitespace-nowrap font-black leading-none text-white', selectedEv ? 'text-[17px]' : 'text-[12px] tracking-[-0.02em]')}>{selectedEv ? (selectedEv.ev >= 0 ? '+' : '') + selectedEv.ev.toFixed(1) + '%' : 'Unavailable'}</div></div>
      </div>
      <p className="mt-2 text-[8px] leading-[1.45] text-[#7E8FA5]">
        {loading
          ? 'Checking the verified history model…'
          : available
            ? 'Adaptive estimate from verified completed-game history' +
              (prediction?.validation?.observations ? ' · ' + prediction.validation.observations + ' rolling checks' : '') +
              (prediction?.modelVersion ? ' · ' + prediction.modelVersion : '') +
              (selectedEvSource ? ' · EV: ' + selectedEvSource : '') + '.'
            : (prediction?.message || 'History model is unavailable for this exact prop.')}
      </p>
      <button
        type="button"
        onClick={() => setRevision((value) => value + 1)}
        disabled={loading}
        className="mt-2 h-9 rounded-lg border border-[#2A3A4F] bg-[#0D1722] px-3 text-[10px] font-semibold text-white disabled:opacity-50"
      >
        {loading ? 'Refreshing…' : 'Refresh forecast'}
      </button>
    </div>
  );
}

export function PlayerPropResearchCard({
  group,
  markets,
  research,
  loading,
  state,
  onState,
  favourite,
  onFavourite,
  onMarket,
}: Props) {
  const [filters, setFilters] = React.useState<SampleFilters>(EMPTY_FILTERS);
  const [sample, setSample] = React.useState<SampleId>('l15');

  React.useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setSample('l15');
  }, [group.key]);

  const marketLabel = marketDisplayLabel(group.market, group.player, group.marketId, group.sport);
  const rawGames = research?.gameLog || [];
  const verifiedGames = React.useMemo(
    () => sortRecentFirst(rawGames.filter((game) => numberOf(game.value) !== null)),
    [rawGames],
  );
  const filteredAll = React.useMemo(() => applyFilters(rawGames, filters), [rawGames, filters]);
  const filteredGames = React.useMemo(
    () => sortRecentFirst(filteredAll.filter((game) => numberOf(game.value) !== null)),
    [filteredAll],
  );
  // Several boards post a prop with the two teams in the event but no explicit
  // opponent field. The opponent is still known in that case -- it is whichever
  // side of the matchup is not this player's team -- so derive it rather than
  // reporting "No opponent" and emptying the H2H split.
  const currentOpponent = React.useMemo(
    () => text(research?.matchup?.opponent || group.opponent) || currentOpponentLabels(group)[0] || null,
    [research?.matchup?.opponent, group],
  );
  const opponentOptions = React.useMemo(
    () => buildOpponentOptions(verifiedGames.map((game) => game.opponent), group, research?.leagueTeams || []),
    [verifiedGames, group, research?.leagueTeams],
  );
  const seasonOptions = React.useMemo(() => {
    const seasons = [...new Set(verifiedGames.map((game) => text(game.season)).filter(Boolean))].sort().reverse();
    return [{ value: 'all', label: 'All' }, ...seasons.map((season) => ({ value: season, label: season }))];
  }, [verifiedGames]);

  const categoryLabels = React.useMemo(() => {
    const map = new Map<string, PropGroup[]>();
    for (const candidate of markets) {
      const label = marketDisplayLabel(candidate.market, candidate.player, candidate.marketId, candidate.sport);
      const rows = map.get(label) || [];
      rows.push(candidate);
      map.set(label, rows);
    }
    return [...map.entries()].map(([label, rows]) => ({ label, rows }));
  }, [markets]);

  const periods = React.useMemo(() => {
    const rows = categoryLabels.find((entry) => entry.label === marketLabel)?.rows || [group];
    const map = new Map<string, PropGroup[]>();
    for (const candidate of rows) {
      const key = candidate.period || 'game';
      const list = map.get(key) || [];
      list.push(candidate);
      map.set(key, list);
    }
    return [...map.entries()].map(([period, rows]) => ({ period, rows }));
  }, [categoryLabels, marketLabel, group]);

  const postedLines = React.useMemo(() => {
    const rows = categoryLabels.find((entry) => entry.label === marketLabel)?.rows || [group];
    return [...new Set(rows
      .filter((candidate) => (candidate.period || 'game') === (group.period || 'game'))
      .map((candidate) => candidate.line))]
      .sort((a, b) => a - b);
  }, [categoryLabels, marketLabel, group]);

  const books = React.useMemo(() => catalogBookRows(group.quotes), [group.quotes]);
  const availableBooks = React.useMemo(() => books.filter((book) => book.available), [books]);
  const selectedBook = state.book ? books.find((book) => book.key === state.book) || null : null;
  const heroQuote = (state.side === 'UNDER'
    ? selectedBook?.under || group.bestUnder
    : selectedBook?.over || group.bestOver) || selectedBook?.over || selectedBook?.under || group.bestOver || group.bestUnder || group.quotes[0] || null;
  const over = selectedBook?.over || group.bestOver;
  const under = selectedBook?.under || group.bestUnder;
  const quoteAtResearchLine = Math.abs(state.line - group.line) < 0.0001;
  const modifier = quoteModifier(heroQuote);

  const h2h = React.useMemo(
    () => headToHead(filteredGames, currentOpponent, state.line, state.side),
    [filteredGames, currentOpponent, state.line, state.side],
  );
  const windows = React.useMemo(() => [
    computeWindow(filteredGames, state.line, state.side, 'l5', 'L5', 5),
    computeWindow(filteredGames, state.line, state.side, 'l10', 'L10', 10),
    computeWindow(filteredGames, state.line, state.side, 'l15', 'L15', 15),
    computeWindow(filteredGames, state.line, state.side, 'season', 'SEASON'),
    h2h || computeWindow([], state.line, state.side, 'h2h', 'H2H'),
  ], [filteredGames, h2h, state.line, state.side]);

  const chartGames = React.useMemo(() => {
    if (sample === 'h2h') {
      return currentOpponent
        ? filteredAll.filter((game) => sameTeamLabel(game.opponent, currentOpponent)).slice(0, 15)
        : [];
    }
    if (sample === 'season') return filteredAll.slice(0, 20);
    const count = sample === 'l5' ? 5 : sample === 'l10' ? 10 : 15;
    return filteredAll.slice(0, count);
  }, [filteredAll, currentOpponent, sample]);

  const support = React.useMemo(() => supportingMetrics(group, filteredGames), [group, filteredGames]);

  function chooseCategory(label: string) {
    const rows = categoryLabels.find((entry) => entry.label === label)?.rows || [];
    const next =
      rows.find((candidate) => (candidate.period || 'game') === (group.period || 'game') && candidate.line === group.line) ||
      rows.find((candidate) => (candidate.period || 'game') === (group.period || 'game')) ||
      rows[0];
    if (next) onMarket(next);
  }

  function choosePeriod(period: string) {
    const rows = periods.find((entry) => entry.period === period)?.rows || [];
    const next = rows.find((candidate) => candidate.line === group.line) || rows[0];
    if (next) onMarket(next);
  }

  function choosePostedLine(line: number) {
    const rows = categoryLabels.find((entry) => entry.label === marketLabel)?.rows || [];
    const next = rows.find((candidate) =>
      (candidate.period || 'game') === (group.period || 'game') &&
      candidate.line === line
    );
    if (next) onMarket(next);
  }

  function stepLine(direction: number) {
    const currentIndex = postedLines.findIndex((line) => Math.abs(line - state.line) < 0.0001);
    const nextIndex = currentIndex >= 0 ? currentIndex + direction : -1;
    if (nextIndex >= 0 && nextIndex < postedLines.length) {
      choosePostedLine(postedLines[nextIndex]);
      return;
    }
    const quarter = Math.abs(group.line * 4 - Math.round(group.line * 4)) < 0.001 &&
      Math.abs(group.line * 2 - Math.round(group.line * 2)) > 0.001;
    const step = quarter ? 0.25 : 0.5;
    onState({ ...state, line: Math.max(0, Math.round((state.line + direction * step) * 100) / 100) });
  }

  const kickoff = shortTime(group.startsAt);
  const teamLabel = text(group.team) || 'Team unavailable';
  const unavailableReason = !loading && research?.available === false
    ? research.message || 'Verified history is unavailable for this exact prop.'
    : null;

  return (
    <section
      className="mx-auto w-full max-w-[430px] text-white [font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif]"
      data-design="player-prop-research-card"
      data-release="verified-live-card-20260922-selected-ev-fix"
    >
      <div className="rounded-2xl border border-[#1E2D3D] bg-[#121C26] p-3.5 shadow-[0_12px_38px_rgba(0,0,0,0.22)]">
        <div className="flex items-start gap-3">
          <div className="relative h-[58px] w-[58px] shrink-0 rounded-full border-2 border-[#2D8CFF] bg-[#101927] p-[2px] shadow-[0_0_18px_rgba(45,140,255,0.55)]">
            <div className="h-full w-full overflow-hidden rounded-full bg-[#101927]">
              <PlayerAvatar name={group.player} sport={group.sport} team={group.team} providerPlayerId={group.providerPlayerId} size={54} className="!size-full" />
            </div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md border border-[#2C638E] bg-[#0B2840] px-2 py-0.5 text-[9px] font-black tracking-[0.08em] text-[#D6EBFF]">
              {group.sport}
            </div>
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[20px] font-black leading-none tracking-[-0.03em] text-white">{group.player}</h1>
              {group.position ? <span className="rounded-lg border border-[#25364A] bg-[#101827] px-2 py-1 text-[10px] font-bold text-[#B8C2D1]">{group.position}</span> : null}
            </div>
            <div className="mt-2 truncate text-[13px] font-medium tracking-[0.01em] text-[#A2B0C1]">
              {teamLabel}{kickoff ? ' · ' + kickoff : ''}{group.live ? ' · LIVE' : ''}
            </div>
          </div>
          <button
            type="button"
            aria-label={favourite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={favourite}
            onClick={onFavourite}
            className={cx(
              'grid h-11 w-11 shrink-0 place-items-center rounded-full border bg-[#0F1722]',
              favourite ? 'border-[#1A7656] text-[#34E89B]' : 'border-[#2A3A50] text-[#91A0B5]',
            )}
          >
            <Star className="h-5 w-5" strokeWidth={1.8} fill={favourite ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[#174B67] bg-[linear-gradient(110deg,#0C2534_0%,#0D1E29_55%,#0D2025_100%)] px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-[#2B8BFF] px-2.5 py-2 text-[10px] font-black text-white shadow-[0_0_18px_rgba(43,139,255,0.24)]">
              {bookInitials(quoteBook(heroQuote))}
            </div>
            <div className="max-w-[76px] text-[10px] font-black leading-4 text-white">{marketLabel}</div>
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            {modifier ? <span className="shrink-0 rounded-full border border-[#0D6045] bg-[#0A2C24] px-2 py-1 text-[9px] font-black tracking-[0.04em] text-[#40E5A1]">{modifier}</span> : null}
            <label className="relative flex min-w-0 items-center gap-1 rounded-full border border-[#243448] bg-[#0C1521] px-3 py-2 text-[10px] font-semibold text-white">
              <span className="truncate">{selectedBook ? selectedBook.name : 'Best prices · all books'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#7D8EA5]" />
              <select
                aria-label="Sportsbook"
                value={state.book || 'all'}
                onChange={(event) => onState({ ...state, book: event.target.value === 'all' ? null : event.target.value })}
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
              >
                <option value="all">Best prices · all books</option>
                {availableBooks.map((book) => <option key={book.key} value={book.key}>{book.name}</option>)}
              </select>
            </label>
          </div>
          <div className="text-right">
            <div className="text-[9px] font-semibold uppercase tracking-[.04em] text-[#7E8FA5]">Posted</div>
            <div className="text-[16px] font-black leading-none text-[#35EF86]">{group.line}</div>
            <div className="mt-1 text-[9px] font-bold text-[#929CB0]">{heroQuote ? state.side + ' ' + odds(heroQuote.price) : 'Price unavailable'}</div>
          </div>
        </div>
      </div>

      <div className="mt-2.5 space-y-2.5">
        <section className="space-y-2.5">
          <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categoryLabels.map((entry) => (
              <MarketPill key={entry.label} active={entry.label === marketLabel} onClick={() => chooseCategory(entry.label)}>
                {entry.label.toUpperCase()}
              </MarketPill>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {periods.map((entry) => (
              <button
                key={entry.period}
                type="button"
                aria-pressed={(group.period || 'game') === entry.period}
                onClick={() => choosePeriod(entry.period)}
                className={cx(
                  'h-10 shrink-0 rounded-full border px-5 text-[11px] font-extrabold',
                  (group.period || 'game') === entry.period
                    ? 'border-[#2492F7] bg-[#188DFF] text-white shadow-[0_0_20px_rgba(24,141,255,0.2)]'
                    : 'border-[#263548] bg-[#0F1722] text-[#73829A]',
                )}
              >
                {periodLabel(entry.period)}
              </button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SelectPill label="Opponent" value={filters.opponent} options={opponentOptions} onChange={(opponent) => setFilters((previous) => ({ ...previous, opponent }))} />
            <SelectPill label="Season" value={filters.season} options={seasonOptions} onChange={(season) => setFilters((previous) => ({ ...previous, season }))} />
            <SelectPill
              label="Home/Away"
              value={filters.venue}
              options={[{ value: 'all', label: 'All' }, { value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]}
              onChange={(venue) => setFilters((previous) => ({ ...previous, venue: venue as SampleFilters['venue'] }))}
            />
            <span className="flex h-10 shrink-0 items-center rounded-full border border-[#2B3A50] bg-[#111927] px-4 text-[11px] font-medium text-[#93A2B8]">
              Team: <b className="ml-1 font-semibold text-[#C6D0DE]">{teamLabel}</b>
            </span>
          </div>
          <div className="px-0.5 pt-0.5 text-[12px] font-bold text-white">
            {loading ? 'Loading verified history…' : filteredGames.length + ' of ' + verifiedGames.length + ' verified ' + (verifiedGames.length === 1 ? 'game' : 'games')}
          </div>
          {unavailableReason ? <p className="px-0.5 text-[10px] leading-4 text-[#FF9AAF]">{unavailableReason}</p> : null}
        </section>

        <section className="rounded-2xl border border-[#1E2D3D] bg-[#101925] p-2.5">
          <div className="flex items-center justify-between px-1.5 pb-2">
            <div className="text-[10px] font-black tracking-[0.18em] text-[#91A0B5]">TARGET LINE</div>
            <span className="rounded-full border border-[#27364A] bg-[#0D1621] px-3 py-1.5 text-[9px] font-semibold text-[#A9B5C5]">
              {quoteAtResearchLine ? 'Outcome as posted' : 'Research line'}
            </span>
          </div>
          <div className="grid grid-cols-[44px_1fr_44px] overflow-hidden rounded-xl border border-[#2A3B51] bg-[#0A121C]">
            <button type="button" aria-label="Lower target line" onClick={() => stepLine(-1)} className="grid h-[52px] place-items-center border-r border-[#233246] text-[#95A5BB]"><Minus className="h-4 w-4" /></button>
            <div className="grid h-[52px] place-items-center text-[25px] font-black tracking-[-0.03em] text-white">{state.line}</div>
            <button type="button" aria-label="Raise target line" onClick={() => stepLine(1)} className="grid h-[52px] place-items-center border-l border-[#233246] text-[#95A5BB]"><Plus className="h-5 w-5" /></button>
          </div>
          <div className="mt-1.5 flex items-center justify-between rounded-xl bg-[#0C141E] px-3 py-2 text-[11px]">
            <span className="max-w-[190px] truncate font-bold text-[#E1E7EF]">{selectedBook ? selectedBook.name : 'Best available prices'}</span>
            <div className="flex items-center gap-4 font-black">
              <button type="button" aria-pressed={state.side === 'OVER'} onClick={() => onState({ ...state, side: 'OVER' })} className={state.side === 'OVER' ? 'text-[#23E787]' : 'text-[#7E8FA5]'}>O {quoteAtResearchLine && over ? odds(over.price) : 'Unavailable'}</button>
              <button type="button" aria-pressed={state.side === 'UNDER'} onClick={() => onState({ ...state, side: 'UNDER' })} className={state.side === 'UNDER' ? 'text-[#FF5C88]' : 'text-[#7E8FA5]'}>U {quoteAtResearchLine && under ? odds(under.price) : 'Unavailable'}</button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-5 overflow-hidden rounded-2xl border border-[#213147] bg-[#101925]">
          {windows.map((item) => {
            const active = sample === item.id;
            const helper = item.id === 'h2h'
              ? currentOpponent ? 'vs ' + currentOpponent : 'No opponent'
              : item.games ? item.games + ' games' : 'Unavailable';
            return (
              <button
                type="button"
                key={item.id}
                aria-pressed={active}
                onClick={() => setSample(item.id as SampleId)}
                className={cx(
                  'min-h-[94px] border-r border-[#213147] px-1 py-3 text-center last:border-r-0',
                  active && 'bg-[#0B2B3F]',
                )}
              >
                <div className="text-[8px] font-bold tracking-[0.04em] text-[#8090A6]">{item.label}</div>
                <div className="mt-1 min-h-[12px] truncate text-[7px] text-[#6D7E94]">{helper}</div>
                <div className={cx('mt-2 text-[17px] font-black', item.hitRate === null ? 'text-white' : 'text-[#20E787]')}>{rateLabel(item.hitRate)}</div>
                <div className="mt-1 text-[8px] text-[#7D8EA5]">{item.average === null ? 'Avg unavailable' : 'Avg ' + item.average}</div>
              </button>
            );
          })}
        </section>

        {loading ? (
          <div className="h-[250px] animate-pulse rounded-2xl border border-[#1E2D3D] bg-[#0E1823]" />
        ) : (
          <HistoryChart games={chartGames} line={state.line} market={marketLabel} period={periodLabel(group.period)} />
        )}

        <section className="grid grid-cols-[1.08fr_.92fr] gap-2.5">
          <div className="rounded-2xl border border-[#1E2D3D] bg-[#101925] p-2.5">
            <div className="px-1 text-[9px] font-black tracking-[0.2em] text-[#8392A8]">SUPPORTING STATS</div>
            <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-xl border border-[#223147]">
              {support.map((item, index) => (
                <div
                  key={item.label}
                  className={cx(
                    'min-h-[58px] p-2',
                    index % 3 !== 2 && 'border-r border-[#223147]',
                    index < 3 && 'border-b border-[#223147]',
                  )}
                  title={item.sample ? item.sample + ' verified games reported' : 'Unavailable'}
                >
                  <div className="truncate text-[7px] font-black tracking-[0.02em] text-[#8797AD]">{item.label}</div>
                  <div className="mt-2 truncate text-[14px] font-black leading-none text-white">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
          <HistoryModel group={group} selectedBook={selectedBook} line={state.line} />
        </section>

        <details className="group rounded-2xl border border-[#1E2D3D] bg-[#101925]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-[13px] font-black text-white [&::-webkit-details-marker]:hidden">
            <span>Sportsbook Prices</span>
            <span className="rounded-full border border-[#0F5B44] bg-[#08271F] px-3 py-1 text-[9px] font-black text-[#23E787]">
              {availableBooks.length} {availableBooks.length === 1 ? 'BOOK' : 'BOOKS'}
            </span>
          </summary>
          <div className="border-t border-[#1E2D3D] px-3 pb-3 pt-2">
            {availableBooks.length ? (
              <div className="grid gap-1.5">
                {availableBooks.map((book) => (
                  <button
                    key={book.key}
                    type="button"
                    onClick={() => onState({ ...state, book: book.key })}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-[#223147] bg-[#0C141E] px-2.5 py-2 text-left text-[10px]"
                  >
                    <span className="truncate font-bold text-[#DCE5EF]">{book.name}</span>
                    <span className="font-black text-[#23E787]">O {book.over ? odds(book.over.price) : 'Unavailable'}</span>
                    <span className="font-black text-[#FF5C88]">U {book.under ? odds(book.under.price) : 'Unavailable'}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10px] leading-4 text-[#7E8FA5]">No verified sportsbook price is available for this exact line.</p>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

export default PlayerPropResearchCard;
