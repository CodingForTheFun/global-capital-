'use client';

import * as React from 'react';
import { BarChart3, BookOpen, CalendarDays, ChevronDown, ChevronRight, Flame, History, Minus, Plus, RotateCcw, Shield, SlidersHorizontal, Star, Target, TrendingUp, Users } from 'lucide-react';
import type { DefensePositionResponse, DefenseTier, GameLogRow, MoneylineResponse, TennisContextResponse, LineHistoryPoint, PropGroup, PropRow, ResearchResponse, Side } from '@/lib/types';
import {
  applyFilters,
  computeWindow,
  headToHead,
  sortRecentFirst,
  type SampleFilters,
  advancedFilterCount,
  EMPTY_FILTERS,
  filterCoverage,
  upcomingRest,
} from '@/lib/analytics';
import { buildOpponentOptions, currentOpponentLabels, sameTeamLabel } from '@/lib/opponent-options';
import { bookInfo } from '../../../lib/constants/books.mjs';
import { catalogBookRows, type CatalogBookRow } from '@/lib/book-catalog';
import { expectedValueFor, expectedValueSourceLabel, type ExpectedValueSelection } from '@/lib/expected-value.mjs';
import { PlayerAvatar } from '@/components/face-card';
import { GameContext } from '@/components/game-context';
import { OpponentField } from '@/components/opponent-field';
import { fetchDefensePosition, fetchLineHistory, fetchMoneyline, fetchTennisContext } from '@/lib/api';
import { DEFENSE_SPORTS, defenseMetricFor, defenseReading, exactPosition, metricLabel, ordinal } from '@/lib/defense';
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

const text = (value: unknown) => String(value ?? '').trim();
const DEFENSE_TIER_LABEL: Record<DefenseTier, string> = { soft: 'Soft', average: 'Average', tough: 'Tough' };

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

function normalizeBookKey(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A quote's price as the card should print it. DFS pick'em lines (PrizePicks,
 * Underdog...) carry no American odds and arrive with price 0; printing that as
 * "0" reads like a real price. The book catalog already refuses 0 as a price, so
 * this keeps the header and price rows consistent with it.
 */
function quotePrice(row: PropRow | null | undefined) {
  if (!row) return 'Unavailable';
  const price = Number(row.price);
  if (Number.isFinite(price) && price !== 0) return odds(price);
  return bookInfo(row.sportsbookKey || row.sportsbook).type === 'dfs' ? "Pick'em" : '—';
}

function americanImpliedProbability(value: unknown) {
  const price = numberOf(value);
  if (price === null || price === 0) return null;
  const probability = price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
  return probability * 100;
}

/** "9/14": short enough to fit under every bar of a 15-game chart. */
function numericDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.getMonth() + 1 + '/' + date.getDate();
}

/**
 * The opponent as a team abbreviation, resolved through the verified league
 * directory when the game log carries a full name. Never invents one: a label
 * with no single directory match is returned as-is and the cell truncates it.
 */
function teamShort(label: unknown, leagueTeams: NonNullable<ResearchResponse['leagueTeams']>) {
  const value = text(label);
  if (!value || value.length <= 4) return value.toUpperCase();
  // Only an unambiguous match is shortened: "Los Angeles" fits both LAL and
  // LAC, and picking either would put a wrong team under the bar.
  const matches = leagueTeams.filter((team) => sameTeamLabel(team?.name, value) || sameTeamLabel(team?.abbreviation, value));
  return matches.length === 1 ? text(matches[0]?.abbreviation) || value : value;
}

/**
 * A person's opponent (tennis) as a three-letter surname code, the way score
 * graphics show it. Display only: the full verified name stays in the tooltip
 * and in every filter and head-to-head comparison.
 */
function personShort(label: unknown) {
  const parts = text(label).split(/\s+/).filter(Boolean);
  const surname = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
  return surname.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

function surname(label: unknown) {
  const parts = text(label).split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
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
  // The per-sport list is position-blind, so a running back is offered passing
  // stats his game log never reports. A tile with no verified games says
  // nothing, so it is left out rather than shown as "Unavailable".
  return output.filter((metric) => metric.sample > 0).slice(0, 6);
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
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_20px_rgb(88_80_236/.22)]'
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

function FilterSelect({
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
  const active = value !== 'all';
  return (
    <label className="grid min-w-0 gap-1">
      <span className="truncate text-[9px] font-bold text-[#7E97B0]">{label}</span>
      <span className={cx(
        'relative flex h-10 items-center rounded-lg border bg-[#0B1826] px-3 pr-8 text-[11px] font-semibold',
        active ? 'border-[#0A8EE8] text-white' : 'border-[#244868] text-[#C6D0DE]',
      )}>
        <span className="truncate">{options.find((option) => option.value === value)?.label || 'Any'}</span>
        <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#7E97B0]" aria-hidden />
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </span>
    </label>
  );
}

function HistoryChart({
  games,
  line,
  market,
  period,
  leagueTeams = [],
  individual = false,
}: {
  games: GameLogRow[];
  line: number;
  market: string;
  period: string;
  leagueTeams?: NonNullable<ResearchResponse['leagueTeams']>;
  individual?: boolean;
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
    <section data-qa="history-chart" className="rounded-2xl border border-[#1E2D3D] bg-[#0E1823] p-3">
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
                    data-qa="chart-bar"
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
              <b className="block truncate font-semibold text-[#93A2B8]">{numericDate(game.date)}</b>
              <span className="block truncate">{individual ? personShort(game.opponent) || '—' : (game.isHome === false ? '@' : '') + (teamShort(game.opponent, leagueTeams) || '—')}</span>
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
  const projectionValue = available ? numberOf(prediction?.projection) : null;
  const projectionDelta = projectionValue === null ? null : projectionValue - line;
  const validationRmse = numberOf(prediction?.validation?.rmse);
  const baselineRmse = numberOf(prediction?.validation?.baselineRmse);
  const validationChecks = numberOf(prediction?.validation?.observations);
  const modelSample = numberOf(prediction?.sampleSize);

  return (
    <div className="rounded-2xl border border-[#1E2D3D] bg-[#101925] p-2.5">
      <div className="text-[13px] font-black text-white">History model</div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="min-w-0"><div className="text-[8px] text-[#8494AA]">Projection</div><div className="mt-0.5 text-[17px] font-black leading-none text-white">{available ? metricValue(prediction?.projection) : <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>}</div></div>
        <div className="min-w-0"><div className="text-[8px] text-[#8494AA]">Over</div><div className="mt-0.5 text-[17px] font-black leading-none text-white">{available ? probabilityLabel(prediction?.probabilityOver) : <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>}</div></div>
        <div className="min-w-0"><div className="text-[8px] text-[#8494AA]">Under</div><div className="mt-0.5 text-[17px] font-black leading-none text-white">{available ? probabilityLabel(prediction?.probabilityUnder) : <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>}</div></div>
        <div className="min-w-0"><div className="whitespace-nowrap text-[7px] text-[#8494AA]">Selected-quote EV</div><div className="mt-0.5 whitespace-nowrap text-[17px] font-black leading-none text-white">{selectedEv ? (selectedEv.ev >= 0 ? '+' : '') + selectedEv.ev.toFixed(1) + '%' : <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>}</div></div>
      </div>
      <div data-qa="history-model-evidence" className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-[#223247] bg-[#0B1420]">
        <div className="min-w-0 px-2 py-2">
          <div className="text-[7px] font-bold uppercase tracking-[.03em] text-[#71849B]">Proj vs line</div>
          <div className="mt-0.5 truncate text-[11px] font-black text-white">
            {projectionDelta === null ? '—' : (projectionDelta > 0 ? '+' : '') + projectionDelta.toFixed(1)}
          </div>
        </div>
        <div className="min-w-0 border-l border-[#223247] px-2 py-2">
          <div className="text-[7px] font-bold uppercase tracking-[.03em] text-[#71849B]">Model sample</div>
          <div className="mt-0.5 truncate text-[11px] font-black text-white">
            {modelSample === null ? '—' : Math.round(modelSample) + ' games'}
          </div>
        </div>
        <div className="min-w-0 border-l border-[#223247] px-2 py-2">
          <div className="text-[7px] font-bold uppercase tracking-[.03em] text-[#71849B]">Validation</div>
          <div className="mt-0.5 truncate text-[11px] font-black text-white">
            {validationRmse === null ? '—' : 'RMSE ' + validationRmse.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[7px] leading-3 text-[#657A91]">
        <span>{validationChecks === null ? 'Rolling checks unavailable' : Math.round(validationChecks) + ' rolling checks'}</span>
        <span>{baselineRmse === null ? 'Baseline error unavailable' : 'Baseline RMSE ' + baselineRmse.toFixed(2)}</span>
        <span>{prediction?.modelVersion ? 'Version ' + prediction.modelVersion : 'Version unavailable'}</span>
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
  const [showMoreFilters, setShowMoreFilters] = React.useState(false);
  const [sample, setSample] = React.useState<SampleId>('l10');
  const [lineHistory, setLineHistory] = React.useState<LineHistoryPoint[]>([]);

  React.useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setSample('l10');
  }, [group.key]);

  React.useEffect(() => {
    if (!group.propId) {
      setLineHistory([]);
      return;
    }
    const controller = new AbortController();
    fetchLineHistory(group.propId, controller.signal)
      .then(setLineHistory)
      .catch(() => {
        if (!controller.signal.aborted) setLineHistory([]);
      });
    return () => controller.abort();
  }, [group.propId]);

  const marketLabel = marketDisplayLabel(group.market, group.player, group.marketId, group.sport);
  const sourceGames = research?.gameLog;
  const sportKey = text(group.sport).toUpperCase();
  const individualSport = /^(tennis|atp|wta|itf)$/i.test(sportKey);
  const defenseMetric = React.useMemo(() => defenseMetricFor(sportKey, group.marketId, group.market), [sportKey, group.marketId, group.market]);
  const defensePosition = exactPosition(
    sportKey,
    research?.context?.sportradar?.primaryPosition,
    group.position,
    research?.context?.sportradar?.position,
  );
  const [defense, setDefense] = React.useState<DefensePositionResponse | null>(null);
  React.useEffect(() => {
    if (!DEFENSE_SPORTS.has(sportKey) || !defenseMetric) {
      setDefense(null);
      return;
    }
    const controller = new AbortController();
    fetchDefensePosition(sportKey, controller.signal)
      .then(setDefense)
      .catch(() => {
        if (!controller.signal.aborted) setDefense(null);
      });
    return () => controller.abort();
  }, [sportKey, defenseMetric]);
  // Closing moneylines are read only after the filter panel is opened, and
  // only for the latest 15 named matches: each close is a provider read.
  const [moneyline, setMoneyline] = React.useState<MoneylineResponse | null>(null);
  const [moneylineLoading, setMoneylineLoading] = React.useState(false);
  const moneylineRequested = React.useRef<string | null>(null);
  React.useEffect(() => {
    setMoneyline(null);
    moneylineRequested.current = null;
  }, [group.key]);
  React.useEffect(() => {
    if (!individualSport || !showMoreFilters || !sourceGames?.length) return;
    const events = [...sourceGames]
      .filter((game) => text(game.gameId) && text(game.opponent) && numberOf(game.value) !== null)
      .sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0))
      .slice(0, 15)
      .map((game) => ({ id: text(game.gameId), opponent: text(game.opponent) }));
    const requestKey = group.key + '|' + events.map((event) => event.id).join(',');
    if (!events.length || moneylineRequested.current === requestKey) return;
    moneylineRequested.current = requestKey;
    const controller = new AbortController();
    setMoneylineLoading(true);
    fetchMoneyline(sportKey, group.player, events, controller.signal)
      .then(setMoneyline)
      .catch(() => {
        if (!controller.signal.aborted) moneylineRequested.current = null;
      })
      .finally(() => {
        if (!controller.signal.aborted) setMoneylineLoading(false);
      });
    return () => {
      controller.abort();
      if (moneylineRequested.current === requestKey) moneylineRequested.current = null;
      setMoneylineLoading(false);
    };
  }, [individualSport, showMoreFilters, sourceGames, group.key, group.player, sportKey]);

  // Tennis context: today's opponent ranking/hand on load; hands and surfaces
  // for past matches only once the filter panel asks for them.
  const upcomingOpponent = text(research?.matchup?.opponent || group.opponent) || currentOpponentLabels(group)[0] || null;
  const [tennis, setTennis] = React.useState<TennisContextResponse | null>(null);
  const [tennisRetry, setTennisRetry] = React.useState(0);
  const tennisRequested = React.useRef<string | null>(null);
  const tennisFilled = React.useRef(false);
  React.useEffect(() => {
    setTennis(null);
    setTennisRetry(0);
    tennisRequested.current = null;
    tennisFilled.current = false;
  }, [group.key]);
  React.useEffect(() => {
    if (!individualSport || !sourceGames) return;
    const fill = showMoreFilters;
    if (!fill && tennisFilled.current) return;
    const matches = [...sourceGames]
      .filter((game) => text(game.gameId) && text(game.opponent) && text(game.date) && numberOf(game.value) !== null)
      .sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0))
      .slice(0, 20)
      .map((game) => ({ id: text(game.gameId), date: text(game.date), opponent: text(game.opponent) }));
    const requestKey = [group.key, fill ? 'fill' : 'light', tennisRetry, upcomingOpponent || '', matches.map((match) => match.id).join(',')].join('|');
    if (tennisRequested.current === requestKey) return;
    tennisRequested.current = requestKey;
    const controller = new AbortController();
    let retryTimer: number | undefined;
    fetchTennisContext(group.player, upcomingOpponent, matches, fill, controller.signal)
      .then((value) => {
        setTennis(value);
        if (fill) tennisFilled.current = true;
        // The server fills a few answers per call; ask again for the rest.
        if (fill && value.available && value.complete === false && tennisRetry < 2) {
          retryTimer = window.setTimeout(() => setTennisRetry((count) => count + 1), 12_000);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) tennisRequested.current = null;
      });
    return () => {
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (tennisRequested.current === requestKey) tennisRequested.current = null;
    };
  }, [individualSport, sourceGames, showMoreFilters, tennisRetry, group.key, group.player, upcomingOpponent]);

  // Each past game is tagged from separate verified sources before any filter
  // runs; a tag stays null when its source cannot answer for that game.
  const rawGames = React.useMemo(
    () => (sourceGames || []).map((game) => {
      const close = moneyline?.events?.[text(game.gameId)];
      const match = tennis?.matches?.[text(game.gameId)];
      return {
        ...game,
        opponentDefenseTier: defenseReading(defense, game.opponent, defensePosition, defenseMetric)?.tier ?? null,
        winProbability: close?.available && Number.isFinite(Number(close.winProbability)) ? Number(close.winProbability) : null,
        opponentRank: Number.isInteger(match?.opponentRank) ? match?.opponentRank ?? null : null,
        opponentHand: match?.opponentHand === 'L' || match?.opponentHand === 'R' ? match.opponentHand : null,
        surface: match?.surface || null,
        indoor: typeof match?.indoor === 'boolean' ? match.indoor : null,
      };
    }),
    [sourceGames, defense, defensePosition, defenseMetric, moneyline, tennis],
  );
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
  const currentDefense = defenseReading(defense, currentOpponent, defensePosition, defenseMetric);
  const opponentOptions = React.useMemo(
    () => buildOpponentOptions(verifiedGames.map((game) => game.opponent), group, research?.leagueTeams || []),
    [verifiedGames, group, research?.leagueTeams],
  );
  const coverage = React.useMemo(() => filterCoverage(rawGames), [rawGames]);
  const restUpcoming = React.useMemo(() => upcomingRest(rawGames, group.startsAt), [rawGames, group.startsAt]);
  const minuteOptions = React.useMemo(() => {
    const played = verifiedGames.map((game) => numberOf(game.minutes)).filter((value): value is number => value !== null && value > 0);
    // Offer only thresholds that actually split this sample.
    const steps = [10, 15, 20, 25, 30, 35, 40].filter((step) => played.some((value) => value < step) && played.some((value) => value >= step));
    return [{ value: 'all', label: 'Any' }, ...steps.map((step) => ({ value: String(step), label: step + '+ min' }))];
  }, [verifiedGames]);
  const advancedCount = advancedFilterCount(filters);
  const setsOptions = React.useMemo(() => {
    const counts = [...new Set(verifiedGames.map((game) => numberOf(game.setsPlayed)).filter((value): value is number => value !== null))].sort((a, b) => a - b);
    return [{ value: 'all', label: 'Any' }, ...counts.map((count) => ({ value: String(count), label: count + ' sets' }))];
  }, [verifiedGames]);
  const anyAdvanced = coverage.result || coverage.role || coverage.seasonType || coverage.rest || minuteOptions.length > 1
    || coverage.setsPlayed || coverage.matchFormat || coverage.defenseTier || coverage.winProb
    || coverage.opponentRank || coverage.opponentHand || coverage.surface;
  const surfaceOptions = React.useMemo(() => {
    const seen = [...new Set(rawGames.map((game) => game.surface).filter(Boolean))] as string[];
    return [{ value: 'all', label: 'Any' }, ...['Hard', 'Clay', 'Grass', 'Carpet'].filter((value) => seen.includes(value)).map((value) => ({ value, label: value }))];
  }, [rawGames]);
  const upcoming = individualSport ? tennis?.upcoming || null : null;
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
  const bestOverPrice = React.useMemo(() => {
    const values = availableBooks.map((book) => numberOf(book.over?.price)).filter((value): value is number => value !== null && value !== 0);
    return values.length ? Math.max(...values) : null;
  }, [availableBooks]);
  const bestUnderPrice = React.useMemo(() => {
    const values = availableBooks.map((book) => numberOf(book.under?.price)).filter((value): value is number => value !== null && value !== 0);
    return values.length ? Math.max(...values) : null;
  }, [availableBooks]);
  const bestOverBook = bestOverPrice === null ? null : availableBooks.find((book) => numberOf(book.over?.price) === bestOverPrice) || null;
  const bestUnderBook = bestUnderPrice === null ? null : availableBooks.find((book) => numberOf(book.under?.price) === bestUnderPrice) || null;
  const selectedBook = state.book ? books.find((book) => book.key === state.book) || null : null;
  const heroQuote = (state.side === 'UNDER'
    ? selectedBook?.under || group.bestUnder
    : selectedBook?.over || group.bestOver) || selectedBook?.over || selectedBook?.under || group.bestOver || group.bestUnder || group.quotes[0] || null;
  const over = selectedBook?.over || group.bestOver;
  const under = selectedBook?.under || group.bestUnder;
  const quoteAtResearchLine = Math.abs(state.line - group.line) < 0.0001;
  // A pick'em line has no price on either side, so the price row says so once.
  const pickemLine = quoteAtResearchLine && [over, under].some(Boolean)
    && [over, under].every((quote) => !quote || quotePrice(quote) === "Pick'em");
  const dfsSource = group.quotes
    .map((quote) => bookInfo(quote.sportsbookKey || quote.sportsbook))
    .find((info) => info.type === 'dfs')?.name || null;
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
  const quickWindows = React.useMemo(
    () => windows.filter((item) => item.id === 'l5' || item.id === 'l10' || item.id === 'l15' || item.id === 'h2h'),
    [windows],
  );
  const movementRows = React.useMemo(
    () => lineHistory
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(text(a.recordedAt || a.capturedAt)) || 0;
        const bTime = Date.parse(text(b.recordedAt || b.capturedAt)) || 0;
        return bTime - aTime;
      })
      .slice(0, 4),
    [lineHistory],
  );
  const recentHistory = filteredGames.slice(0, 4);
  const advancedRows = React.useMemo(() => {
    const all = computeWindow(filteredGames, state.line, state.side, 'advanced-all', 'All');
    const home = computeWindow(filteredGames.filter((game) => game.isHome === true), state.line, state.side, 'advanced-home', 'Home');
    const away = computeWindow(filteredGames.filter((game) => game.isHome === false), state.line, state.side, 'advanced-away', 'Away');
    const versus = h2h || computeWindow([], state.line, state.side, 'advanced-h2h', 'H2H');
    return [all, home, away, versus];
  }, [filteredGames, h2h, state.line, state.side]);

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
  const recentWindow = windows.find((item) => item.id === 'l10') || null;
  const researchBookKey = normalizeBookKey(selectedBook?.key || heroQuote?.sportsbookKey || heroQuote?.sportsbook);
  const researchLineMove = React.useMemo(() => {
    if (!researchBookKey) return null;
    const rows = lineHistory
      .filter((point) => {
        const line = numberOf(point.line);
        const side = text(point.side).toUpperCase();
        return line !== null && side === state.side && normalizeBookKey(point.bookmakerKey) === researchBookKey;
      })
      .sort((a, b) => {
        const aTime = Date.parse(text(a.recordedAt || a.capturedAt)) || 0;
        const bTime = Date.parse(text(b.recordedAt || b.capturedAt)) || 0;
        return aTime - bTime;
      });
    if (rows.length < 2) return null;
    const first = rows[0];
    const latest = rows[rows.length - 1];
    const from = numberOf(first.line);
    const to = numberOf(latest.line);
    if (from === null || to === null) return null;
    const bookmakerKey = text(latest.bookmakerKey);
    return {
      from,
      to,
      book: bookInfo(bookmakerKey).name || bookmakerKey || 'Selected book',
      capturedAt: text(latest.recordedAt || latest.capturedAt),
    };
  }, [lineHistory, researchBookKey, state.side]);

  return (
    <section
      className="mx-auto w-full max-w-[900px] text-white [font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif]"
      data-design="player-prop-research-card"
      data-release="oblige-paid-ready-research-v5-20260924"
    >
      <div className="overflow-hidden rounded-[18px] border border-[#0879E8] bg-[radial-gradient(circle_at_28%_0%,rgba(18,71,181,.42),transparent_42%),linear-gradient(180deg,#071428_0%,#07111F_100%)] shadow-[0_0_26px_rgba(0,126,255,.23),0_18px_55px_rgba(0,0,0,.35)]">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_210px]">
          <div className="relative h-[72px] w-[72px] shrink-0 rounded-full border-2 border-[#0EA5FF] bg-[#0B1B2E] p-[2px] shadow-[0_0_22px_rgba(0,153,255,.55)]">
            <div className="h-full w-full overflow-hidden rounded-full">
              <PlayerAvatar name={group.player} sport={group.sport} team={group.team} providerPlayerId={group.providerPlayerId} size={68} className="!size-full" />
            </div>
            <span className="absolute -bottom-1 -right-1 rounded-md border border-[#19639E] bg-[#07111F] px-1.5 py-0.5 text-[7px] font-black tracking-[.08em] text-[#7DD3FC]">
              {group.sport}
            </span>
          </div>

          <div className="min-w-0 pt-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-[20px] font-black leading-none tracking-[-.025em] text-white sm:text-[24px]">{group.player}</h1>
              {group.position ? <span className="rounded-md border border-[#254867] bg-[#0A1A2B] px-2 py-1 text-[9px] font-extrabold text-[#A9C2DE]">{group.position}</span> : null}
            </div>
            <div className="mt-2 truncate text-[11px] font-semibold text-[#A7B9CF]">
              {teamLabel}{currentOpponent ? ' · vs ' + currentOpponent : ''}{kickoff ? ' · ' + kickoff : ''}{group.live ? ' · LIVE' : ''}
            </div>
            <div className="mt-1 truncate text-[9px] text-[#6F8AA7]">
              {group.matchup || 'Matchup unavailable'}
            </div>
          </div>

          <div className="col-span-2 rounded-xl border border-[#164B78] bg-[#06101D]/90 px-3 py-2.5 sm:col-span-1">
            <div className="text-[11px] font-black tracking-[.02em] text-[#42B8FF]">{group.sport}</div>
            <div className="mt-1 truncate text-[10px] font-semibold text-[#B7C8DB]">{group.matchup || 'Event details unavailable'}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-md border border-[#2B4563] bg-[#102039] px-2 py-1 text-[8px] font-black text-[#C7D6E7]">{periodLabel(group.period)}</span>
              <span className={cx('rounded-md border px-2 py-1 text-[8px] font-black', group.live ? 'border-[#0E6045] bg-[#082A21] text-[#31E59A]' : 'border-[#2B4563] bg-[#102039] text-[#8FA7C0]')}>
                {group.live ? 'LIVE' : 'PRE-GAME'}
              </span>
            </div>
          </div>
        </div>

        <div className="mx-3 mb-3 grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center overflow-hidden rounded-xl border border-[#0D5E9E] bg-[linear-gradient(100deg,#071A2F_0%,#061425_60%,#06101B_100%)] shadow-[inset_0_0_20px_rgba(0,115,255,.08)]">
          <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            <Target className="h-5 w-5 shrink-0 text-[#1AA7FF]" aria-hidden="true" />
            <div className="min-w-0">
              <div className="truncate text-[11px] font-black text-[#EDF6FF]">{marketLabel} O/U {group.line}</div>
              <div className="mt-1 flex items-center gap-3 text-[10px] font-black">
                <span className="rounded-md border border-[#6A5A16] bg-[#241E08] px-1.5 py-0.5 text-[#FACC15]">{bookInitials(selectedBook ? selectedBook.name : quoteBook(heroQuote))}</span>
                <span className="text-[#23E787]">O {over ? quotePrice(over) : 'Unavailable'}</span>
                <span className="text-[#FF6B7D]">U {under ? quotePrice(under) : 'Unavailable'}</span>
              </div>
            </div>
          </div>
          <label className="relative mr-2 flex h-10 max-w-[150px] items-center gap-1 rounded-lg border border-[#0B6FC5] bg-[#0B2B4A] px-3 text-[9px] font-black text-white shadow-[0_0_18px_rgba(0,122,255,.16)]">
            <span className="truncate">{selectedBook ? selectedBook.name : 'Best prices'}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#72C7FF]" />
            <select
              aria-label="Sportsbook"
              value={state.book || 'all'}
              onChange={(event) => onState({ ...state, book: event.target.value === 'all' ? null : event.target.value })}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
            >
              <option value="all">Best prices</option>
              {availableBooks.map((book) => <option key={book.key} value={book.key}>{book.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1.25fr_.75fr]">
        <section
          data-qa="research-snapshot"
          className="overflow-hidden rounded-2xl border border-[#153D5F] bg-[linear-gradient(180deg,#081827_0%,#07111D_100%)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#153D5F] px-3 py-2.5">
            <div>
              <div className="text-[12px] font-black text-white">Research Snapshot</div>
              <div className="mt-0.5 text-[8px] text-[#718AA3]">Built only from verified rows available for this exact prop.</div>
            </div>
            <span className="shrink-0 rounded-full border border-[#0F5B44] bg-[#08271F] px-2 py-1 text-[7px] font-black tracking-[.04em] text-[#23E787]">
              VERIFIED INPUTS
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4">
            <div className="min-w-0 border-b border-r border-[#102C44] px-2.5 py-2.5 sm:border-b-0">
              <div className="text-[7px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">Recent · L10</div>
              <div className="mt-1 text-[17px] font-black leading-none text-white">{recentWindow?.hitRate === null || recentWindow?.hitRate === undefined ? '—' : recentWindow.hitRate + '%'}</div>
              <div className="mt-1 truncate text-[7px] text-[#8FA4BA]">
                {recentWindow?.games ? recentWindow.hits + '/' + recentWindow.games + ' hits' : 'No verified sample'}
                {recentWindow?.average === null || recentWindow?.average === undefined ? '' : ' · Avg ' + recentWindow.average}
              </div>
            </div>
            <div className="min-w-0 border-b border-[#102C44] px-2.5 py-2.5 sm:border-b-0 sm:border-r">
              <div className="text-[7px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">Vs opponent</div>
              <div className="mt-1 text-[17px] font-black leading-none text-white">{h2h?.hitRate === null || h2h?.hitRate === undefined ? '—' : h2h.hitRate + '%'}</div>
              <div className="mt-1 truncate text-[7px] text-[#8FA4BA]">
                {h2h?.games ? h2h.hits + '/' + h2h.games + ' H2H hits' : 'No verified H2H sample'}
              </div>
            </div>
            <div className="min-w-0 border-r border-[#102C44] px-2.5 py-2.5">
              <div className="text-[7px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">Same-book line</div>
              <div className="mt-1 truncate text-[15px] font-black leading-none text-white">
                {researchLineMove ? researchLineMove.from + ' → ' + researchLineMove.to : state.line}
              </div>
              <div className="mt-1 truncate text-[7px] text-[#8FA4BA]">
                {researchLineMove ? researchLineMove.book + (researchLineMove.capturedAt ? ' · ' + shortTime(researchLineMove.capturedAt) : '') : 'No comparable movement yet'}
              </div>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <div className="text-[7px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">Matchup</div>
              <div className="mt-1 truncate text-[15px] font-black leading-none text-white">{currentDefense ? DEFENSE_TIER_LABEL[currentDefense.tier] : '—'}</div>
              <div className="mt-1 truncate text-[7px] text-[#8FA4BA]">
                {currentDefense && defensePosition && defenseMetric
                  ? ordinal(currentDefense.allowedRank) + '-most allowed vs ' + defensePosition + ' · ' + metricLabel(defenseMetric)
                  : 'Verified DvP unavailable'}
              </div>
            </div>
          </div>
          <div className="border-t border-[#153D5F] px-3 py-2 text-[7px] font-medium text-[#66809B]">
            Evidence: {verifiedGames.length} verified {verifiedGames.length === 1 ? 'game' : 'games'} · {availableBooks.length} priced {availableBooks.length === 1 ? 'book' : 'books'} · {lineHistory.length} line {lineHistory.length === 1 ? 'snapshot' : 'snapshots'}
          </div>
        </section>

        <HistoryModel group={group} selectedBook={selectedBook} line={state.line} />
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categoryLabels.map((entry) => {
          const active = entry.label === marketLabel;
          return (
            <button
              key={entry.label}
              type="button"
              aria-pressed={active}
              onClick={() => chooseCategory(entry.label)}
              className={cx(
                'h-10 min-w-[118px] shrink-0 rounded-lg border px-3 text-[10px] font-black transition',
                active
                  ? 'border-[#03A9FF] bg-[linear-gradient(180deg,#0B4C88_0%,#062E57_100%)] text-white shadow-[0_0_15px_rgba(0,164,255,.48),inset_0_0_16px_rgba(0,164,255,.16)]'
                  : 'border-[#183750] bg-[#081423] text-[#A7B6C8]',
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <section className="mt-1.5 overflow-hidden rounded-[16px] border border-[#153D5F] bg-[linear-gradient(180deg,#071323_0%,#06101C_100%)] shadow-[0_12px_34px_rgba(0,0,0,.24)]">
        <div className="p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-[18px] font-black tracking-[-.02em] text-white">{marketLabel}</h2>
            <div data-qa="sample-count" className="shrink-0 text-[9px] font-bold text-[#66809B]">{loading ? 'Loading verified history…' : filteredGames.length + ' of ' + verifiedGames.length + ' verified ' + (verifiedGames.length === 1 ? 'game' : 'games')}</div>
          </div>

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="grid h-10 grid-cols-[36px_58px_36px] overflow-hidden rounded-lg border border-[#244868] bg-[#081523]">
              <button type="button" aria-label="Lower target line" onClick={() => stepLine(-1)} className="grid place-items-center border-r border-[#244868] text-[#55B8FF]"><Minus className="h-4 w-4" /></button>
              <div data-qa="line-number" className="grid place-items-center text-[16px] font-black text-white">{state.line}</div>
              <button type="button" aria-label="Raise target line" onClick={() => stepLine(1)} className="grid place-items-center border-l border-[#244868] text-[#55B8FF]"><Plus className="h-4 w-4" /></button>
            </div>

            <div role="group" aria-label="Hit-rate side" className="grid h-10 grid-cols-2 overflow-hidden rounded-lg border border-[#244868] bg-[#081523] text-[12px] font-black">
              {(['OVER', 'UNDER'] as const).map((side) => {
                const active = state.side === side;
                const letter = side === 'OVER' ? 'O' : 'U';
                return (
                  <button
                    key={side}
                    type="button"
                    aria-pressed={active}
                    aria-label={letter + ' ' + state.line}
                    onClick={() => onState({ ...state, side })}
                    className={cx(
                      'w-10 transition',
                      active
                        ? side === 'OVER' ? 'bg-[#0E3A2A] text-[#23E787]' : 'bg-[#3A0E1A] text-[#FF6B7D]'
                        : 'text-[#6F88A3] hover:text-white',
                    )}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>

            <label className="relative flex h-10 min-w-[130px] items-center gap-2 rounded-lg border border-[#244868] bg-[#081523] px-3 text-[9px] font-bold">
              <span className="rounded-md border border-[#67540A] bg-[#241E07] px-1.5 py-0.5 text-[#FACC15]">{bookInitials(selectedBook ? selectedBook.name : quoteBook(heroQuote))}</span>
              <span className="min-w-0 truncate">
                <b className="text-[#23E787]">O {quoteAtResearchLine && over ? quotePrice(over) : '—'}</b>
                <span className="mx-1 text-[#46627E]">·</span>
                <b className="text-[#FF6B7D]">U {quoteAtResearchLine && under ? quotePrice(under) : '—'}</b>
              </span>
              <select
                aria-label="Sportsbook price source"
                value={state.book || 'all'}
                onChange={(event) => onState({ ...state, book: event.target.value === 'all' ? null : event.target.value })}
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
              >
                <option value="all">Best prices</option>
                {availableBooks.map((book) => <option key={book.key} value={book.key}>{book.name}</option>)}
              </select>
            </label>

            <button
              type="button"
              aria-label={favourite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={favourite}
              onClick={onFavourite}
              className={cx(
                'grid h-10 w-10 place-items-center rounded-lg border bg-[#081523]',
                favourite ? 'border-[#0A8EE8] text-[#2FAEFF] shadow-[0_0_14px_rgba(0,153,255,.3)]' : 'border-[#244868] text-[#7F98B2]',
              )}
            >
              <Star className="h-5 w-5" fill={favourite ? 'currentColor' : 'none'} />
            </button>

            <button
              type="button"
              aria-expanded={showMoreFilters}
              aria-controls="more-history-filters"
              onClick={() => setShowMoreFilters((open) => !open)}
              className={cx(
                'relative ml-auto flex h-10 items-center gap-2 rounded-lg border bg-[#081523] px-3 text-[10px] font-bold',
                showMoreFilters || advancedCount ? 'border-[#0A8EE8] text-white shadow-[0_0_14px_rgba(0,153,255,.25)]' : 'border-[#244868] text-[#9DB2C8]',
              )}
            >
              <SlidersHorizontal className="h-4 w-4 text-[#2FAEFF]" aria-hidden />
              <span className="hidden min-[380px]:inline">More filters</span>
              <span className="sr-only min-[380px]:hidden">More filters</span>
              {advancedCount ? (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#0A8EE8] px-1 text-[9px] font-black text-white">{advancedCount}</span>
              ) : null}
            </button>
          </div>

          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SelectPill label="Opponent" value={filters.opponent} options={opponentOptions} onChange={(opponent) => setFilters((previous) => ({ ...previous, opponent }))} />
            <SelectPill label="Season" value={filters.season} options={seasonOptions} onChange={(season) => setFilters((previous) => ({ ...previous, season }))} />
            <SelectPill
              label="Home/Away"
              value={filters.venue}
              options={[{ value: 'all', label: 'All' }, { value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]}
              onChange={(venue) => setFilters((previous) => ({ ...previous, venue: venue as SampleFilters['venue'] }))}
            />
            {periods.length > 1 ? (
              <label className="relative flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#244868] bg-[#081523] px-3 pr-7 text-[9px] font-semibold text-[#91A7BE]">
                <span>Period: <b className="text-white">{periodLabel(group.period)}</b></span>
                <ChevronDown className="absolute right-2 h-3 w-3" />
                <select
                  aria-label="Period"
                  value={group.period || 'game'}
                  onChange={(event) => choosePeriod(event.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
                >
                  {periods.map((entry) => <option key={entry.period} value={entry.period}>{periodLabel(entry.period)}</option>)}
                </select>
              </label>
            ) : null}
          </div>

          {upcoming && upcomingOpponent && (upcoming.opponentRank || upcoming.opponentHand || upcoming.surface) ? (
            <div data-qa="tennis-matchup" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[#1C3B58] bg-[#081421] px-3 py-2 text-[10px] leading-4 text-[#9DB2C8]">
              <Users className="h-3.5 w-3.5 shrink-0 text-[#2FAEFF]" aria-hidden />
              <span className="min-w-0">
                vs <b className="text-white">{upcomingOpponent}</b>
                {upcoming.opponentRank ? <> · <b className="text-white">#{upcoming.opponentRank}</b></> : null}
                {upcoming.opponentHand ? <> · {upcoming.opponentHand === 'L' ? 'Left-handed' : 'Right-handed'}</> : null}
                {upcoming.surface ? <> · {upcoming.surface}{upcoming.indoor === true ? ' (indoor)' : ''}</> : null}
              </span>
              {tennis?.player?.rank ? (
                <span className="rounded-full border border-[#244868] bg-[#0B1826] px-2 py-0.5 text-[9px] font-black text-[#C6D0DE]">
                  {group.player.split(' ').slice(-1)[0]} #{tennis.player.rank}
                </span>
              ) : null}
            </div>
          ) : null}

          {currentDefense && defenseMetric ? (
            <div data-qa="defense-matchup" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[#1C3B58] bg-[#081421] px-3 py-2 text-[10px] leading-4 text-[#9DB2C8]">
              <Shield className="h-3.5 w-3.5 shrink-0 text-[#2FAEFF]" aria-hidden />
              <span className="min-w-0">
                <b className="text-white">{currentDefense.team}</b> allows{' '}
                <b className="text-white">
                  {currentDefense.allowedRank === 1 ? 'the most' : currentDefense.allowedRank === currentDefense.leagueSize ? 'the fewest' : 'the ' + ordinal(currentDefense.allowedRank) + '-most'}
                </b>{' '}
                {metricLabel(defenseMetric)} to {defensePosition}s · {Number(currentDefense.row.average).toFixed(1)}/game
              </span>
              <span className={cx(
                'rounded-full border px-2 py-0.5 text-[9px] font-black',
                currentDefense.tier === 'soft' ? 'border-[#1E8A5A] bg-[#0E3A2A] text-[#23E787]'
                  : currentDefense.tier === 'tough' ? 'border-[#8A1E36] bg-[#3A0E1A] text-[#FF6B7D]'
                    : 'border-[#244868] bg-[#0B1826] text-[#C6D0DE]',
              )}>
                {DEFENSE_TIER_LABEL[currentDefense.tier]} matchup
              </span>
            </div>
          ) : null}

          {!quoteAtResearchLine ? (
            <div className="mt-2 flex items-center gap-2 text-[9px] text-[#7E97B0]">
              <span className="rounded-md border border-[#6B4F0A] bg-[#2A1F05] px-1.5 py-0.5 font-black text-[#FACC15]">Research line</span>
              <span>Books post {group.line}; prices apply to the posted line only.</span>
            </div>
          ) : null}

          {showMoreFilters ? (
            <div id="more-history-filters" className="mt-2 rounded-xl border border-[#1C3B58] bg-[#06111D] p-3">
              {anyAdvanced ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {coverage.rest ? (
                    <FilterSelect
                      label={'Days rest' + (restUpcoming !== null ? ' (upcoming: ' + restUpcoming + ')' : '')}
                      value={filters.rest || 'all'}
                      options={[
                        { value: 'all', label: 'Any' },
                        { value: '0', label: 'Back-to-back' },
                        { value: '1', label: '1 day' },
                        { value: '2', label: '2 days' },
                        { value: '3+', label: '3+ days' },
                      ]}
                      onChange={(rest) => setFilters((previous) => ({ ...previous, rest: rest as SampleFilters['rest'] }))}
                    />
                  ) : null}
                  {coverage.result ? (
                    <FilterSelect
                      label="Win/Loss"
                      value={filters.result || 'all'}
                      options={[
                        { value: 'all', label: 'Any' },
                        { value: 'W', label: individualSport ? 'Won match' : 'Team won' },
                        { value: 'L', label: individualSport ? 'Lost match' : 'Team lost' },
                      ]}
                      onChange={(result) => setFilters((previous) => ({ ...previous, result: result as SampleFilters['result'] }))}
                    />
                  ) : null}
                  {coverage.role ? (
                    <FilterSelect
                      label="Role"
                      value={filters.role || 'all'}
                      options={[{ value: 'all', label: 'Any' }, { value: 'starter', label: 'Started' }, { value: 'bench', label: 'Bench' }]}
                      onChange={(role) => setFilters((previous) => ({ ...previous, role: role as SampleFilters['role'] }))}
                    />
                  ) : null}
                  {minuteOptions.length > 1 ? (
                    <FilterSelect
                      label="Minutes played"
                      value={filters.minutes || 'all'}
                      options={minuteOptions}
                      onChange={(minutes) => setFilters((previous) => ({ ...previous, minutes }))}
                    />
                  ) : null}
                  {coverage.setsPlayed ? (
                    <FilterSelect
                      label="Sets played"
                      value={filters.setsPlayed || 'all'}
                      options={setsOptions}
                      onChange={(setsPlayed) => setFilters((previous) => ({ ...previous, setsPlayed: setsPlayed as SampleFilters['setsPlayed'] }))}
                    />
                  ) : null}
                  {coverage.matchFormat ? (
                    <FilterSelect
                      label="Match format"
                      value={filters.matchFormat || 'all'}
                      options={[{ value: 'all', label: 'Any' }, { value: 'BO3', label: 'Best of 3' }, { value: 'BO5', label: 'Best of 5' }]}
                      onChange={(matchFormat) => setFilters((previous) => ({ ...previous, matchFormat: matchFormat as SampleFilters['matchFormat'] }))}
                    />
                  ) : null}
                  {coverage.surface ? (
                    <FilterSelect
                      label="Court type"
                      value={filters.surface || 'all'}
                      options={surfaceOptions}
                      onChange={(surface) => setFilters((previous) => ({ ...previous, surface: surface as SampleFilters['surface'] }))}
                    />
                  ) : null}
                  {coverage.opponentHand ? (
                    <FilterSelect
                      label="Opponent hand"
                      value={filters.opponentHand || 'all'}
                      options={[{ value: 'all', label: 'Any' }, { value: 'R', label: 'Right-handed' }, { value: 'L', label: 'Left-handed' }]}
                      onChange={(opponentHand) => setFilters((previous) => ({ ...previous, opponentHand: opponentHand as SampleFilters['opponentHand'] }))}
                    />
                  ) : null}
                  {coverage.opponentRank ? (
                    <FilterSelect
                      label="Opponent rank (current)"
                      value={filters.opponentRank || 'all'}
                      options={[
                        { value: 'all', label: 'Any' },
                        { value: 'top10', label: 'Top 10' },
                        { value: 'top50', label: '11–50' },
                        { value: 'top100', label: '51–100' },
                        { value: 'over100', label: 'Outside top 100' },
                      ]}
                      onChange={(opponentRank) => setFilters((previous) => ({ ...previous, opponentRank: opponentRank as SampleFilters['opponentRank'] }))}
                    />
                  ) : null}
                  {coverage.winProb ? (
                    <FilterSelect
                      label="Win % from moneyline"
                      value={filters.winProb || 'all'}
                      options={[
                        { value: 'all', label: 'Any' },
                        { value: 'fav70', label: 'Heavy favorite (70%+)' },
                        { value: 'fav55', label: 'Favorite (55–70%)' },
                        { value: 'even', label: 'Toss-up (45–55%)' },
                        { value: 'dog', label: 'Underdog (<45%)' },
                      ]}
                      onChange={(winProb) => setFilters((previous) => ({ ...previous, winProb: winProb as SampleFilters['winProb'] }))}
                    />
                  ) : null}
                  {coverage.defenseTier ? (
                    <FilterSelect
                      label="Opponent defense (current)"
                      value={filters.defenseTier || 'all'}
                      options={[
                        { value: 'all', label: 'Any' },
                        { value: 'soft', label: DEFENSE_TIER_LABEL.soft },
                        { value: 'average', label: DEFENSE_TIER_LABEL.average },
                        { value: 'tough', label: DEFENSE_TIER_LABEL.tough },
                      ]}
                      onChange={(defenseTier) => setFilters((previous) => ({ ...previous, defenseTier: defenseTier as SampleFilters['defenseTier'] }))}
                    />
                  ) : null}
                  {coverage.seasonType ? (
                    <FilterSelect
                      label="Game type"
                      value={filters.seasonType || 'all'}
                      options={[{ value: 'all', label: 'Any' }, { value: 'regular', label: 'Regular season' }, { value: 'post', label: 'Playoffs' }]}
                      onChange={(seasonType) => setFilters((previous) => ({ ...previous, seasonType: seasonType as SampleFilters['seasonType'] }))}
                    />
                  ) : null}
                </div>
              ) : (
                <p className="text-[10px] leading-4 text-[#7E97B0]">
                  {loading ? 'Loading verified history…' : 'This player\'s verified history has no rest, result, role, minutes or set detail to filter by.'}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[9px] leading-4 text-[#55718E]">
                  Only filters this player's verified history can answer are shown.
                  {coverage.defenseTier ? ' Opponent defense uses each team\'s current rank vs ' + defensePosition + 's, not its rank at the time of the game.' : ''}
                  {coverage.winProb ? ' Win % is the no-vig closing moneyline for the latest 15 matches; older matches have no value and drop out when it is set.' : ''}
                  {coverage.opponentRank ? ' Opponent rank is today\'s ranking, not the ranking at the time of the match.' : ''}
                  {individualSport && moneylineLoading ? ' Loading closing moneylines…' : ''}
                  {individualSport && tennis?.available && tennis.complete === false ? ' Loading more match details…' : ''}
                </p>
                {advancedCount || filters.opponent !== 'all' || filters.season !== 'all' || filters.venue !== 'all' ? (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-[#244868] px-2 py-1 text-[9px] font-bold text-[#9DB2C8] hover:text-white"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden /> Clear all
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {unavailableReason ? <p className="mt-1 text-[9px] leading-4 text-[#FF9AAF]">{unavailableReason}</p> : null}

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {quickWindows.map((item) => {
              const active = sample === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={active}
                  onClick={() => setSample(item.id as SampleId)}
                  className={cx(
                    'min-h-[64px] rounded-lg border px-2 py-2 text-left transition',
                    active
                      ? 'border-[#008DFF] bg-[linear-gradient(180deg,#0B2F58_0%,#081C34_100%)] shadow-[0_0_14px_rgba(0,140,255,.3)]'
                      : 'border-[#1C3B58] bg-[#081421]',
                  )}
                >
                  <div className="text-[9px] font-black text-[#C1D1E2]">{item.label}</div>
                  <div className={cx('mt-1 text-[11px] font-black', item.hitRate === null ? 'text-[#91A0B5]' : 'text-[#22E78A]')}>HR {rateLabel(item.hitRate)}</div>
                  <div className="mt-0.5 text-[9px] font-semibold text-[#8CA0B6]">{item.average === null ? 'Avg —' : 'Avg ' + item.average}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-2">
            {loading ? (
              <div className="h-[250px] animate-pulse rounded-xl border border-[#173C59] bg-[#07131F]" />
            ) : (
              <HistoryChart games={chartGames} line={state.line} market={marketLabel} period={periodLabel(group.period)} leagueTeams={research?.leagueTeams || []} individual={individualSport} />
            )}
          </div>
        </div>
      </section>

      <section className="mt-2 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
        <div className="border-b border-[#153D5F] px-3 py-2 text-[12px] font-black text-white">Supporting Stats</div>
        {support.length ? (
          <div className="grid grid-cols-6" data-mobile-columns={Math.min(support.length, 3)}>
            {support.map((item, index) => (
              <div key={item.label} className={cx('min-w-0 px-1.5 py-2.5 text-center', index > 0 && 'border-l border-[#153D5F]')}>
                <div className="truncate text-[7px] font-black uppercase tracking-[.03em] text-[#7E97B0]">{item.label}</div>
                <div className="mt-1 truncate text-[11px] font-black text-white">{item.value}</div>
                <div className="mt-0.5 text-[6px] text-[#55718E]">{item.sample} gm</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-4 text-[9px] text-[#7E97B0]">No verified stats for this player yet.</p>
        )}
      </section>

      {individualSport && currentOpponent ? (
        <OpponentField group={group} opponent={currentOpponent} line={state.line} side={state.side} marketLabel={marketLabel} />
      ) : null}

      <div className="mt-2">
        <GameContext group={group} />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <section className="min-w-0 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
          <div className="flex items-center justify-between border-b border-[#153D5F] px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-black text-white">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[#25AFFF]" />
              <span className="truncate">Line Movement</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-[#6F8BA6]" />
          </div>
          <div className="grid grid-cols-[.6fr_.8fr_1fr] gap-1 border-b border-[#102C44] px-2 py-1 text-[6px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">
            <span>Line</span><span>Odds</span><span>Book / Time</span>
          </div>
          {movementRows.length ? movementRows.map((point, index) => {
            const price = numberOf(point.price);
            const when = text(point.recordedAt || point.capturedAt);
            const info = bookInfo(point.bookmakerKey);
            return (
              <div key={(when || 'movement') + '-' + index} className="grid grid-cols-[.6fr_.8fr_1fr] gap-1 border-b border-[#102C44] px-2 py-1.5 text-[7px] last:border-b-0">
                <span className="font-black text-white">{numberOf(point.line) ?? '—'}</span>
                <span className={point.side?.toUpperCase() === 'UNDER' ? 'font-black text-[#FF6B7D]' : 'font-black text-[#23E787]'}>
                  {point.side ? point.side.slice(0, 1).toUpperCase() + ' ' : ''}{price !== null && price !== 0 ? odds(price) : '—'}
                </span>
                <span className="min-w-0 truncate text-[#91A7BE]">{info?.name || point.bookmakerKey || 'Book unavailable'}{when ? ' · ' + shortTime(when) : ''}</span>
              </div>
            );
          }) : <p className="px-2.5 py-4 text-[8px] leading-3 text-[#6F8BA6]">No verified line movement yet.</p>}
        </section>

        <section className="min-w-0 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
          <div className="flex items-center justify-between border-b border-[#153D5F] px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-black text-white">
              <History className="h-3.5 w-3.5 shrink-0 text-[#25AFFF]" />
              <span className="truncate">Prop History</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-[#6F8BA6]" />
          </div>
          <div className="grid grid-cols-[.55fr_1fr_1fr] gap-1 border-b border-[#102C44] px-2 py-1 text-[6px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">
            <span>Line</span><span>Result</span><span>Date</span>
          </div>
          {recentHistory.length ? recentHistory.map((game, index) => {
            const value = numberOf(game.value);
            const result = value === null ? 'Unavailable' : value > state.line ? 'Over (' + value + ')' : value < state.line ? 'Under (' + value + ')' : 'Push (' + value + ')';
            const tone = value === null || value === state.line ? 'text-[#A9B6C6]' : value > state.line ? 'text-[#23E787]' : 'text-[#FF6B7D]';
            return (
              <div key={(game.gameId || game.date || 'history') + '-' + index} className="grid grid-cols-[.55fr_1fr_1fr] gap-1 border-b border-[#102C44] px-2 py-1.5 text-[7px] last:border-b-0">
                <span className="font-black text-white">{state.line}</span>
                <span className={cx('truncate font-black', tone)}>{result}</span>
                <span className="truncate text-[#91A7BE]">{numericDate(game.date)}{game.opponent ? ' vs ' + (individualSport ? surname(game.opponent) : teamShort(game.opponent, research?.leagueTeams || [])) : ''}</span>
              </div>
            );
          }) : <p className="px-2.5 py-4 text-[8px] leading-3 text-[#6F8BA6]">Verified prop history is unavailable.</p>}
        </section>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <section className="min-w-0 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
          <div className="flex items-center gap-1.5 border-b border-[#153D5F] px-2.5 py-2 text-[10px] font-black text-white">
            <Users className="h-3.5 w-3.5 text-[#25AFFF]" />
            Matchup
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 px-2 py-2.5">
            <div className="min-w-0 text-center">
              <div className="mx-auto h-10 w-10 overflow-hidden rounded-full border border-[#1C6DA6]">
                <PlayerAvatar name={group.player} sport={group.sport} team={group.team} providerPlayerId={group.providerPlayerId} size={40} className="!size-full" />
              </div>
              <div className="mt-1 truncate text-[8px] font-black text-white">{group.player}</div>
              <div className="truncate text-[7px] text-[#718AA3]">{teamLabel}</div>
            </div>
            <div className="text-[9px] font-black text-[#7C91A8]">VS</div>
            <div className="min-w-0 text-center">
              <div className="mx-auto h-10 w-10 overflow-hidden rounded-full border border-[#1C6DA6]">
                <PlayerAvatar name={currentOpponent || 'Opponent'} sport={group.sport} team={currentOpponent} size={40} className="!size-full" />
              </div>
              <div className="mt-1 truncate text-[8px] font-black text-white">{currentOpponent || 'Opponent unavailable'}</div>
              <div className="truncate text-[7px] text-[#718AA3]">{group.matchup || 'Matchup unavailable'}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-[#153D5F]">
            <div className="px-2 py-2 text-center">
              <div className="text-[7px] font-bold uppercase text-[#6F8BA6]">H2H prop hit rate</div>
              <div className="mt-1 text-[16px] font-black text-[#23E787]">{h2h?.hitRate === null || h2h?.hitRate === undefined ? '—' : h2h.hitRate + '%'}</div>
            </div>
            <div className="border-l border-[#153D5F] px-2 py-2 text-center">
              <div className="text-[7px] font-bold uppercase text-[#6F8BA6]">H2H average</div>
              <div className="mt-1 text-[16px] font-black text-[#26AEFF]">{h2h?.average === null || h2h?.average === undefined ? '—' : h2h.average}</div>
            </div>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
          <div className="flex items-center gap-1.5 border-b border-[#153D5F] px-2.5 py-2 text-[10px] font-black text-white">
            <BarChart3 className="h-3.5 w-3.5 text-[#25AFFF]" />
            Advanced Averages
          </div>
          <div className="grid grid-cols-[1fr_.8fr_.7fr_.7fr] gap-1 border-b border-[#102C44] px-2 py-1 text-[6px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">
            <span>Split</span><span>W-L</span><span>HR</span><span>Avg</span>
          </div>
          {advancedRows.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_.8fr_.7fr_.7fr] gap-1 border-b border-[#102C44] px-2 py-1.5 text-[7px] last:border-b-0">
              <span className="truncate font-bold text-white">{row.label}</span>
              <span className="text-[#A9B8C9]">{row.games ? row.hits + '-' + row.misses : '0-0'}</span>
              <span className={row.hitRate === null ? 'text-[#7C91A8]' : 'font-black text-[#23E787]'}>{rateLabel(row.hitRate)}</span>
              <span className="font-black text-[#72C7FF]">{row.average === null ? '—' : row.average}</span>
            </div>
          ))}
        </section>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <section className="min-w-0 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
          <div className="flex items-center justify-between border-b border-[#153D5F] px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-white"><BookOpen className="h-3.5 w-3.5 text-[#25AFFF]" />Stat Glossary</div>
            <span className="text-[7px] font-bold text-[#35B6FF]">VERIFIED</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 px-2 py-2 text-[6.5px] leading-3 text-[#8FA4BA]">
            <span><b className="text-[#DCE7F3]">HR:</b> Hit rate</span>
            <span><b className="text-[#DCE7F3]">Avg:</b> Average result</span>
            <span><b className="text-[#DCE7F3]">L5:</b> Last 5 games</span>
            <span><b className="text-[#DCE7F3]">L10:</b> Last 10 games</span>
            <span><b className="text-[#DCE7F3]">L15:</b> Last 15 games</span>
            <span><b className="text-[#DCE7F3]">H2H:</b> vs current opponent</span>
            <span><b className="text-[#DCE7F3]">O/U:</b> Over / Under</span>
            <span><b className="text-[#DCE7F3]">EV:</b> Expected value</span>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
          <div className="flex items-center justify-between border-b border-[#153D5F] px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-white"><CalendarDays className="h-3.5 w-3.5 text-[#25AFFF]" />Gamelog – Last 15</div>
            <span className="text-[7px] font-bold text-[#35B6FF]">{filteredGames.length} GAMES</span>
          </div>
          <div className="grid grid-cols-[.7fr_1fr_.7fr_.8fr] gap-1 border-b border-[#102C44] px-2 py-1 text-[6px] font-bold uppercase tracking-[.04em] text-[#6F8BA6]">
            <span>Date</span><span>Opponent</span><span>Value</span><span>Result</span>
          </div>
          {filteredGames.slice(0, 5).map((game, index) => {
            const value = numberOf(game.value);
            const result = value === null ? '—' : value > state.line ? 'Over' : value < state.line ? 'Under' : 'Push';
            const tone = result === 'Over' ? 'text-[#23E787]' : result === 'Under' ? 'text-[#FF6B7D]' : 'text-[#A9B8C9]';
            return (
              <div key={(game.gameId || game.date || 'gamelog') + '-' + index} className="grid grid-cols-[.7fr_1fr_.7fr_.8fr] gap-1 border-b border-[#102C44] px-2 py-1.5 text-[7px] last:border-b-0">
                <span className="text-[#9EB0C2]">{numericDate(game.date)}</span>
                <span className="truncate text-[#D9E5F1]" title={text(game.opponent) || undefined}>{(individualSport ? surname(game.opponent) : teamShort(game.opponent, research?.leagueTeams || [])) || '—'}</span>
                <span className="font-black text-white">{value ?? '—'}</span>
                <span className={cx('font-black', tone)}>{result}</span>
              </div>
            );
          })}
          {!filteredGames.length ? <p className="px-2.5 py-4 text-[8px] text-[#6F8BA6]">Verified game log is unavailable.</p> : null}
        </section>
      </div>

      <div className="mt-2">
        <details data-qa="market-comparison" className="group overflow-hidden rounded-2xl border border-[#153D5F] bg-[#071321]" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-[11px] font-black text-white [&::-webkit-details-marker]:hidden">
            <span>Market Comparison</span>
            <span className="whitespace-nowrap rounded-full border border-[#0F5B44] bg-[#08271F] px-2.5 py-1 text-[8px] font-black text-[#23E787]">
              {!availableBooks.length && dfsSource
                ? '0 SPORTSBOOKS · ' + dfsSource.toUpperCase() + ' LINE'
                : availableBooks.length + ' ' + (availableBooks.length === 1 ? 'BOOK' : 'BOOKS')}
            </span>
          </summary>
          <div className="border-t border-[#153D5F] px-3 pb-3 pt-2">
            {availableBooks.length ? (
              <>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-[#164832] bg-[#08251C] px-3 py-2.5">
                    <div className="text-[7px] font-bold uppercase tracking-[.05em] text-[#6F9E86]">Best Over</div>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      <div className="text-[18px] font-black leading-none text-[#23E787]">{bestOverPrice === null ? '—' : odds(bestOverPrice)}</div>
                      <div className="truncate text-right text-[8px] font-bold text-[#DCE5EF]">{bestOverBook?.name || 'Unavailable'}</div>
                    </div>
                    <div className="mt-1 text-[7px] text-[#79A28D]">
                      {bestOverPrice === null ? 'No verified Over price' : 'Implied ' + (americanImpliedProbability(bestOverPrice) ?? 0).toFixed(1) + '%'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#5A2032] bg-[#29101A] px-3 py-2.5">
                    <div className="text-[7px] font-bold uppercase tracking-[.05em] text-[#B48693]">Best Under</div>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      <div className="text-[18px] font-black leading-none text-[#FF5C88]">{bestUnderPrice === null ? '—' : odds(bestUnderPrice)}</div>
                      <div className="truncate text-right text-[8px] font-bold text-[#DCE5EF]">{bestUnderBook?.name || 'Unavailable'}</div>
                    </div>
                    <div className="mt-1 text-[7px] text-[#B48A97]">
                      {bestUnderPrice === null ? 'No verified Under price' : 'Implied ' + (americanImpliedProbability(bestUnderPrice) ?? 0).toFixed(1) + '%'}
                    </div>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  {availableBooks.map((book) => {
                    const overPrice = numberOf(book.over?.price);
                    const underPrice = numberOf(book.under?.price);
                    const bestOver = overPrice !== null && bestOverPrice !== null && overPrice === bestOverPrice;
                    const bestUnder = underPrice !== null && bestUnderPrice !== null && underPrice === bestUnderPrice;
                    const selected = selectedBook?.key === book.key;
                    return (
                      <button
                        key={book.key}
                        type="button"
                        onClick={() => onState({ ...state, book: book.key })}
                        aria-pressed={selected}
                        className={cx(
                          'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[9px] transition',
                          selected ? 'border-[#0A8EE8] bg-[#0A2136] shadow-[0_0_12px_rgba(0,142,232,.16)]' : 'border-[#183750] bg-[#081421]',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-[#DCE5EF]">{book.name}</span>
                          <span className="mt-0.5 block text-[7px] text-[#607891]">{book.type === 'sportsbook' ? 'Sportsbook' : book.type}</span>
                        </span>
                        <span className="min-w-[72px] text-right">
                          <span className="block font-black text-[#23E787]">O {book.over ? odds(book.over.price) : '—'}</span>
                          <span className="mt-0.5 block text-[6px] font-bold text-[#7FA990]">{bestOver ? 'BEST OVER' : overPrice === null ? 'NO PRICE' : (americanImpliedProbability(overPrice) ?? 0).toFixed(1) + '%'}</span>
                        </span>
                        <span className="min-w-[72px] text-right">
                          <span className="block font-black text-[#FF5C88]">U {book.under ? odds(book.under.price) : '—'}</span>
                          <span className="mt-0.5 block text-[6px] font-bold text-[#B98695]">{bestUnder ? 'BEST UNDER' : underPrice === null ? 'NO PRICE' : (americanImpliedProbability(underPrice) ?? 0).toFixed(1) + '%'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[7px] leading-3 text-[#607891]">
                  Best price means the highest verified American price currently posted for this exact player, market, period and line. Implied probability includes each book's pricing margin; it is not a no-vig model probability.
                </p>
              </>
            ) : (
              <p className="text-[9px] leading-4 text-[#7E8FA5]">No verified sportsbook price is available for this exact line.</p>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

export default PlayerPropResearchCard;
