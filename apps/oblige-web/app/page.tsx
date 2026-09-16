import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Check,
  Layers3,
  LineChart,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/motion';

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
      <section className="premium-hero">
        <div className="premium-shell premium-hero-grid">
          <div>
            <Reveal>
              <span className="premium-eyebrow">Live player prop intelligence</span>
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
                Oblige Props brings the board, player history, hit-rate context and sportsbook comparison into one fast research workspace built for serious mobile and desktop use.
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div className="premium-actions">
                <Button asChild size="lg">
                  <Link href="/board">
                    Open the board
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/research">Explore player research</Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <div className="premium-proof" aria-label="Product capabilities">
                <span>Live line research</span>
                <span>Recent-game context</span>
                <span>Book comparison</span>
                <span>Mobile-first workflow</span>
              </div>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <ProductPreview />
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

function ProductPreview() {
  const heights = ['36%', '58%', '46%', '76%', '64%', '84%', '52%', '70%', '88%', '62%', '80%', '54%'];
  return (
    <div className="premium-preview" aria-label="Oblige Props interface preview">
      <div className="preview-topbar">
        <span className="preview-dot live" />
        <span className="preview-dot" />
        <span className="preview-dot" />
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-[.16em] text-[var(--text-3)]">Research workspace</span>
      </div>
      <div className="preview-grid">
        <div className="preview-panel preview-player">
          <div className="preview-player-line">
            <span className="preview-avatar" aria-hidden="true" />
            <span className="preview-copy" aria-hidden="true">
              <i />
              <i />
            </span>
            <span className="rounded-full border border-[rgba(76,227,178,.18)] bg-[rgba(76,227,178,.08)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.10em] text-[var(--pos)]">Live context</span>
          </div>
        </div>
        <div className="preview-panel preview-chart" aria-hidden="true">
          {heights.map((height, index) => (
            <span key={`${height}-${index}`} style={{ height }} />
          ))}
        </div>
        <div className="preview-panel preview-books" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((item) => (
            <span className="preview-book" key={item}>
              <b />
              <i />
              <em />
            </span>
          ))}
        </div>
      </div>
      <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-full border border-[rgba(124,140,255,.14)] bg-[rgba(6,9,20,.72)] px-3 py-2 text-[11px] font-semibold text-[var(--text-2)] backdrop-blur-xl">
        <Sparkles className="size-3.5 text-[#aeb8ff]" aria-hidden="true" />
        Interface preview · no simulated sports data
      </div>
    </div>
  );
}
