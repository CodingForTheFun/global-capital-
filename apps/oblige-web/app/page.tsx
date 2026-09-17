'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  Cpu,
  Layers3,
  LineChart,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/motion';

const LIVE_TICKER_PROPS = [
  { player: 'Patrick Mahomes', sport: 'NFL', team: 'KC', market: 'Pass Yds', line: 265.5, pick: 'OVER', odds: '-108', book: 'FanDuel', hitRate: '80% L5', ev: '+6.4% EV', ai: '284.2' },
  { player: 'Nikola Jokić', sport: 'NBA', team: 'DEN', market: 'Pts+Reb+Ast', line: 48.5, pick: 'OVER', odds: '-112', book: 'DraftKings', hitRate: '80% L10', ev: '+7.8% EV', ai: '52.4' },
  { player: 'Shohei Ohtani', sport: 'MLB', team: 'LAD', market: 'Total Bases', line: 1.5, pick: 'OVER', odds: '+118', book: 'Caesars', hitRate: '70% L10', ev: '+9.2% EV', ai: '2.2' },
  { player: 'Tyreek Hill', sport: 'NFL', team: 'MIA', market: 'Rec Yds', line: 72.5, pick: 'OVER', odds: '-110', book: 'BetMGM', hitRate: '75% L20', ev: '+5.1% EV', ai: '85.0' },
  { player: 'Connor McDavid', sport: 'NHL', team: 'EDM', market: 'Points', line: 1.5, pick: 'OVER', odds: '-115', book: 'PrizePicks', hitRate: '80% L10', ev: '+6.0% EV', ai: '2.1' },
];

const FEATURES = [
  {
    icon: BrainCircuit,
    title: 'Grounded Predictive Intelligence',
    body: 'Algorithmic projections and research insights calibrated against verified game logs and historical distributions — no hallucinations, no black-box guesses.',
    tag: 'Predictive Modeling',
  },
  {
    icon: LineChart,
    title: 'Understand the line, not just the number',
    body: 'See the context around a prop — recent performance, movement, matchup history, and the market consensus behind the current line.',
    tag: 'Line Movement',
  },
  {
    icon: Layers3,
    title: 'Compare 9+ sportsbooks at a glance',
    body: 'Instant multi-book matrix (DraftKings, FanDuel, BetMGM, Caesars, Underdog, PrizePicks) showing real quotes, arbitrage, and the best available price.',
    tag: 'Market Arbitrage',
  },
  {
    icon: BarChart3,
    title: 'Visual hit rates & split analytics',
    body: 'L5, L10, L20 hit-rate windows, home/away splits, opponent ranks, and game log distribution charts designed to be scanned in seconds.',
    tag: 'Visual Data',
  },
  {
    icon: ShieldCheck,
    title: 'Missing data stays honest',
    body: 'When a verified sample is not available, Oblige says so plainly. The interface never fabricates percentages, box scores, or odds history.',
    tag: 'Fail-Closed Truth',
  },
  {
    icon: Smartphone,
    title: 'Ultra-fast native mobile terminal',
    body: 'Touch-optimized controls, dense tables, dynamic auto-hiding scroll navigation, and instant keyboard shortcuts (⌘K) built for game day.',
    tag: 'Mobile & Desktop',
  },
];

const SHOWCASE_PROPS = [
  {
    id: 'mahomes',
    player: 'Patrick Mahomes',
    team: 'KC',
    pos: 'QB',
    sport: 'NFL',
    matchup: 'KC vs LV · Sunday 4:25 PM',
    market: 'Passing Yards',
    line: 265.5,
    l5: '80%',
    l10: '70%',
    l20: '75%',
    games: [291, 274, 305, 249, 281, 262, 298, 312, 255, 288],
    bestOver: { price: '-108', book: 'FanDuel' },
    bestUnder: { price: '-105', book: 'DraftKings' },
    books: [
      { name: 'FanDuel', line: 265.5, over: '-108', under: '-118', best: 'over' },
      { name: 'DraftKings', line: 265.5, over: '-112', under: '-105', best: 'under' },
      { name: 'BetMGM', line: 266.5, over: '-115', under: '-110' },
      { name: 'Caesars', line: 265.5, over: '-114', under: '-112' },
      { name: 'PrizePicks', line: 265.5, over: 'MORE', under: 'LESS' },
    ],
    ai: {
      model: 'PropLine Adaptive Model',
      projection: 284.2,
      probabilityOver: '64.8%',
      ev: '+6.4%',
      lean: 'OVER LEAN',
      summary: 'LV ranks 28th in pass rush win rate (31%). Mahomes averages 287.4 YDS in dome/retractable matchups.',
    },
  },
  {
    id: 'jokic',
    player: 'Nikola Jokić',
    team: 'DEN',
    pos: 'C',
    sport: 'NBA',
    matchup: 'DEN @ LAL · Tonight 10:00 PM',
    market: 'Points + Rebounds + Assists',
    line: 48.5,
    l5: '100%',
    l10: '80%',
    l20: '80%',
    games: [54, 49, 58, 46, 52, 61, 47, 53, 50, 56],
    bestOver: { price: '-112', book: 'DraftKings' },
    bestUnder: { price: '+102', book: 'BetMGM' },
    books: [
      { name: 'DraftKings', line: 48.5, over: '-112', under: '-112', best: 'over' },
      { name: 'FanDuel', line: 49.5, over: '-110', under: '-115' },
      { name: 'BetMGM', line: 48.5, over: '-120', under: '+102', best: 'under' },
      { name: 'Caesars', line: 48.5, over: '-118', under: '-108' },
      { name: 'Underdog', line: 48.5, over: 'HIGHER', under: 'LOWER' },
    ],
    ai: {
      model: 'PropLine Adaptive Model',
      projection: 52.4,
      probabilityOver: '68.2%',
      ev: '+7.8%',
      lean: 'OVER LEAN',
      summary: 'Usage rises to 34.2% against drop-coverage defenses. Averaging 14.8 rebound chances vs LA frontcourt.',
    },
  },
  {
    id: 'ohtani',
    player: 'Shohei Ohtani',
    team: 'LAD',
    pos: 'DH',
    sport: 'MLB',
    matchup: 'LAD @ SD · Tomorrow 7:10 PM',
    market: 'Total Bases',
    line: 1.5,
    l5: '80%',
    l10: '70%',
    l20: '70%',
    games: [3, 2, 0, 4, 2, 1, 3, 2, 0, 4],
    bestOver: { price: '+118', book: 'Caesars' },
    bestUnder: { price: '-145', book: 'FanDuel' },
    books: [
      { name: 'Caesars', line: 1.5, over: '+118', under: '-148', best: 'over' },
      { name: 'DraftKings', line: 1.5, over: '+110', under: '-140' },
      { name: 'FanDuel', line: 1.5, over: '+114', under: '-145', best: 'under' },
      { name: 'BetMGM', line: 1.5, over: '+112', under: '-142' },
      { name: 'PrizePicks', line: 1.5, over: 'MORE', under: 'LESS' },
    ],
    ai: {
      model: 'PropLine Adaptive Model',
      projection: 2.2,
      probabilityOver: '56.4%',
      ev: '+9.2%',
      lean: 'OVER LEAN',
      summary: '.412 xwOBA against right-handed sliders; starting pitcher relying on secondary pitches in 42% of counts.',
    },
  },
];

const PLANS = [
  {
    name: 'Free Look',
    price: '$0',
    per: '',
    highlight: false,
    cta: 'Start Free',
    description: 'Essential real-time prop browsing and basic sample hit rates.',
    features: [
      'One active league',
      'Last 5 games verified history',
      'Two sportsbook quotes compared',
      '5-minute market refresh',
      'Standard search & filtering',
    ],
  },
  {
    name: 'Season Pass',
    price: '$29',
    per: '/mo',
    highlight: true,
    cta: 'Open Pro Terminal',
    description: 'The full intelligence workspace for daily prop researchers.',
    features: [
      'Every major league (NFL, NBA, MLB, NHL, WNBA, College)',
      'Full verified history (L5, L10, L20, Season, H2H)',
      '9+ sportsbooks compared with EV calculations',
      'PropLine predictive model projections & analytics',
      'Real-time streaming odds with line movement timeline',
      'Custom prop slips and saved cross-device filters',
    ],
  },
  {
    name: 'Full Season',
    price: '$199',
    per: '/yr',
    highlight: false,
    cta: 'Get Annual Pass',
    description: 'Maximum value with early access to proprietary model releases.',
    features: [
      'Everything in Season Pass',
      'Two months free ($149 total savings)',
      'Priority WebSocket streaming allocation',
      'Early access to new sports, leagues & ML models',
      'Direct Discord and email support with developers',
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="premium-landing">
      {/* Live Market Bar */}
      <div className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(6,9,18,0.85)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[var(--maxw)] items-center gap-3 overflow-x-auto px-4 py-2 text-xs scrollbar-none">
          <div className="flex shrink-0 items-center gap-1.5 font-bold uppercase tracking-wider text-[#3DE8A8]">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3DE8A8] opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-[#3DE8A8]" />
            </span>
            Live Board:
          </div>
          <div className="flex shrink-0 items-center gap-4 text-[12px] text-[#A9B6CA]">
            {LIVE_TICKER_PROPS.map((item, idx) => (
              <Link
                key={`${item.player}-${idx}`}
                href="/board"
                className="group flex items-center gap-2 rounded-md border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-2.5 py-1 transition hover:border-[rgba(61,232,168,0.3)] hover:bg-[rgba(61,232,168,0.06)]"
              >
                <span className="font-semibold text-white group-hover:text-[#3DE8A8]">{item.player}</span>
                <span className="font-mono text-[11px] text-[#6F7E95]">{item.market} {item.line}</span>
                <span className="rounded bg-[rgba(61,232,168,0.15)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#3DE8A8]">
                  {item.pick} {item.odds} ({item.book})
                </span>
                <span className="font-mono text-[10px] font-semibold text-[#818CF8]">{item.ev}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <section className="premium-hero">
        <div className="premium-shell premium-hero-grid">
          <div>
            <Reveal>
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(61,232,168,0.25)] bg-[rgba(61,232,168,0.08)] px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-[#3DE8A8]">
                <Cpu className="size-3.5 text-[#3DE8A8]" />
                <span>PropLine Realtime Intelligence Engine</span>
              </div>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="premium-title">
                Stop staring at a line.
                <br />
                <span>Understand why it moved.</span>
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="premium-lede">
                The high-performance prop terminal for serious sports bettors. Stream live market odds across 9+ sportsbooks, inspect verified hit-rate distributions, and unlock grounded predictive model projections.
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div className="premium-actions flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="h-12 rounded-xl bg-[#3DE8A8] px-6 font-bold text-[#04150E] shadow-[0_0_30px_rgba(61,232,168,0.35)] hover:bg-[#2fe09b]">
                  <Link href="/board">
                    Open Research Terminal
                    <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="ghost" className="h-12 rounded-xl border border-[rgba(255,255,255,0.1)] px-5 text-white hover:bg-[rgba(255,255,255,0.06)]">
                  <Link href="/research">
                    <BarChart3 className="mr-2 size-4 text-[#818CF8]" />
                    Player Analytics
                  </Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-2 text-xs text-[#8A99AD]">
                <span className="text-xs font-semibold text-white/50">Jump to league:</span>
                {['NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'NCAAF'].map((sport) => (
                  <Link
                    key={sport}
                    href={`/board?sport=${sport}`}
                    className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 font-mono text-[11px] font-bold text-[#A9B6CA] transition hover:border-[#3DE8A8] hover:text-[#3DE8A8]"
                  >
                    {sport}
                  </Link>
                ))}
              </div>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <InteractiveProductPreview />
          </Reveal>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="premium-section">
        <div className="premium-shell">
          <Reveal>
            <div className="premium-section-head">
              <span className="premium-eyebrow">Institutional-Grade Architecture</span>
              <h2>Built like a Bloomberg terminal for player props.</h2>
              <p>
                Dense information hierarchy, zero fabricated numbers, real-time WebSocket feeds, and predictive model intelligence that cites its sources directly from measured game logs.
              </p>
            </div>
          </Reveal>

          <div className="premium-feature-grid">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={Math.min(index * 50, 250)}>
                <article className="premium-feature-card group relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[rgba(61,232,168,0.35)] hover:shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_30px_rgba(61,232,168,0.08)]">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-[#3DE8A8] transition group-hover:border-[#3DE8A8]/30 group-hover:bg-[#3DE8A8]/10">
                      <feature.icon className="size-5" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[#818CF8]">
                      {feature.tag}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-white transition group-hover:text-[#3DE8A8]">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#8F9FB5]">{feature.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow Section */}
      <section className="premium-section border-y border-[var(--line)] bg-[rgba(3,5,12,0.48)]">
        <div className="premium-shell grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <Reveal>
            <div className="premium-section-head !mb-0">
              <span className="premium-eyebrow">End-to-End Execution</span>
              <h2>Board → Player → Model → Market → Bet Slip.</h2>
              <p>
                No fragmented tabs. No waiting on slow dashboards. Filter the live board, launch the AI model projection, examine historical hit rates, and find the off-market sportsbook in a unified workflow.
              </p>
              <div className="mt-6">
                <Button asChild className="rounded-xl bg-[#818CF8] px-5 font-bold text-white shadow-[0_0_25px_rgba(129,140,248,0.3)] hover:bg-[#6f7ae8]">
                  <Link href="/board">
                    Explore Live Terminal Now
                    <ChevronRight className="ml-1 size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  number: '01',
                  title: 'Filter & Scan the Board',
                  body: 'Screen thousands of live player props by league, market, EV edge, or specific sportsbook quotes.',
                  accent: 'text-[#3DE8A8]',
                },
                {
                  number: '02',
                  title: 'PropLine Model Projection',
                  body: 'Get instant algorithmic projections with calculated win probabilities and value delta.',
                  accent: 'text-[#60A5FA]',
                },
                {
                  number: '03',
                  title: 'Audit Verified Sample Rates',
                  body: 'Inspect L5, L10, L20 hit distributions and head-to-head records against the exact current line.',
                  accent: 'text-[#818CF8]',
                },
                {
                  number: '04',
                  title: 'Capture Best Price & Slip',
                  body: 'Instantly spot sportsbook discrepancies (e.g. -105 vs -125) and lock selections into your active slip.',
                  accent: 'text-[#F59E0B]',
                },
              ].map(({ number, title, body, accent }) => (
                <div
                  key={number}
                  className="rounded-2xl border border-[rgba(255,255,255,0.07)] bg-[linear-gradient(160deg,rgba(18,24,44,0.7),rgba(8,12,24,0.8))] p-5 shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-sm font-black ${accent}`}>{number}</span>
                    <Sparkles className="size-3.5 text-white/20" />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-white">{title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#8F9FB5]">{body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="premium-section scroll-mt-24">
        <div className="premium-shell">
          <Reveal>
            <div className="premium-section-head text-center mx-auto">
              <span className="premium-eyebrow justify-center">Transparent Membership</span>
              <h2>Designed for the edge that pays for itself.</h2>
              <p className="mx-auto max-w-xl">
                Get full access to live streaming multi-book odds, verified hit-rate windows, and PropLine predictive model projections.
              </p>
            </div>
          </Reveal>

          <div className="mt-10 grid items-stretch gap-6 md:grid-cols-3">
            {PLANS.map((plan, index) => (
              <Reveal key={plan.name} delay={index * 70}>
                <article
                  className={[
                    'relative flex h-full flex-col justify-between rounded-[24px] border p-6 md:p-8',
                    'bg-[linear-gradient(160deg,rgba(18,24,46,0.85),rgba(7,10,22,0.92))]',
                    'shadow-[0_20px_64px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.04)]',
                    plan.highlight
                      ? 'border-[#3DE8A8]/60 shadow-[0_24px_90px_rgba(61,232,168,0.18),inset_0_1px_0_rgba(61,232,168,0.2)]'
                      : 'border-[rgba(255,255,255,0.09)]',
                  ].join(' ')}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full border border-[#3DE8A8]/40 bg-[#071F17] px-4 py-1 text-[11px] font-black uppercase tracking-wider text-[#3DE8A8] shadow-lg">
                      ⚡ Most Popular Choice
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-bold text-white">{plan.name}</div>
                      {plan.highlight && <Zap className="size-4 text-[#3DE8A8]" />}
                    </div>
                    <p className="mt-2 min-h-10 text-xs text-[#8F9FB5]">{plan.description}</p>
                    <div className="mt-5 flex items-baseline gap-1.5 border-b border-[rgba(255,255,255,0.07)] pb-5">
                      <b className="font-mono text-4xl font-extrabold tracking-tight text-white">{plan.price}</b>
                      <span className="text-sm font-semibold text-[#6F7E95]">{plan.per}</span>
                    </div>

                    <ul className="mt-6 grid list-none gap-3 p-0">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-2.5 text-xs leading-relaxed text-[#B8C6DA]">
                          <Check className="mt-0.5 size-4 shrink-0 text-[#3DE8A8]" strokeWidth={2.4} aria-hidden="true" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-8">
                    <Button
                      asChild
                      className={`h-11 w-full rounded-xl font-bold transition ${
                        plan.highlight
                          ? 'bg-[#3DE8A8] text-[#04150E] hover:bg-[#34d498]'
                          : 'border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-white hover:bg-[rgba(255,255,255,0.08)]'
                      }`}
                    >
                      <Link href="/board">{plan.cta}</Link>
                    </Button>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function InteractiveProductPreview() {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [selectedSide, setSelectedSide] = React.useState<'OVER' | 'UNDER'>('OVER');
  const prop = SHOWCASE_PROPS[selectedIdx];

  const maxValue = Math.max(...prop.games, prop.line * 1.25);

  return (
    <div className="relative rounded-[26px] border border-[rgba(61,232,168,0.25)] bg-[linear-gradient(165deg,rgba(14,20,38,0.96),rgba(6,9,18,0.98))] p-5 shadow-[0_32px_100px_rgba(0,0,0,0.6),0_0_50px_rgba(61,232,168,0.08)]">
      {/* Top bar with status and player tabs */}
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] pb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3DE8A8] opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[#3DE8A8]" />
          </span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#3DE8A8]">
            Live Terminal
          </span>
        </div>

        {/* Player tabs */}
        <div className="flex rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-0.5">
          {SHOWCASE_PROPS.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                selectedIdx === idx
                  ? 'bg-[#3DE8A8] text-[#04150E] shadow-sm'
                  : 'text-[#7D8FA4] hover:text-white'
              }`}
            >
              {p.player.split(' ')[1]}
            </button>
          ))}
        </div>
      </div>

      {/* Player Header */}
      <div className="mt-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-[#9AB0C9]">
              {prop.sport} · {prop.team}
            </span>
            <span className="text-xs text-[#6F7E95]">{prop.matchup}</span>
          </div>
          <h3 className="mt-1 text-xl font-black text-white">{prop.player}</h3>
          <p className="font-mono text-xs font-semibold text-[#3DE8A8]">
            {prop.market} · Line: <span className="text-base text-white">{prop.line}</span>
          </p>
        </div>

        <div className="text-right">
          <div className="font-mono text-xs font-bold text-[#818CF8]">L10 Hit Rate</div>
          <div className="font-mono text-2xl font-black text-[#3DE8A8]">{prop.l10}</div>
          <div className="text-[10px] text-[#6F7E95]">L5: {prop.l5} · L20: {prop.l20}</div>
        </div>
      </div>

      {/* PropLine Model Intelligence Card */}
      <div className="mt-4 rounded-xl border border-[rgba(129,140,248,0.3)] bg-[linear-gradient(135deg,rgba(129,140,248,0.1),rgba(61,232,168,0.05))] p-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-[#818CF8]" />
            <span className="font-mono text-[11px] font-extrabold uppercase tracking-wide text-[#C5CCFF]">
              {prop.ai.model}
            </span>
          </div>
          <span className="rounded-full bg-[#3DE8A8]/20 px-2 py-0.5 font-mono text-[10px] font-black text-[#3DE8A8]">
            {prop.ai.ev} Edge
          </span>
        </div>

        <div className="mt-2.5 flex items-center justify-between border-y border-[rgba(255,255,255,0.06)] py-2 text-xs">
          <div>
            <span className="text-[10px] text-[#7E8DA5]">Projected Line</span>
            <div className="font-mono text-base font-extrabold text-white">{prop.ai.projection}</div>
          </div>
          <div>
            <span className="text-[10px] text-[#7E8DA5]">Over Probability</span>
            <div className="font-mono text-base font-extrabold text-[#3DE8A8]">{prop.ai.probabilityOver}</div>
          </div>
          <div>
            <span className="text-[10px] text-[#7E8DA5]">Model Stance</span>
            <div className="font-mono text-base font-extrabold text-[#60A5FA]">{prop.ai.lean}</div>
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-[#A9B8CE]">
          &ldquo;{prop.ai.summary}&rdquo;
        </p>
      </div>

      {/* Recent Game Log Histogram */}
      <div className="mt-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-[#8F9FB5]">Last 10 Games vs Line ({prop.line})</span>
          <span className="font-mono text-[10px] text-[#6F7E95]">Green = Over Hit</span>
        </div>

        <div className="mt-3 flex h-24 items-end gap-1.5 pt-4">
          {prop.games.map((val, idx) => {
            const hit = val > prop.line;
            const heightPct = Math.min(100, Math.max(15, (val / maxValue) * 100));
            return (
              <div key={idx} className="group relative flex flex-1 flex-col items-center">
                <span className="absolute -top-5 hidden font-mono text-[9px] font-bold text-white group-hover:block">
                  {val}
                </span>
                <div
                  style={{ height: `${heightPct}%` }}
                  className={`w-full rounded-t transition-all ${
                    hit
                      ? 'bg-gradient-to-t from-[#0E3D2E] to-[#3DE8A8] shadow-[0_0_10px_rgba(61,232,168,0.3)]'
                      : 'bg-gradient-to-t from-[#3E1620] to-[#FF6B6B]'
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Sportsbook Odds Comparison */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] font-bold text-[#8F9FB5]">
          <span>Multi-Book Pricing Matrix</span>
          <span className="text-[#3DE8A8]">Best Over: {prop.bestOver.price} ({prop.bestOver.book})</span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {prop.books.map((b) => (
            <div
              key={b.name}
              className={`rounded-lg border p-2 text-center transition ${
                b.best
                  ? 'border-[#3DE8A8]/40 bg-[#3DE8A8]/10'
                  : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]'
              }`}
            >
              <div className="text-[10px] font-bold text-[#8F9FB5]">{b.name}</div>
              <div className="mt-1 font-mono text-xs font-bold text-white">{b.over}</div>
              <div className="text-[9px] text-[#6F7E95]">U: {b.under}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Inside Preview */}
      <div className="mt-4 flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-3">
        <span className="flex items-center gap-1.5 text-[11px] text-[#7E8DA5]">
          <Sparkles className="size-3 text-[#3DE8A8]" />
          Full terminal has 1,400+ live player markets
        </span>
        <Link
          href={`/board?sport=${prop.sport}`}
          className="flex items-center gap-1 font-mono text-xs font-bold text-[#3DE8A8] hover:underline"
        >
          Research {prop.sport} Props
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
