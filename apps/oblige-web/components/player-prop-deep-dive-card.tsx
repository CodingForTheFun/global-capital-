'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Flame,
  Minus,
  Plus,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PlayerHeadshot } from '@/components/player-headshot';
import type { PremiumPlayerResearchProps } from '@/components/premium-player-research';
import { computeWindow } from '@/lib/analytics';
import { marketFamily, marketName, offerPrice, periodName, sportName } from '@/lib/market-display';
import { finite, sportFamily } from '@/lib/player-analysis';
import type { GameLogRow, PropGroup, ResearchResponse } from '@/lib/types';
import { booksFor, type WorkspaceMarket, type WorkspaceOffer } from '@/lib/workspace';

export type PlayerDeepDiveAnalysis = {
  group: PropGroup | null;
  history: ResearchResponse | null;
  line: number;
  loading: boolean;
  unavailable?: string | null;
};

type FilterOption = { value: string; label: string };
type ChartRow = GameLogRow & { chartKey: string; chartValue: number; displayDate: string };

const text = (value: unknown) => String(value ?? '').trim();
const round1 = (value: number) => Math.round(value * 10) / 10;

function compactStatLabel(label: string) {
  const key = label.toLowerCase();
  const known: Array<[RegExp, string]> = [
    [/^receptions?$/, 'REC'],
    [/receiv.*yards|reception yards/, 'REC YDS'],
    [/^targets?$/, 'TARGETS'],
    [/touchdowns?|anytime touchdown/, 'TD'],
    [/rush.*yards/, 'RUSH YDS'],
    [/longest.*reception|longest reception/, 'LONG'],
    [/pass.*yards/, 'PASS YDS'],
    [/^points$/, 'PTS'],
    [/rebounds?/, 'REB'],
    [/assists?/, 'AST'],
    [/three|3-pointer/, '3PM'],
    [/strikeouts?/, 'K'],
    [/total bases/, 'TB'],
    [/shots on goal/, 'SOG'],
    [/^aces?$/, 'ACES'],
    [/double faults?/, 'DF'],
  ];
  return known.find(([pattern]) => pattern.test(key))?.[1] || label.toUpperCase().slice(0, 14);
}

function kickoffLabel(value: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} @ ${time}`;
}

function gameDate(value: unknown) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (!raw || !Number.isFinite(parsed)) return raw || '—';
  const date = new Date(parsed);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function gameTeam(row: GameLogRow) {
  for (const key of ['team', 'teamAbbr', 'teamAbbreviation', 'teamName']) {
    const value = text(row[key]);
    if (value) return value;
  }
  return '';
}

function numericField(row: GameLogRow, aliases: string[]) {
  for (const key of aliases) {
    const value = finite(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function metricAverage(rows: GameLogRow[], aliases: string[]) {
  const values = rows.map(row => numericField(row, aliases)).filter((value): value is number => value !== null);
  return values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function ratioAverage(rows: GameLogRow[], numeratorAliases: string[], denominatorAliases: string[]) {
  const values = rows.flatMap(row => {
    const numerator = numericField(row, numeratorAliases);
    const denominator = numericField(row, denominatorAliases);
    return numerator !== null && denominator !== null && denominator > 0 ? [numerator / denominator] : [];
  });
  return values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function supportingMetrics(sport: string, rows: GameLogRow[], period: string) {
  const family = sportFamily(sport);
  const suffix = period && period !== 'Full game' ? ` (${period})` : '';
  if (family === 'football') {
    return [
      { label: `Targets${suffix}`, value: metricAverage(rows, ['targets', 'target']) },
      { label: `Receptions${suffix}`, value: metricAverage(rows, ['receptions', 'receivingReceptions']) },
      { label: 'Yards / Rec', value: ratioAverage(rows, ['receivingYards', 'receptionYards', 'recYds'], ['receptions', 'receivingReceptions']) },
      { label: 'Red Zone Targets', value: metricAverage(rows, ['redZoneTargets', 'red_zone_targets']) },
    ];
  }
  if (family === 'basketball') {
    return [
      { label: 'Points', value: metricAverage(rows, ['points', 'pts']) },
      { label: 'Rebounds', value: metricAverage(rows, ['rebounds', 'reb']) },
      { label: 'Assists', value: metricAverage(rows, ['assists', 'ast']) },
      { label: 'Minutes', value: metricAverage(rows, ['minutes', 'min']) },
    ];
  }
  if (family === 'baseball') {
    return [
      { label: 'Hits', value: metricAverage(rows, ['hits']) },
      { label: 'Total Bases', value: metricAverage(rows, ['totalBases', 'total_bases']) },
      { label: 'RBIs', value: metricAverage(rows, ['rbis', 'rbi']) },
      { label: 'Runs', value: metricAverage(rows, ['runs', 'runsScored']) },
    ];
  }
  if (family === 'hockey') {
    return [
      { label: 'Shots on Goal', value: metricAverage(rows, ['shotsOnGoal', 'shots_on_goal']) },
      { label: 'Goals', value: metricAverage(rows, ['goals']) },
      { label: 'Assists', value: metricAverage(rows, ['assists']) },
      { label: 'Saves', value: metricAverage(rows, ['saves']) },
    ];
  }
  if (family === 'tennis') {
    return [
      { label: 'Aces', value: metricAverage(rows, ['aces']) },
      { label: 'Double Faults', value: metricAverage(rows, ['doubleFaults', 'double_faults']) },
      { label: 'Games Won', value: metricAverage(rows, ['gamesWon', 'games_won']) },
      { label: 'Sets Won', value: metricAverage(rows, ['setsWon', 'sets_won']) },
    ];
  }
  return [
    { label: 'Average', value: metricAverage(rows, ['value']) },
    { label: 'Minutes', value: metricAverage(rows, ['minutes']) },
    { label: 'Points', value: metricAverage(rows, ['points']) },
    { label: 'Assists', value: metricAverage(rows, ['assists']) },
  ];
}

function initials(name: string) {
  const clean = name.replace(/[^a-z0-9 ]/gi, ' ').trim();
  if (!clean) return 'BK';
  const words = clean.split(/\s+/);
  return (words.length > 1 ? words.map(word => word[0]).join('') : clean).slice(0, 4).toUpperCase();
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: FilterOption[]; onChange(value: string): void }) {
  return <label className="relative flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/80 px-2.5 text-[11px] text-slate-300 transition hover:border-slate-600">
    <span className="whitespace-nowrap text-slate-500">{label}:</span>
    <select value={value} onChange={event => onChange(event.target.value)} className="appearance-none bg-transparent pr-4 font-medium text-slate-200 outline-none">
      {options.map(option => <option key={option.value} value={option.value} className="bg-slate-950 text-slate-100">{option.label}</option>)}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-slate-500" aria-hidden="true"/>
  </label>;
}

function offerFor(market: WorkspaceMarket, book: string, line: number, side: 'OVER' | 'UNDER') {
  return market.offers.find(offer => offer.book === book && offer.line === line && offer.side === side && !offer.conflict) || null;
}

function ChartTooltip({ active, payload, line, marketLabel }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ChartRow }>; line: number; marketLabel: string }) {
  const game = payload?.[0]?.payload;
  if (!active || !game) return null;
  const dnp = game.dnp === true || game.didNotPlay === true || finite(game.value) === null;
  const value = finite(game.value);
  return <div className="rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-2xl backdrop-blur">
    <div className="font-semibold text-white">{game.displayDate} {game.isHome === false ? '@' : 'vs'} {text(game.opponent) || 'Opponent'}</div>
    {dnp ? <div className="mt-1 text-slate-400">Did not play / stat unavailable</div> : <>
      <div className="mt-1 text-slate-300">{marketLabel}: {value}</div>
      <div className={value !== null && value > line ? 'text-emerald-400' : value !== null && value < line ? 'text-rose-400' : 'text-slate-300'}>
        {value === line ? 'Push' : value !== null && value > line ? 'Over' : 'Under'} {line}
      </div>
    </>}
  </div>;
}

function formatMetric(value: number | null) {
  return value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function pricePair(market: WorkspaceMarket, book: string, line: number) {
  return {
    over: offerFor(market, book, line, 'OVER'),
    under: offerFor(market, book, line, 'UNDER'),
  };
}

export function PlayerPropDeepDiveCard({
  analysis,
  player,
  market,
  selected,
  side,
  favourite,
  canFollow,
  onCategory,
  onBook,
  onOffer,
  onFavourite,
  research,
  model,
  gameLog,
  quoteHistory,
  supporting,
  analysisSections,
  team,
  matchupLabel,
}: PremiumPlayerResearchProps & { analysis: PlayerDeepDiveAnalysis }) {
  const router = useRouter();
  const [targetLine, setTargetLine] = React.useState(analysis.line);
  const [opponentFilter, setOpponentFilter] = React.useState('all');
  const [seasonFilter, setSeasonFilter] = React.useState('all');
  const [venueFilter, setVenueFilter] = React.useState('all');
  const [teamFilter, setTeamFilter] = React.useState('all');
  const [bookFilter, setBookFilter] = React.useState('all');
  const [showFilters, setShowFilters] = React.useState(false);
  const [showFullResearch, setShowFullResearch] = React.useState(false);
  const patternId = React.useId().replace(/[^a-z0-9]/gi, '');

  React.useEffect(() => { setTargetLine(analysis.line); }, [analysis.line, market.key]);
  React.useEffect(() => { setBookFilter(selected.book || 'all'); }, [selected.book]);

  const group = analysis.group;
  const history = analysis.history;
  const rawGames = React.useMemo(() => history?.gameLog || [], [history]);
  const currentOpponent = text(history?.matchup?.opponent || group?.opponent) || null;
  const title = marketName(market);
  const period = periodName(market.period);
  const game = matchupLabel || group?.matchup || [player.awayTeam, player.homeTeam].filter(Boolean).join(' @ ') || 'Matchup unavailable';
  const position = text(history?.player?.position || group?.position || player.position) || 'Position unavailable';
  const bookList = React.useMemo(() => booksFor(market), [market]);

  const family = marketFamily(market);
  const statFamilies = React.useMemo(() => [...new Map(player.markets.map(item => [marketFamily(item), item])).values()], [player.markets]);
  const periodMarkets = React.useMemo(() => [...new Map(player.markets.filter(item => marketFamily(item) === family).map(item => [periodName(item.period), item])).values()], [player.markets, family]);

  const opponentOptions = React.useMemo<FilterOption[]>(() => {
    const values = [...new Set(rawGames.map(row => text(row.opponent)).filter(Boolean))].sort();
    return [{ value: 'all', label: 'All' }, ...values.map(value => ({ value, label: currentOpponent && value === currentOpponent ? `★ ${value}` : value }))];
  }, [rawGames, currentOpponent]);
  const seasonOptions = React.useMemo<FilterOption[]>(() => {
    const values = [...new Set(rawGames.map(row => text(row.season)).filter(Boolean))].sort().reverse();
    return [{ value: 'all', label: text(history?.season) || 'All' }, ...values.filter(value => value !== text(history?.season)).map(value => ({ value, label: value }))];
  }, [rawGames, history?.season]);
  const teamOptions = React.useMemo<FilterOption[]>(() => {
    const values = [...new Set([text(team), ...rawGames.map(gameTeam)].filter(Boolean))].sort();
    return [{ value: 'all', label: 'All' }, ...values.map(value => ({ value, label: value }))];
  }, [rawGames, team]);
  const bookOptions = React.useMemo<FilterOption[]>(() => [{ value: 'all', label: 'All' }, ...bookList.map(book => ({ value: book.key, label: book.name }))], [bookList]);

  const filteredGames = React.useMemo(() => rawGames.filter(row => {
    if (opponentFilter !== 'all' && text(row.opponent) !== opponentFilter) return false;
    if (seasonFilter !== 'all' && text(row.season) !== seasonFilter) return false;
    if (venueFilter === 'home' && row.isHome !== true) return false;
    if (venueFilter === 'away' && row.isHome !== false) return false;
    if (teamFilter !== 'all' && gameTeam(row) !== teamFilter) return false;
    return true;
  }), [rawGames, opponentFilter, seasonFilter, venueFilter, teamFilter]);

  const recent = React.useMemo(() => [...filteredGames].sort((a, b) => (Date.parse(text(b.date)) || 0) - (Date.parse(text(a.date)) || 0)), [filteredGames]);
  const played = React.useMemo(() => recent.filter(row => finite(row.value) !== null && row.dnp !== true && row.didNotPlay !== true), [recent]);
  const h2hRows = React.useMemo(() => currentOpponent ? played.filter(row => text(row.opponent) === currentOpponent) : [], [played, currentOpponent]);
  const windowRows = React.useMemo(() => [
    computeWindow(played, targetLine, side, 'l5', 'L5', 5),
    computeWindow(played, targetLine, side, 'l10', 'L10', 10),
    computeWindow(played, targetLine, side, 'l15', 'L15', 15),
    computeWindow(played, targetLine, side, 'season', text(history?.season) || 'Season'),
    computeWindow(h2hRows, targetLine, side, 'h2h', 'H2H'),
  ], [played, h2hRows, targetLine, side, history?.season]);

  const chartRows = React.useMemo<ChartRow[]>(() => {
    const chronological = recent.slice(0, 15).reverse();
    const observed = chronological.map(row => finite(row.value)).filter((value): value is number => value !== null);
    const maxValue = Math.max(targetLine, ...observed, 1);
    const dnpHeight = Math.max(maxValue * 0.08, 1);
    return chronological.map((row, index) => ({
      ...row,
      chartKey: `${text(row.gameId) || text(row.date) || index}-${index}`,
      chartValue: row.dnp === true || row.didNotPlay === true || finite(row.value) === null ? dnpHeight : finite(row.value)!,
      displayDate: gameDate(row.date),
    }));
  }, [recent, targetLine]);
  const yMax = React.useMemo(() => Math.max(targetLine, ...chartRows.map(row => finite(row.value) || 0), 1) * 1.2, [chartRows, targetLine]);

  const supportRows = React.useMemo(() => supportingMetrics(player.sport, played, period), [player.sport, played, period]);
  const selectedPair = pricePair(market, selected.book, targetLine);
  const booksShown = bookFilter === 'all' ? bookList : bookList.filter(book => book.key === bookFilter);

  function chooseStat(next: WorkspaceMarket) {
    const samePeriod = player.markets.find(item => marketFamily(item) === marketFamily(next) && item.period === market.period);
    onCategory((samePeriod || next).key);
  }
  function chooseBook(value: string) {
    setBookFilter(value);
    onBook(value === 'all' ? '' : value);
  }
  function renderBarLabel(props: Record<string, unknown>) {
    const x = Number(props.x || 0), y = Number(props.y || 0), width = Number(props.width || 0), index = Number(props.index || 0);
    const row = chartRows[index];
    if (!row) return null;
    const dnp = row.dnp === true || row.didNotPlay === true || finite(row.value) === null;
    return <text x={x + width / 2} y={Math.max(12, y - 6)} textAnchor="middle" fill={dnp ? '#94a3b8' : '#cbd5e1'} fontSize="10" fontWeight="700">{dnp ? 'DNP' : finite(row.value)}</text>;
  }

  return <section className="min-h-screen bg-[#070b12] px-2 py-3 text-slate-100 sm:px-4 lg:px-6" data-design="player-prop-deep-dive-v1">
    <div className="mx-auto max-w-[1180px] overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0b101a] shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
      <header className="flex items-center gap-3 border-b border-slate-800/80 bg-[#0a0f18]/95 px-3 py-2.5 sm:px-4">
        <button type="button" onClick={() => router.back()} aria-label="Back to props" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-700/80 bg-slate-900 text-slate-300 transition hover:border-slate-600 hover:text-white"><ArrowLeft className="h-4 w-4"/></button>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-black tracking-tight text-white sm:text-base">Oblige Props</div><div className="truncate text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-500 sm:text-[10px]">Data · Insights · Better Picks</div></div>
        <div className="hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]"/>Live research</div>
      </header>

      <div className="space-y-4 p-3 sm:p-4 lg:p-5">
        <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.13),transparent_30%),linear-gradient(180deg,rgba(19,27,46,0.9),rgba(10,15,24,0.96))] p-3 sm:p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative grid h-[66px] w-[66px] shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#38bdf8,#2563eb,#22c55e)] p-[2px] shadow-[0_0_28px_rgba(56,189,248,0.28)]"><div className="h-full w-full overflow-hidden rounded-full bg-[#101827]"><PlayerHeadshot sport={player.sport} name={player.name} providerPlayerId={player.playerId} team={team}/></div><span className="absolute -bottom-1 -right-1 rounded-full border border-slate-700 bg-[#111827] px-1.5 py-0.5 text-[9px] font-black text-sky-300">{sportName(player.sport)}</span></div>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-black tracking-tight text-white sm:text-2xl">{player.name}</h1><span className="rounded-md border border-slate-700 bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-black text-slate-400">{position}</span></div><p className="mt-1 text-xs font-semibold text-slate-400">{game} · {kickoffLabel(player.startsAt)}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span>{team || history?.player?.team || 'Team unavailable'}</span>{analysis.loading ? <><span>•</span><span>Loading history…</span></> : analysis.unavailable ? <><span>•</span><span className="text-amber-300">History unavailable</span></> : <><span>•</span><span className="text-emerald-400">Verified history</span></>}</div></div>
            </div>
            <button type="button" onClick={onFavourite} disabled={!canFollow} aria-pressed={favourite} className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition ${favourite ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white'}`}><Star className={`h-3.5 w-3.5 ${favourite ? 'fill-current' : ''}`}/>{favourite ? 'Watching' : 'Add to Watchlist'}</button>
          </div>
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.07] p-2.5 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-2"><span className="rounded-md bg-sky-500 px-2 py-1 text-[10px] font-black tracking-wide text-white">{initials(selected.bookName)}</span><div className="min-w-0"><div className="truncate text-xs font-bold text-white sm:text-sm">{title}</div><div className="text-[10px] text-slate-500">Main prop · {period}</div></div></div><div className="flex items-center gap-2 text-sm font-black"><span className={selected.side === 'UNDER' ? 'text-rose-400' : 'text-emerald-400'}>{selected.side === 'OVER' ? 'O' : selected.side === 'UNDER' ? 'U' : selected.choice} {selected.line ?? ''}</span><span className="text-slate-400">{offerPrice(selected)}</span></div></div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{statFamilies.map(item => { const active = marketFamily(item) === family; return <button key={marketFamily(item)} type="button" onClick={() => chooseStat(item)} aria-pressed={active} title={marketName(item)} className={`h-9 shrink-0 rounded-lg border px-3 text-[11px] font-black tracking-wide transition ${active ? 'border-sky-400/50 bg-sky-500/15 text-sky-300 shadow-[0_0_20px_rgba(56,189,248,0.16)]' : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:border-slate-700 hover:text-slate-300'}`}>{compactStatLabel(marketName(item))}</button>; })}</div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{periodMarkets.map(item => { const active = item.key === market.key; return <button key={item.key} type="button" onClick={() => onCategory(item.key)} aria-pressed={active} className={`h-8 shrink-0 rounded-full border px-3 text-[10px] font-bold transition ${active ? 'border-blue-400/40 bg-blue-500 text-white shadow-[0_0_18px_rgba(59,130,246,0.24)]' : 'border-slate-800 bg-[#0e1522] text-slate-500 hover:text-slate-300'}`}>{periodName(item.period)}</button>; })}</div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SelectFilter label="Opponent" value={opponentFilter} options={opponentOptions} onChange={setOpponentFilter}/>
            <SelectFilter label="Season" value={seasonFilter} options={seasonOptions} onChange={setSeasonFilter}/>
            <SelectFilter label="Home/Away" value={venueFilter} options={[{value:'all',label:'All'},{value:'home',label:'Home'},{value:'away',label:'Away'}]} onChange={setVenueFilter}/>
            <SelectFilter label="Team" value={teamFilter} options={teamOptions} onChange={setTeamFilter}/>
            <SelectFilter label="Book" value={bookFilter} options={bookOptions} onChange={chooseBook}/>
            <button type="button" aria-label="Toggle research filter details" aria-pressed={showFilters} onClick={() => setShowFilters(value => !value)} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border bg-slate-900/80 transition ${showFilters ? 'border-sky-500/50 text-sky-300' : 'border-slate-700/80 text-slate-400 hover:text-white'}`}><SlidersHorizontal className="h-4 w-4"/></button>
          </div>
          {showFilters && <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[10px] leading-5 text-slate-500">Filters only recalculate from verified returned games. {history?.coverage?.seasonComplete === true ? 'Season coverage is reported complete.' : 'Season coverage may be partial.'} Missing or conflicting records stay unavailable.</div>}
        </div>

        <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-3"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Target line</div><div className="mt-2 grid grid-cols-[44px_1fr_44px] overflow-hidden rounded-xl border border-slate-700 bg-slate-950/70"><button type="button" onClick={() => setTargetLine(value => Math.max(0, round1(value - 0.5)))} className="grid h-12 place-items-center border-r border-slate-800 text-slate-400 transition hover:bg-slate-900 hover:text-white" aria-label="Lower target line"><Minus className="h-4 w-4"/></button><div className="grid h-12 place-items-center text-xl font-black tabular-nums text-white">{targetLine.toFixed(1)}</div><button type="button" onClick={() => setTargetLine(value => round1(value + 0.5))} className="grid h-12 place-items-center border-l border-slate-800 text-slate-400 transition hover:bg-slate-900 hover:text-white" aria-label="Raise target line"><Plus className="h-4 w-4"/></button></div><div className="mt-2 flex items-center justify-between rounded-lg bg-slate-950/60 px-2.5 py-2 text-[10px]"><span className="font-bold text-slate-300">{selected.bookName}</span><div className="flex gap-2 font-black tabular-nums"><span className="text-emerald-400">O {offerPrice(selectedPair.over)}</span><span className="text-rose-400">U {offerPrice(selectedPair.under)}</span></div></div></div>
          <div className="grid grid-cols-5 overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1420]">{windowRows.map((item, index) => <div key={item.id} className={`min-w-0 px-1.5 py-3 text-center sm:px-3 ${index !== windowRows.length - 1 ? 'border-r border-slate-800' : ''}`}><div className="truncate text-[9px] font-bold uppercase tracking-wide text-slate-500 sm:text-[10px]">{item.label}</div>{item.id === 'h2h' && <div className="mt-0.5 truncate text-[8px] text-slate-600 sm:text-[9px]">{currentOpponent ? `vs ${currentOpponent}` : 'No opponent'}</div>}<div className={`mt-1 text-base font-black tabular-nums sm:text-xl ${item.hitRate !== null && item.hitRate >= 60 ? 'text-emerald-400' : 'text-slate-200'}`}>{item.hitRate === null ? '—' : `${item.hitRate}%`}</div><div className="mt-1 truncate text-[8px] text-slate-500 sm:text-[10px]">Avg {item.average === null ? '—' : item.average}</div></div>)}</div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4" id="analysis-chart">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Flame className="h-4 w-4 text-orange-400"/><h2 className="text-sm font-black text-white sm:text-base">Last 15 Games – {title}</h2></div><p className="mt-1 text-[10px] text-slate-500">Current target: {targetLine.toFixed(1)} · {period}</p></div><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-400 sm:text-[10px]"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#22c55e]"/>Over</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#f43f5e]"/>Under</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm border border-slate-500 bg-slate-800"/>DNP</span><span className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-amber-400"/>Prop Line</span></div></div>
          {analysis.loading ? <div className="grid h-[310px] place-items-center text-sm text-slate-500">Loading verified game history…</div> : analysis.unavailable ? <div className="grid h-[310px] place-items-center px-6 text-center text-sm text-slate-500">{analysis.unavailable}</div> : chartRows.length === 0 ? <div className="grid h-[310px] place-items-center text-sm text-slate-500">No verified games match these filters.</div> : <div className="mt-4 h-[310px] w-full sm:h-[340px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} margin={{top:26,right:14,left:-18,bottom:26}} barCategoryGap="18%"><defs><pattern id={`dnpHatch-${patternId}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#111827"/><line x1="0" y1="0" x2="0" y2="6" stroke="#64748b" strokeWidth="2"/></pattern></defs><CartesianGrid stroke="#1e293b" vertical={false} strokeDasharray="3 3"/><XAxis dataKey="chartKey" tickLine={false} axisLine={{stroke:'#263244'}} interval={0} height={46} tick={({x,y,index}) => { const row=chartRows[index]; return <g transform={`translate(${x},${y})`}><text x={0} y={13} textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="700">{row?.displayDate}</text><text x={0} y={26} textAnchor="middle" fill="#475569" fontSize="8">{row?.isHome === false ? '@' : 'vs'}{text(row?.opponent)}</text></g>; }}/><YAxis domain={[0,yMax]} tickLine={false} axisLine={false} tick={{fill:'#64748b',fontSize:9}}/><Tooltip cursor={{fill:'rgba(30,41,59,0.22)'}} content={<ChartTooltip line={targetLine} marketLabel={title}/>}/><ReferenceLine y={targetLine} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="6 5" label={{value:targetLine.toFixed(1),position:'insideTopRight',fill:'#fbbf24',fontSize:10,fontWeight:800}}/><Bar dataKey="chartValue" radius={[5,5,2,2]} maxBarSize={30} isAnimationActive={false}>{chartRows.map(row => { const value=finite(row.value); const dnp=row.dnp===true||row.didNotPlay===true||value===null; const fill=dnp?`url(#dnpHatch-${patternId})`:value>targetLine?'#22c55e':value<targetLine?'#f43f5e':'#94a3b8'; return <Cell key={row.chartKey} fill={fill}/>; })}<LabelList dataKey="chartValue" content={renderBarLabel}/></Bar></BarChart></ResponsiveContainer></div>}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4"><div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Supporting stats</div><div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-800 sm:grid-cols-4">{supportRows.map((stat, index) => <div key={stat.label} className={`bg-slate-950/40 px-3 py-3 ${index < supportRows.length - 1 ? 'sm:border-r sm:border-slate-800' : ''} ${index < 2 ? 'border-b border-slate-800 sm:border-b-0' : ''}`}><div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{stat.label}</div><div className="mt-1 text-lg font-black tabular-nums text-white">{formatMetric(stat.value)}</div></div>)}</div></div>

        <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">Sportsbook Prices</h3><p className="mt-0.5 text-[10px] text-slate-500">Exact posted quotes at {targetLine.toFixed(1)} {title.toLowerCase()}</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[9px] font-black text-emerald-300">{booksShown.length} BOOK{booksShown.length === 1 ? '' : 'S'}</span></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{booksShown.map(book => { const pair=pricePair(market,book.key,targetLine); const base=pair.over||pair.under; const active=book.key===selected.book; return <div key={book.key} className={`rounded-xl border p-2.5 transition ${active?'border-sky-500/40 bg-sky-500/[0.06]':'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}><button type="button" disabled={!base} onClick={() => base && onOffer(base)} className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"><span className="truncate text-[11px] font-black text-white">{book.name}</span><span className="rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-black text-slate-400">{initials(book.name)}</span></button><div className="mt-2 grid grid-cols-2 gap-1.5"><button type="button" disabled={!pair.over} onClick={() => pair.over && onOffer(pair.over)} className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] px-2 py-2 text-left disabled:opacity-45"><div className="text-[8px] font-bold uppercase text-emerald-500/80">Over</div><div className="mt-0.5 text-sm font-black tabular-nums text-emerald-400">{offerPrice(pair.over)}</div></button><button type="button" disabled={!pair.under} onClick={() => pair.under && onOffer(pair.under)} className="rounded-lg border border-rose-400/15 bg-rose-400/[0.06] px-2 py-2 text-left disabled:opacity-45"><div className="text-[8px] font-bold uppercase text-rose-500/80">Under</div><div className="mt-0.5 text-sm font-black tabular-nums text-rose-400">{offerPrice(pair.under)}</div></button></div>{!base && <div className="mt-2 text-[9px] text-slate-600">No quote at this target</div>}</div>; })}</div></div>

        <button type="button" onClick={() => setShowFullResearch(value => !value)} aria-expanded={showFullResearch} className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-500 text-sm font-black text-white shadow-[0_10px_32px_rgba(37,99,235,0.22)] transition hover:brightness-110">{showFullResearch ? 'Hide Full Research' : 'View Full Research'}<ArrowRight className={`h-4 w-4 transition-transform ${showFullResearch ? 'rotate-90' : 'group-hover:translate-x-1'}`}/></button>

        {showFullResearch && <div className="space-y-4 rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4" id="full-research"><div>{research}</div>{supporting && <div>{supporting}</div>}{analysisSections}{quoteHistory}{gameLog}<section className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Model choice</div>{model}</section></div>}
      </div>
    </div>
  </section>;
}