import Link from 'next/link';
import {
  BarChart3,
  Check,
  Layers3,
  LineChart,
  Search,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/motion';
import { LandingBoardPreview } from '@/components/landing-board-preview';

const FEATURES = [
  {
    icon: LineChart,
    title: 'Understand the line, not just the number',
    body: 'See the context around a prop — recent performance, movement, matchup history and the market behind the current line.',
  },
  {
    icon: Layers3,
    title: 'Compare books without tab hopping',
    body: 'Bring available sportsbook pricing into one research surface so the best side and the market disagreement are easier to read.',
  },
  {
    icon: BarChart3,
    title: 'Research that stays visual',
    body: 'Hit-rate windows, trends and game logs are designed to be scanned quickly on a phone without losing the detail you want on desktop.',
  },
  {
    icon: Search,
    title: 'Get from board to player fast',
    body: 'Search, filter and open a player directly into the deeper research view instead of digging through disconnected pages.',
  },
  {
    icon: ShieldCheck,
    title: 'Missing data stays honest',
    body: 'When a verified sample is not available, Oblige says so. The interface does not invent percentages, history or sportsbook data.',
  },
  {
    icon: Smartphone,
    title: 'Made to feel native on mobile',
    body: 'Touch-sized controls, dense cards, sticky navigation and responsive layouts make the product feel intentional on a phone, not squeezed down.',
  },
];

const PLANS = [
  {
    name: 'Free look',
    price: '$0',
    per: '',
    highlight: false,
    cta: 'Start free',
    features: ['One league', 'Last five games of history', 'Two books priced', 'Five minute refresh'],
  },
  {
    name: 'Season pass',
    price: '$29',
    per: '/mo',
    highlight: true,
    cta: 'Open the board',
    features: [
      'Every league on the board',
      'Full history when available',
      'Every book we track',
      'Sixty second refresh',
      'Home, away and head-to-head splits',
      'Saved filters across devices',
    ],
  },
  {
    name: 'Full season',
    price: '$199',
    per: '/yr',
    highlight: false,
    cta: 'Get the year',
    features: ['Everything in Season pass', 'Two months free', 'Priority support', 'Early access to new leagues'],
  },
];

export default function LandingPage() {
  return (
    <div className="premium-landing">
      <section className="premium-hero premium-hero-v2">
        <div className="premium-shell premium-hero-grid">
          <div className="premium-hero-copy">
            <Reveal>
              <span className="premium-eyebrow">Live markets · built for research</span>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="premium-title premium-title-v2">
                Find the edge
                <br />
                <span>before the line moves.</span>
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="premium-lede premium-lede-v2">
                Live props, multi-book line shopping, player history and model signals — all in one focused research workspace.
              </p>
            </Reveal>

            <Reveal delay={170}>
              <div className="premium-sports-strip" aria-label="Sports available in Oblige Props">
                {['NFL', 'MLB', 'NCAAF', 'WNBA', 'Soccer', 'Esports'].map((sport) => (
                  <span key={sport}>{sport}</span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={220}>
              <div className="premium-proof premium-proof-v2" aria-label="Product capabilities">
                <span>Live lines</span>
                <span>Player history</span>
                <span>Multi-book</span>
                <span>Model signals</span>
              </div>
            </Reveal>
          </div>

          <Reveal delay={180}>
            <LandingBoardPreview />
          </Reveal>
        </div>
      </section>

      <section className="premium-section">
        <div className="premium-shell">
          <Reveal>
            <div className="premium-section-head">
              <span className="premium-eyebrow">Built for decisions</span>
              <h2>A research experience that feels like a product, not a spreadsheet.</h2>
              <p>
                The information stays dense, but the hierarchy does the work. The line, the trend, the books and the player context should be obvious before you ever have to hunt for them.
              </p>
            </div>
          </Reveal>

          <div className="premium-feature-grid">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={Math.min(index * 55, 260)}>
                <article className="premium-feature-card">
                  <span className="premium-feature-icon">
                    <feature.icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="premium-section border-y border-[var(--line)] bg-[rgba(3,5,12,.38)]">
        <div className="premium-shell grid gap-8 lg:grid-cols-[.85fr_1.15fr] lg:items-center">
          <Reveal>
            <div className="premium-section-head !mb-0">
              <span className="premium-eyebrow">One connected workflow</span>
              <h2>Board → player → market → history → books.</h2>
              <p>
                No dead-end drawers. No generic dashboard detours. Every prop should lead naturally into the deeper research surface and keep the context you already selected.
              </p>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['01', 'Find the prop', 'Search and filter the live board without giving up density.'],
                ['02', 'Open the player', 'Carry the market, line and matchup directly into research.'],
                ['03', 'Read the sample', 'Compare recent results, splits and trend context against the current line.'],
                ['04', 'Compare the market', 'See the books pricing the same prop without leaving the workflow.'],
              ].map(([number, title, body]) => (
                <div key={number} className="premium-feature-card !min-h-0">
                  <span className="num text-sm font-bold text-[var(--accent)]">{number}</span>
                  <h3 className="mt-5">{title}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="pricing" className="premium-section scroll-mt-24">
        <div className="premium-shell">
          <Reveal>
            <div className="premium-section-head">
              <span className="premium-eyebrow">Membership</span>
              <h2>Pick the access level that fits how you research.</h2>
              <p>The same Oblige Props experience scales from a first look to full-season research.</p>
            </div>
          </Reveal>

          <div className="grid items-stretch gap-4 md:grid-cols-3">
            {PLANS.map((plan, index) => (
              <Reveal key={plan.name} delay={index * 70}>
                <article
                  className={[
                    'relative grid h-full content-start gap-6 rounded-[24px] border p-6 md:p-7',
                    'bg-[linear-gradient(160deg,rgba(20,26,49,.80),rgba(9,13,27,.88))]',
                    'shadow-[0_20px_64px_rgba(0,0,0,.24),inset_0_1px_0_rgba(255,255,255,.035)]',
                    plan.highlight
                      ? 'border-[rgba(124,140,255,.50)] shadow-[0_26px_90px_rgba(68,78,200,.18),inset_0_1px_0_rgba(255,255,255,.05)]'
                      : 'border-[var(--line)]',
                  ].join(' ')}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-6 rounded-full border border-[rgba(124,140,255,.22)] bg-[#111733] px-3 py-1 text-[11px] font-bold tracking-wide text-[#c5ccff]">
                      Most popular
                    </span>
                  )}
                  <div>
                    <div className="text-base font-semibold text-[var(--text-2)]">{plan.name}</div>
                    <div className="mt-3 flex items-baseline gap-1.5">
                      <b className="num text-[38px] font-bold tracking-[-.05em]">{plan.price}</b>
                      <span className="text-sm text-[var(--text-3)]">{plan.per}</span>
                    </div>
                  </div>
                  <ul className="grid list-none gap-3 p-0">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-snug text-[var(--text-2)]">
                        <Check className="mt-0.5 size-4 shrink-0 text-[var(--pos)]" strokeWidth={2.4} aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild block variant={plan.highlight ? 'primary' : 'ghost'}>
                    <Link href="/board">{plan.cta}</Link>
                  </Button>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
