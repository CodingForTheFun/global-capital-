import Link from 'next/link';
import { Activity, ArrowRight, BrainCircuit, Check, Flame, LayoutGrid, LineChart, Scale, Shield, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/motion';

const STEPS = [
  {
    icon: LayoutGrid,
    title: 'Scan the board',
    body: 'Every prop in one dense row: best over and under across books, hit marks against the line, and where the line has moved since it opened.',
  },
  {
    icon: LineChart,
    title: 'Open the player',
    body: 'Last 5, 10 and 15, head-to-head, home and away, rest, season and opponent defense, with tonight’s game starred in every filter.',
  },
  {
    icon: Scale,
    title: 'Price the edge',
    body: 'EV against the no-vig market, a model checked on games it never saw, and pick’em hit rates where there is no single-bet price.',
  },
];

const FEATURES = [
  { icon: Flame, title: 'Steam and line movement', body: 'Opening versus current line on every row, and a marker when several books move together.' },
  { icon: BrainCircuit, title: 'A model that has to earn it', body: 'Retrained daily on resolved props per sport and shown only when it beats the market on later games.' },
  { icon: Activity, title: 'Market feed', body: 'Line moves, steam, pulled markets and graded results as one live ticker.' },
  { icon: UserRound, title: 'Faces and crests', body: 'Player headshots on the board and team crests in every matchup, so a row reads at a glance.' },
  { icon: Shield, title: 'Honest when data is missing', body: 'No invented percentages, history or prices. A blank cell says why it is blank.' },
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
    features: ['Every league on the board', 'Full history when available', 'Every book we track', 'Sixty second refresh', 'Home, away and head-to-head splits', 'Saved filters across devices'],
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
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-shell lp-hero-grid">
          <div className="lp-hero-copy">
            <Reveal>
              <span className="lp-eyebrow"><i aria-hidden="true" />Live player props · every book</span>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="lp-title">
                The edge is in the line.
                <span>Find it before it moves.</span>
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="lp-lede">
                One board for every sportsbook and pick’em app, each player’s verified history against tonight’s number, and EV priced against the market itself.
              </p>
            </Reveal>
            <Reveal delay={180}>
              <div className="lp-actions">
                <Button asChild size="lg">
                  <Link href="/board">
                    Open the board
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Link href="#pricing" className="lp-text-link">See pricing</Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={160}>
            <HeroIllustration />
          </Reveal>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-shell">
          <Reveal>
            <h2 className="lp-h2">From a line to a decision in three taps.</h2>
          </Reveal>
          <ol className="lp-steps">
            {STEPS.map((step, index) => (
              <Reveal key={step.title} delay={index * 80}>
                <li className="lp-step">
                  <span className="lp-step-num">{String(index + 1).padStart(2, '0')}</span>
                  <step.icon className="lp-step-icon" strokeWidth={1.7} aria-hidden="true" />
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section lp-band">
        <div className="lp-shell">
          <Reveal>
            <h2 className="lp-h2">What is inside.</h2>
          </Reveal>
          <div className="lp-features">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={Math.min(index * 60, 240)}>
                <article className="lp-feature">
                  <feature.icon className="size-5 text-[var(--accent-2)]" strokeWidth={1.8} aria-hidden="true" />
                  <div>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="lp-section scroll-mt-24">
        <div className="lp-shell">
          <Reveal>
            <h2 className="lp-h2">Pick your access.</h2>
          </Reveal>
          <div className="lp-plans">
            {PLANS.map((plan, index) => (
              <Reveal key={plan.name} delay={index * 70}>
                <article className="lp-plan" data-highlight={plan.highlight ? 'true' : 'false'}>
                  {plan.highlight ? <span className="lp-plan-tag">Most popular</span> : null}
                  <div>
                    <div className="lp-plan-name">{plan.name}</div>
                    <div className="lp-plan-price"><b>{plan.price}</b><span>{plan.per}</span></div>
                  </div>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}><Check className="size-4 shrink-0 text-[var(--accent)]" strokeWidth={2.4} aria-hidden="true" />{feature}</li>
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

/**
 * An animated sketch of a board row opening into research. It is built from
 * shapes only: no player names, lines, prices or percentages, so nothing on
 * the marketing page can be mistaken for real sports data.
 */
function HeroIllustration() {
  return (
    <figure className="lp-art" aria-label="Illustration of a prop row opening into research">
      <div className="lp-art-card lp-art-back" aria-hidden="true" />
      <div className="lp-art-card lp-art-mid" aria-hidden="true" />
      <div className="lp-art-card lp-art-front" aria-hidden="true">
        <div className="lp-art-row">
          <span className="lp-art-face" />
          <span className="lp-art-lines"><i /><i /></span>
          <span className="lp-art-pill" />
        </div>
        <div className="lp-art-marks">
          {Array.from({ length: 10 }, (_, index) => <i key={index} style={{ animationDelay: `${600 + index * 90}ms` }} data-hit={[0, 1, 3, 4, 6, 7, 9].includes(index) ? 'true' : 'false'} />)}
        </div>
        <div className="lp-art-chart">
          {[42, 64, 38, 72, 58, 80, 52, 76, 66, 88].map((height, index) => (
            <span key={index} style={{ height: `${height}%`, animationDelay: `${900 + index * 70}ms` }} />
          ))}
          <em className="lp-art-lineband" />
        </div>
        <div className="lp-art-books">
          {[0, 1, 2].map((item) => <span key={item} style={{ animationDelay: `${1500 + item * 120}ms` }}><b /><i /></span>)}
        </div>
      </div>
      <figcaption>Illustration · no real sports data</figcaption>
    </figure>
  );
}
