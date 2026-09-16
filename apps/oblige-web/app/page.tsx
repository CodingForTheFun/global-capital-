import Link from 'next/link';
import {
  BarChart3,
  Check,
  LineChart,
  Smartphone,
  SlidersHorizontal,
  Table2,
  UserCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, Dot } from '@/components/ui/badge';
import { CountUp, Reveal } from '@/components/motion';

const FEATURES = [
  {
    icon: LineChart,
    title: 'Line history that actually persists',
    body: 'Every quote change is written to a change log rather than overwriting the last one. When a number moves you can see when, by how much, and which book moved first.',
  },
  {
    icon: BarChart3,
    title: 'Full sample, missed games marked',
    body: 'A hit rate is worthless if it quietly drops the games a player sat out. Missed games are drawn as hatched bars and kept out of the denominator.',
  },
  {
    icon: Table2,
    title: 'Every book, side by side',
    body: 'All the books we track priced against the same line, with the best available number flagged on both sides. No tab-switching to find two cents.',
  },
  {
    icon: UserCheck,
    title: 'Verified player identities',
    body: 'Players are matched to verified roster identities rather than fuzzy string matches, so you are never looking at the wrong Jones.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Filters that survive a reload',
    body: 'Your league, market and sort persist, and every prop has its own address. Come back at kickoff and the board is where you left it.',
  },
  {
    icon: Smartphone,
    title: 'Built for the phone first',
    body: 'The board is the same at 375px as on a monitor — the same density, the same numbers, no stripped-down mobile fallback.',
  },
];

const STEPS = [
  {
    title: 'Pick a market',
    body: 'Filter the leagues down to the sport, market and game window you actually care about.',
  },
  {
    title: 'Read the history',
    body: 'Game-by-game bars with the current line drawn across them, plus splits for home, away and this opponent.',
  },
  {
    title: 'Take the best price',
    body: 'Every book we track, side by side, with the best available number flagged and movement logged to the minute.',
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
      'Full history with missed games marked',
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
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden py-12 md:pt-20 md:pb-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-10%] top-[-20%] h-[120%]"
          style={{ background: 'var(--hero-wash)' }}
        />
        <div className="relative mx-auto grid w-full max-w-[var(--maxw)] gap-12 px-4 md:px-8">
          <div className="max-w-[46rem]">
            <Reveal>
              <span className="inline-flex items-center gap-2 text-[length:var(--fs-micro)] font-semibold uppercase tracking-[.16em] text-[var(--text-3)]">
                <span aria-hidden="true" className="h-px w-[18px] bg-[var(--line-strong)]" />
                Player prop research
              </span>
            </Reveal>
            <Reveal delay={60}>
              <h1
                className="mt-5 text-balance text-[length:var(--fs-3xl)] md:text-[length:var(--fs-4xl)]"
                style={{ textTransform: 'var(--display-case)' as 'none' }}
              >
                Stop guessing the number.
                <br />
                <em
                  className="not-italic text-[var(--accent)]"
                  style={{
                    background:
                      'linear-gradient(180deg, transparent 62%, var(--accent-soft) 62%)',
                  }}
                >
                  See how it got there.
                </em>
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-5 max-w-[54ch] text-[length:var(--fs-md)] leading-relaxed text-[var(--text-2)]">
                Every line on Oblige Props carries its own history — how it opened, where it moved,
                which book is off the consensus, and what the player actually did the last fifteen
                times out.
              </p>
            </Reveal>
            <Reveal delay={180}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/board">Open the board</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/research">See a player breakdown</Link>
                </Button>
              </div>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-6">
                <Badge variant="live" size="md">
                  <Dot pulse />
                  Live
                </Badge>
                <Stat to={14449} label="props priced right now" />
                <Stat to={234941} label="line movements recorded" />
                <Stat to={18} label="leagues covered" />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ features */}
      <section className="py-16 md:py-20">
        <div className="mx-auto w-full max-w-[var(--maxw)] px-4 md:px-8">
          <Reveal>
            <SectionHead
              eyebrow="Why it's different"
              title="What nobody else puts in one place"
              body="Most prop tools show you a number. We show you the number, its history, and the disagreement between the books pricing it."
            />
          </Reveal>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={index * 60}>
                <Card className="grid h-full content-start gap-3 p-6 hover:-translate-y-[3px] hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-2)]">
                  <span className="grid size-10 place-items-center rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--accent)_26%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]">
                    <feature.icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <h3 className="text-[length:var(--fs-md)] tracking-tight normal-case">{feature.title}</h3>
                  <p className="text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-2)]">
                    {feature.body}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- steps */}
      <section className="border-y border-[var(--line)] bg-[var(--bg-deep)] py-16 md:py-20">
        <div className="mx-auto w-full max-w-[var(--maxw)] px-4 md:px-8">
          <Reveal>
            <SectionHead eyebrow="How it works" title="Line, history, verdict." />
          </Reveal>
          <ol className="grid list-none gap-4 p-0 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <Reveal key={step.title} delay={index * 80} as="li">
                <Card className="h-full p-6">
                  <span className="num text-[length:var(--fs-xl)] font-bold text-[var(--accent)] opacity-50">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-4 text-[length:var(--fs-md)] normal-case">{step.title}</h3>
                  <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-2)]">
                    {step.body}
                  </p>
                </Card>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------- pricing */}
      <section id="pricing" className="scroll-mt-24 py-16 md:py-20">
        <div className="mx-auto w-full max-w-[var(--maxw)] px-4 md:px-8">
          <Reveal>
            <SectionHead
              eyebrow="Pricing"
              title="One board. Two ways in."
              body="No tiers on the data itself — everyone sees the same lines and the same history. You are paying for depth and speed."
            />
          </Reveal>
          <div className="grid items-start gap-4 md:grid-cols-3">
            {PLANS.map((plan, index) => (
              <Reveal key={plan.name} delay={index * 80}>
                <Card
                  className={cnPlan(plan.highlight)}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-6 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[length:var(--fs-micro)] font-bold tracking-wide text-[var(--accent-ink)]">
                      Most popular
                    </span>
                  )}
                  <div>
                    <div className="text-[length:var(--fs-md)] font-semibold">{plan.name}</div>
                    <div className="mt-3 flex items-baseline gap-1.5">
                      <b className="num text-[length:var(--fs-2xl)] font-bold tracking-tight">{plan.price}</b>
                      <span className="text-[length:var(--fs-sm)] text-[var(--text-3)]">{plan.per}</span>
                    </div>
                  </div>
                  <ul className="grid list-none gap-3 p-0">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-[length:var(--fs-sm)] leading-snug text-[var(--text-2)]">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-[var(--accent)]"
                          strokeWidth={2.4}
                          aria-hidden="true"
                        />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild block variant={plan.highlight ? 'primary' : 'ghost'}>
                    <Link href="/board">{plan.cta}</Link>
                  </Button>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function cnPlan(highlight: boolean) {
  return [
    'relative grid h-full content-start gap-5 p-6',
    highlight ? 'border-[var(--accent)] shadow-[var(--shadow-glow),var(--shadow-2)]' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function SectionHead({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="mb-10 grid max-w-[640px] gap-4">
      <span className="inline-flex items-center gap-2 text-[length:var(--fs-micro)] font-semibold uppercase tracking-[.16em] text-[var(--text-3)]">
        <span aria-hidden="true" className="h-px w-[18px] bg-[var(--line-strong)]" />
        {eyebrow}
      </span>
      <h2
        className="text-balance text-[length:var(--fs-2xl)]"
        style={{ textTransform: 'var(--display-case)' as 'none' }}
      >
        {title}
      </h2>
      {body && <p className="text-[length:var(--fs-md)] leading-relaxed text-[var(--text-2)]">{body}</p>}
    </div>
  );
}

function Stat({ to, label }: { to: number; label: string }) {
  return (
    <div className="grid gap-0.5">
      <CountUp to={to} className="text-[length:var(--fs-lg)] font-bold leading-none" />
      <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">{label}</span>
    </div>
  );
}
