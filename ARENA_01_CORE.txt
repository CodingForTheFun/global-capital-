# Oblige Props — Arena AI Visual Handoff 1/4

Core app shell, pages, configuration, tokens, and premium base styles.


## FILE: MODEL_IMPROVEMENT_PROMPT.md

```markdown
# Model Improvement Prompt — Oblige Props Visual System

You are the principal product designer and frontend engineer improving an existing production sports-prop research UI.

You have been given a visual-only snapshot of Oblige Props. Inspect the entire `apps/oblige-web` app before changing anything. Do not rebuild from scratch and do not invent a competing architecture.

## Objective

Elevate the current visual implementation to a top-tier mobile-first sports analytics product while preserving every existing data and behavior contract.

The result should feel intentionally designed at both:
- iPhone widths: 375px, 390px, 430px
- desktop research widths: 1280px–1920px

Prioritize the prop board and player/research flow. The user must be able to see useful props immediately on mobile without excessive headers, blank space, or stacked controls.

## Preserve exactly

Do not change backend routes, authentication semantics, PropLine/provider contracts, API payload shapes, polling cadence, Supabase/database behavior, billing, or research math.

Do not fabricate missing information. Existing Unavailable states must remain honest.

## Visual priorities

1. Information hierarchy
   - player, market, line, matchup, books, hit rate, recent games, and action state must scan instantly.
2. Mobile density
   - remove wasted vertical space while keeping touch targets usable.
   - bottom navigation must not block prop content.
3. Desktop terminal quality
   - make the board feel like a professional high-density research terminal, not enlarged mobile cards.
4. Typography
   - consistent numeric alignment, compact labels, confident headings, restrained weight usage.
5. Surfaces
   - dark premium palette, quiet borders, limited glow, deliberate depth.
6. Prop interaction
   - Over and Under states must be unmistakable.
   - filters should feel fast and compact.
7. Player research
   - premium player header, clear sample windows, readable game-history visualization, book comparison, honest unavailable states.
8. Consistency
   - landing, board, player/research, account/sign-in, navigation, sheets/drawers, empty/loading/error states should belong to the same system.

## Implementation rules

- Reuse existing React components and data plumbing.
- Consolidate visual rules where possible instead of adding another uncontrolled CSS override layer.
- Keep accessibility and reduced-motion support.
- Do not remove functioning features.
- Do not replace real data with mock/demo data.
- Avoid oversized hero cards or decorative sections on research surfaces.
- Avoid generic dashboard templates.

## Deliverables

Make the design improvements directly in the existing frontend code. Then report:
- files changed
- visual/design system decisions
- mobile changes
- desktop changes
- any remaining visual debt
- verification performed

Treat `apps/oblige-web/components/terminal-board.tsx` and `terminal-board.module.css` as the current v2 board implementation and understand how they interact with the rest of the app before editing.

```

---

## FILE: VISUAL_HANDOFF.md

```markdown
# Oblige Props — Visual-Only Model Handoff

Source of truth: `production-stable`
Pinned source commit: `aa4b426e4401d086a4b00957a23fee6558690dff`

This branch is an isolated handoff snapshot. It intentionally excludes the production backend, database, provider secrets, auth implementation, Railway configuration, and customer-data infrastructure.

## Primary frontend

The complete rebuilt customer UI is under:

`apps/oblige-web/`

Stack:
- Next.js 16
- React 19
- Tailwind CSS 4
- Radix UI primitives
- Lucide icons

Start with:
- `apps/oblige-web/app/layout.tsx`
- `apps/oblige-web/app/globals.css`
- `apps/oblige-web/app/board/page.tsx`
- `apps/oblige-web/components/terminal-board.tsx`
- `apps/oblige-web/components/terminal-board.module.css`
- `apps/oblige-web/components/site-chrome.tsx`
- `apps/oblige-web/components/player-view.tsx`
- `apps/oblige-web/components/research.tsx`

All CSS layers in `apps/oblige-web/app/` are included because the current production look is composed by layered stylesheets, including mobile density and reference-acceptance passes.

## Legacy/live visual compatibility

A small set of presentation-only legacy visual files is retained so a model can understand what still exists around the live production fallback path:
- `apex-v2/scout-ui-v5.js`
- selected `lib/autoscout/*runtime-patch.mjs` visual/navigation/research patches

Do not treat those legacy files as the preferred architecture. The Next.js app is the primary design surface.

## Non-negotiable constraints

Improve the visual system without changing:
- PropLine/provider contracts
- API payload shapes
- authentication behavior
- billing behavior
- database/Supabase behavior
- polling cadence or ingestion architecture
- verified research calculations

Never fabricate sports data, hit rates, projections, odds, injuries, trends, or game history. If data is absent, keep the existing Unavailable/empty-state behavior.

## Target

Oblige Props should feel like a premium native sports research product on iPhone and a dense professional terminal on desktop:
- excellent 375/390/430px layouts
- compact, high-density prop browsing
- clear Over/Under state
- strong player identity and hierarchy
- fast filters/search
- high-quality hit-rate and recent-game visualization
- restrained glow, quiet borders, excellent typography
- minimal wasted vertical space
- no generic AI-dashboard look

Read `MODEL_IMPROVEMENT_PROMPT.md` before editing.

```

---

## FILE: apps/oblige-web/README.md

```markdown
# Oblige Props — web front end

A React + Next.js rewrite of the customer-facing surfaces, built on shadcn-style
components over Radix primitives and Tailwind v4.

It is not a second application. It is the front end for the Oblige service that
already exists: every call goes through `app/api/[...path]/route.ts`, which
forwards to `OBLIGE_BACKEND_ORIGIN` unchanged, and `next.config.ts` rewrites any
path this app has not taken over yet back to that same service. No route,
parameter name, payload shape, environment variable or Supabase table was
changed to make this work.

## Surfaces

| Route | What it is |
|---|---|
| `/` | Marketing landing — hero, value, how it works, pricing |
| `/board` | The prop board: live quotes grouped into one card per player, market and line |
| `/research` | One prop in full — history, splits, game log, every book pricing it |
| `/account` | Support answers, the contact form, profile and sign out |

## Backend contracts it reads

| Endpoint | Used for |
|---|---|
| `GET /api/account/me`, `POST /api/account/{login,register,verify,logout}` | The account gate on every signed-in surface |
| `GET /api/apex/props?sport=` | The board. Rows arrive one per book per side and are folded into cards in `lib/api.ts` |
| `GET /api/apex/research?...` | Windows, splits, head-to-head, streak, difference and a hit-marked game log |
| `GET /api/apex/line-history?propId=` | Movement since open |
| `GET /api/apex/player-artwork?sport=&name=` | Headshots, which already fall back to an initials card server side |

Every field in `lib/types.ts` is optional on purpose. The board is a union of
several providers and the payload is sanitised on the way out, so the client
degrades rather than assuming — a window the provider could not fill renders an
em dash, never a zero, because "no sample" and "never hit" are different
answers.

## Three directions, one stylesheet

`app/globals.css` holds three token blocks — Midnight Terminal, Broadcast and
Daylight Ledger. Nothing below the tokens knows which is active, so switching is
instant and choosing one later is not a rewrite. The switcher in the header is
deliberate while a direction is still being chosen; drop
`<DirectionSwitcher />` from `components/site-chrome.tsx` to ship a single one.

Two things that bite in Tailwind v4 and are worth keeping in mind when editing:

- Base element styles live in `@layer base`. Unlayered CSS outranks *every*
  utility regardless of specificity, so an unlayered `h4 { margin: 0 }` silently
  beats `className="mb-4"`.
- Font sizes are written `text-[length:var(--fs-md)]`. Without the `length:`
  hint a bare `var()` after `text-` is read as a colour, and the element
  silently renders at body size.

## Player face cards

A card carrying a player's face keeps one identity in every direction — dark,
lit, with a gradient ring — so a player reads the same on the dark board and the
light one.

Behind each face is that club's own backdrop: the mark or landmark you would
recognise, washed in the club's two colours (`lib/teams.ts`). Every silhouette
is drawn on one 400×150 stage so each club crops identically, it is a single
absolutely positioned layer so it never affects layout or moves when the card
animates, and a scrim keeps the name and numbers readable whatever colours a
club brings. A club that is not in the table still gets a stable identity: the
hue and mark are derived from its own code, so the same club always looks the
same.

## Motion

Transform and opacity only — nothing reflows mid-animation. Reveal on scroll
uses one observer per element and unobserves on first show, counters ease once
on entry, bars grow from the baseline, and the header condenses on scroll behind
a `requestAnimationFrame` guard. All of it collapses to the final state under
`prefers-reduced-motion: reduce`, verified with the setting on.

## Running it

```bash
npm install
OBLIGE_BACKEND_ORIGIN=https://<the-service> npm run dev
```

`npm run build` and `npx tsc --noEmit` both have to pass before a push.

## Verified

Against a fixture backend speaking the real contracts, at 375, 390, 768, 1024
and 1440 wide, in all three directions, on all four surfaces:

- no horizontal page scroll anywhere
- no console errors, page errors or 404s
- the board renders 12 cards with their club scenes, real headshots and filled
  hit-rate meters; the player page renders 7 stat tiles, a 15-game chart, book
  prices with the best flagged, and a 15-row game log
- a pasted `/research?...` link opens the same prop
- with reduced motion on, every card, meter and counter still renders its value

```

---

## FILE: apps/oblige-web/package.json

```json
{
  "name": "oblige-props-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@radix-ui/react-accordion": "^1.2.20",
    "@radix-ui/react-dialog": "^1.1.23",
    "@radix-ui/react-label": "^2.1.15",
    "@radix-ui/react-scroll-area": "^1.2.18",
    "@radix-ui/react-select": "^2.3.7",
    "@radix-ui/react-separator": "^1.1.15",
    "@radix-ui/react-slot": "^1.3.3",
    "@radix-ui/react-tabs": "^1.1.21",
    "@radix-ui/react-toggle-group": "^1.1.19",
    "@radix-ui/react-tooltip": "^1.2.16",
    "@tailwindcss/postcss": "^4.3.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.46.0",
    "next": "16.3.5",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "sonner": "^2.0.8",
    "tailwind-merge": "^3.7.0",
    "tailwindcss": "^4.3.3"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  },
  "engines": {
    "node": ">=20"
  }
}

```

---

## FILE: apps/oblige-web/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": [
      "dom",
      "dom.iterable",
      "esnext"
    ],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": [
        "./*"
      ]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}

```

---

## FILE: apps/oblige-web/next.config.ts

```ts
import type { NextConfig } from 'next';

const backend = (process.env.OBLIGE_BACKEND_ORIGIN || 'https://autoprop-live-production.up.railway.app').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return {
      // Progressive migration: anything not implemented by this Next.js app
      // continues to resolve through the existing Railway application.
      fallback: [{ source: '/:path*', destination: `${backend}/:path*` }],
    };
  },
};

export default nextConfig;

```

---

## FILE: apps/oblige-web/postcss.config.mjs

```javascript
const config = {
  plugins: { '@tailwindcss/postcss': {} },
};
export default config;

```

---

## FILE: apps/oblige-web/app/layout.tsx

```tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import './premium.css';
import './premium-surfaces.css';
import './player-shell.css';
import './reference-shell.css';
import './reference-filters.css';
import './mobile-density.css';
import './human-polish.css';
import './reference-acceptance.css';
import './reference-acceptance-desktop.css';
import './reference-mounted-board.css';
import './reference-player-sheet.css';
import { CommandSearchController } from '@/components/command-search';
import { DirectionProvider } from '@/components/theme';
import { MobileNav, SiteFooter, SiteHeader } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: {
    default: 'Oblige Props',
    template: '%s · Oblige Props',
  },
  description:
    'Player prop research with the line history attached — how a number opened, where it moved, which book is off consensus, and what the player actually did.',
  applicationName: 'Oblige Props',
  metadataBase: new URL('https://www.obligeprops.com'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#050b13',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-direction="a" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Archivo:wght@600;700;800;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap"
        />
      </head>
      <body>
        <a
          href="#main"
          className="fixed top-[-60px] left-4 z-[200] rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-[var(--accent-ink)] transition-[top] duration-200 focus:top-4"
        >
          Skip to content
        </a>
        <DirectionProvider>
          <CommandSearchController />
          <SiteHeader />
          <main id="main" className="pb-14 lg:pb-0">
            {children}
          </main>
          <SiteFooter />
          <MobileNav />
        </DirectionProvider>
      </body>
    </html>
  );
}

```

---

## FILE: apps/oblige-web/app/page.tsx

```tsx
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

```

---

## FILE: apps/oblige-web/app/board/page.tsx

```tsx
import type { Metadata } from 'next';
import { TerminalBoard } from '@/components/terminal-board';

export const metadata: Metadata = {
  title: 'Research Terminal',
  description: 'Live PropLine player props with multi-book pricing, verified hit-rate windows, model context, and streaming market updates.',
};

export default function BoardPage() {
  return <TerminalBoard />;
}

```

---

## FILE: apps/oblige-web/app/research/page.tsx

```tsx
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlayerView } from '@/components/player-view';

export const metadata: Metadata = {
  title: 'Player research',
  description: 'Game-by-game history, splits and every book pricing one player prop.',
};

export default function ResearchPage() {
  // useSearchParams needs a Suspense boundary: the page is addressed entirely
  // through the URL so a pasted link opens the same prop.
  return (
    <Suspense fallback={null}>
      <PlayerView />
    </Suspense>
  );
}

```

---

## FILE: apps/oblige-web/app/account/page.tsx

```tsx
import type { Metadata } from 'next';
import { AccountView } from '@/components/account-view';

export const metadata: Metadata = {
  title: 'Account & support',
  description: 'Your Oblige Props account, plus answers to the questions we get most.',
};

export default function AccountPage() {
  return <AccountView />;
}

```

---

## FILE: apps/oblige-web/app/globals.css

```css
@import "tailwindcss";

/* ============================================================================
   TOKENS

   Three visual directions, one stylesheet. Every direction is the same set of
   token names resolved to different values; nothing below this block knows
   which direction is active. That is what lets the theme switch instantly and
   what keeps a direction change from being a rewrite.
   ============================================================================ */

:root {
  /* spacing, type and motion are shared — only colour, shape and face change */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px; --sp-5: 20px;
  --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px;
  --sp-16: 64px; --sp-20: 80px;

  --fs-micro: 11px; --fs-xs: 12px; --fs-sm: 13px; --fs-base: 15px;
  --fs-md: 17px;    --fs-lg: 20px; --fs-xl: 26px; --fs-2xl: 34px;
  --fs-3xl: 46px;   --fs-4xl: 60px;

  --dur-1: 120ms; --dur-2: 200ms; --dur-3: 320ms; --dur-4: 480ms; --dur-5: 720ms;
  --ease-out: cubic-bezier(.16, 1, .3, 1);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);

  --maxw: 1240px;

  /* Families are loaded from Google Fonts in the document head with
     display=swap. Each one names a real system fallback, so the page is
     readable at first paint and stays readable if the font never arrives. */
  --font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;
  --font-display-face: 'Archivo', system-ui, sans-serif;

  /* ---- player face cards -------------------------------------------------
     A card carrying a player's face keeps one identity in every direction, so
     a player reads the same on the dark board and the light one. */
  --face-1: #0A0D1E; --face-2: #151B40;
  --face-surface: #141A3C; --face-surface-2: #1C2455;
  --face-line: #2A3365; --face-line-strong: #3E4A9C;
  --face-text: #F2F5FF; --face-text-2: #AAB5E2; --face-text-3: #6E79B0;
  --face-ring: linear-gradient(135deg, #C026D3, #6366F1 46%, #22D3EE);
  --face-glow: rgba(99, 102, 241, .45);
  --face-pos: #00E39B; --face-neg: #FF4D6D; --face-warn: #FFC53D;
}

/* ---------- A · MIDNIGHT TERMINAL ---------- */
[data-direction="a"] {
  --bg: #07090E; --bg-deep: #04050A;
  --surface: #0D1017; --surface-2: #131926; --surface-3: #1A2130;
  --line: #1E2634; --line-strong: #2C3648;
  --text: #E9EEF6; --text-2: #A9B6CA; --text-3: #6F7E95;
  --accent: #3DE8A8; --accent-ink: #04150E; --accent-soft: rgb(61 232 168 / .12);
  --pos: #3DE8A8; --neg: #FF6B6B; --warn: #FFC53D; --info: #5AA9FF;
  --radius: 10px; --radius-sm: 7px; --radius-lg: 14px;
  --bw: 1px;
  --font-display: var(--font-sans); --font-body: var(--font-sans);
  --font-num: var(--font-mono);
  --display-weight: 700; --display-tracking: -.025em; --display-case: none;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .5);
  --shadow-2: 0 8px 28px -10px rgb(0 0 0 / .75);
  --shadow-glow: 0 0 0 1px var(--accent-soft);
  --hero-wash:
    radial-gradient(900px 520px at 78% -8%, rgb(61 232 168 / .10), transparent 62%),
    radial-gradient(760px 420px at 6% 4%, rgb(90 169 255 / .08), transparent 60%);
  --grain: .035;
  color-scheme: dark;
}

/* ---------- B · BROADCAST ---------- */
[data-direction="b"] {
  --bg: #0A0910; --bg-deep: #060509;
  --surface: #15131D; --surface-2: #1F1C2B; --surface-3: #2A2639;
  --line: #2C2839; --line-strong: #413A57;
  --text: #FFFFFF; --text-2: #B6AECB; --text-3: #7D7595;
  --accent: #FF4D2E; --accent-ink: #20050A; --accent-soft: rgb(255 77 46 / .16);
  --pos: #4ADE80; --neg: #FF5A5A; --warn: #FFC53D; --info: #8B7CFF;
  --radius: 16px; --radius-sm: 11px; --radius-lg: 22px;
  --bw: 1px;
  --font-display: var(--font-display-face); --font-body: var(--font-sans);
  --font-num: var(--font-display-face);
  --display-weight: 900; --display-tracking: -.035em; --display-case: uppercase;
  --shadow-1: 0 2px 6px rgb(0 0 0 / .45);
  --shadow-2: 0 22px 48px -18px rgb(0 0 0 / .85);
  --shadow-glow: 0 0 40px -12px rgb(255 77 46 / .5);
  --hero-wash:
    radial-gradient(820px 480px at 88% -12%, rgb(255 77 46 / .20), transparent 60%),
    radial-gradient(700px 520px at 2% 10%, rgb(139 124 255 / .16), transparent 62%);
  --grain: .06;
  color-scheme: dark;
}

/* ---------- C · DAYLIGHT LEDGER ---------- */
[data-direction="c"] {
  --bg: #F6F8FB; --bg-deep: #EEF2F7;
  --surface: #FFFFFF; --surface-2: #F4F7FA; --surface-3: #E9EEF5;
  --line: #DDE4EE; --line-strong: #C3CEDE;
  --text: #0E1726; --text-2: #4A576B; --text-3: #78869B;
  --accent: #1D4ED8; --accent-ink: #FFFFFF; --accent-soft: rgb(29 78 216 / .09);
  --pos: #047857; --neg: #B42318; --warn: #B45309; --info: #1D4ED8;
  --radius: 8px; --radius-sm: 6px; --radius-lg: 12px;
  --bw: 1px;
  --font-display: var(--font-serif); --font-body: var(--font-sans);
  --font-num: var(--font-mono);
  --display-weight: 600; --display-tracking: -.015em; --display-case: none;
  --shadow-1: 0 1px 2px rgb(16 24 40 / .06);
  --shadow-2: 0 12px 32px -14px rgb(16 24 40 / .22);
  --shadow-glow: 0 0 0 3px var(--accent-soft);
  --hero-wash:
    radial-gradient(900px 500px at 82% -10%, rgb(29 78 216 / .10), transparent 60%),
    radial-gradient(640px 420px at 4% 2%, rgb(180 83 9 / .07), transparent 60%);
  --grain: 0;
  color-scheme: light;
}

/* Expose the tokens to Tailwind so utilities such as bg-surface, text-muted
   and rounded-card resolve through the same variables the components read. */
@theme inline {
  --color-bg: var(--bg);
  --color-bg-deep: var(--bg-deep);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-ink: var(--text);
  --color-ink-2: var(--text-2);
  --color-ink-3: var(--text-3);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-soft: var(--accent-soft);
  --color-pos: var(--pos);
  --color-neg: var(--neg);
  --color-warn: var(--warn);
  --color-info: var(--info);

  --color-face-1: var(--face-1);
  --color-face-2: var(--face-2);
  --color-face-surface: var(--face-surface);
  --color-face-line: var(--face-line);
  --color-face-ink: var(--face-text);
  --color-face-ink-2: var(--face-text-2);
  --color-face-ink-3: var(--face-text-3);
  --color-face-pos: var(--face-pos);
  --color-face-neg: var(--face-neg);

  --radius-card: var(--radius);
  --radius-card-sm: var(--radius-sm);
  --radius-card-lg: var(--radius-lg);

  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-num: var(--font-num);

  --ease-out: var(--ease-out);
  --ease-spring: var(--ease-spring);
}

/* ============================================================================
   BASE

   Everything here goes in @layer base. Unlayered CSS outranks every Tailwind
   utility no matter the specificity, so an unlayered `h4 { margin: 0 }` would
   silently beat `className="mb-4"` on every heading in the app.
   ============================================================================ */

@layer base {
  * { border-color: var(--line); }

  html { -webkit-text-size-adjust: 100%; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 400 var(--fs-base) / 1.55 var(--font-body);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    overflow-x: hidden;
    transition: background-color var(--dur-4) var(--ease-out),
                color var(--dur-4) var(--ease-out);
  }

  /* Direction B leans on a grain layer; C turns it off entirely. */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: var(--grain);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
    transition: opacity var(--dur-4) var(--ease-out);
  }

  h1, h2, h3, h4 {
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    letter-spacing: var(--display-tracking);
    line-height: 1.08;
    margin: 0;
  }

  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: var(--radius-sm);
  }

  .num {
    font-family: var(--font-num);
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
  }
}

/* ============================================================================
   MOTION

   Reveal on scroll, count-up and every bar growth animate transform and
   opacity only, so nothing reflows mid-animation. All of it collapses to the
   final state when the viewer asks for reduced motion.
   ============================================================================ */

.rv {
  opacity: 0;
  transform: translate3d(0, 18px, 0);
  transition: opacity var(--dur-5) var(--ease-out), transform var(--dur-5) var(--ease-out);
  transition-delay: var(--d, 0ms);
  will-change: transform, opacity;
}
.rv[data-shown="true"] { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
  .rv { opacity: 1; transform: none; }
}

/* ============================================================================
   FACE CARD

   The gradient ring is painted as two backgrounds — a padding-box fill over a
   border-box gradient — so it needs no extra element and never shifts layout.
   Inside the card the face tokens take over from the direction's, which is why
   the same component reads identically on every surface.
   ============================================================================ */

@layer components {
  .face {
    /* A grid item defaults to min-width:auto, so a card whose contents cannot
       shrink widens its track and, at one column, the page itself. */
    min-width: 0;
    --surface: var(--face-surface);
    --surface-2: var(--face-surface);
    --surface-3: var(--face-surface-2);
    --line: var(--face-line);
    --line-strong: var(--face-line-strong);
    --text: var(--face-text);
    --text-2: var(--face-text-2);
    --text-3: var(--face-text-3);
    --pos: var(--face-pos);
    --neg: var(--face-neg);
    --warn: var(--face-warn);
    --accent: var(--face-pos);
    --accent-ink: #00140C;

    position: relative;
    overflow: hidden;
    color: var(--face-text);
    border: 1.5px solid transparent;
    border-radius: var(--radius-lg);
    background:
      linear-gradient(165deg, var(--face-1), var(--face-2)) padding-box,
      var(--face-ring) border-box;
    box-shadow: 0 0 34px -20px var(--face-glow), var(--shadow-1);
    transition: transform var(--dur-3) var(--ease-out), box-shadow var(--dur-3) var(--ease-out);
  }
  .face > * { position: relative; z-index: 1; }
  .face:hover { transform: translateY(-3px); box-shadow: 0 0 44px -16px var(--face-glow), var(--shadow-2); }

  /* ---- team scene ----
     Each club's own backdrop sits behind the player's face: the mark or landmark
     you would recognise, washed in that club's two colours. One absolutely
     positioned layer, so it never affects layout and never moves when the card
     animates. */
  .facebg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
    border-radius: inherit;
    background: linear-gradient(168deg, var(--face-1), var(--face-2));
  }
  .facebg__band {
    position: absolute;
    left: 0; right: 0; top: 0;
    height: var(--band, 98px);
    overflow: hidden;
    background:
      radial-gradient(260px 130px at 12% -12%, color-mix(in srgb, var(--t1) 60%, transparent), transparent 74%),
      radial-gradient(300px 150px at 96% -8%, color-mix(in srgb, var(--t2) 26%, transparent), transparent 78%);
    /* the band dissolves rather than ending on a hard edge, so nothing draws a
       line across the card */
    -webkit-mask-image: linear-gradient(180deg, #000 0, rgb(0 0 0 / .7) 44%, transparent 94%);
    mask-image: linear-gradient(180deg, #000 0, rgb(0 0 0 / .7) 44%, transparent 94%);
  }
  .facebg__band svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    color: var(--t2);
    opacity: .32;
  }
  /* The club mark sits behind the headshot on the left; everything to its right
     is the name and the numbers, so a scrim keeps that side readable whatever
     colours a club brings. */
  .facebg__band::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(to left,
      var(--face-1) 4%,
      color-mix(in srgb, var(--face-1) 55%, transparent) 42%,
      transparent 86%);
  }
  .facebg[data-tall="true"] .facebg__band { --band: 100%; }
  .facebg[data-tall="true"] .facebg__band svg { opacity: .26; }

  /* gradient ring around a headshot */
  .ringavatar {
    position: relative;
    flex: none;
    border-radius: 9999px;
    padding: 2px;
    background: var(--face-ring);
    display: grid;
    place-items: center;
    box-shadow: 0 0 20px -6px var(--face-glow);
  }
}

/* ============================================================================
   SCROLLERS

   Horizontal rails hide their scrollbar but stay scrollable, and never become
   the page's own overflow.
   ============================================================================ */

@layer components {
  .rail {
    display: flex;
    gap: var(--sp-2);
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
    padding-bottom: 2px;
  }
  .rail::-webkit-scrollbar { display: none; }
}

@keyframes shimmer { to { background-position: -220% 0; } }

```

---

## FILE: apps/oblige-web/app/premium.css

```css
/* Oblige Props premium visual layer — frontend-only, no data or API behavior changes. */

html[data-direction="a"],
html[data-direction="b"],
html[data-direction="c"] {
  --bg: #050711;
  --bg-deep: #03050a;
  --surface: rgba(13, 18, 34, 0.84);
  --surface-2: rgba(19, 26, 47, 0.78);
  --surface-3: rgba(27, 36, 63, 0.74);
  --line: rgba(143, 160, 255, 0.14);
  --line-strong: rgba(143, 160, 255, 0.28);
  --text: #f7f9ff;
  --text-2: #b8c3dc;
  --text-3: #71809d;
  --accent: #7c8cff;
  --accent-ink: #050713;
  --accent-soft: rgba(124, 140, 255, 0.14);
  --pos: #4ce3b2;
  --neg: #ff6f91;
  --warn: #f7bd59;
  --info: #62c6ff;
  --radius: 18px;
  --radius-sm: 12px;
  --radius-lg: 24px;
  --font-display: var(--font-sans);
  --font-body: var(--font-sans);
  --font-num: var(--font-mono);
  --display-weight: 760;
  --display-tracking: -.035em;
  --display-case: none;
  --shadow-1: 0 14px 42px rgba(0, 0, 0, .22), inset 0 1px 0 rgba(255,255,255,.035);
  --shadow-2: 0 26px 80px rgba(0, 0, 0, .38), inset 0 1px 0 rgba(255,255,255,.045);
  --shadow-glow: 0 0 0 1px rgba(124,140,255,.12), 0 16px 60px rgba(82,92,220,.18);
  --hero-wash:
    radial-gradient(900px 620px at 78% -6%, rgba(99,102,241,.20), transparent 64%),
    radial-gradient(720px 520px at 16% 6%, rgba(29,211,176,.10), transparent 64%);
  --grain: .018;
  color-scheme: dark;
}

html, body {
  background: #050711;
}

body {
  min-height: 100vh;
  background:
    radial-gradient(900px 540px at 90% -10%, rgba(78, 85, 215, .16), transparent 66%),
    radial-gradient(720px 520px at 0% 18%, rgba(19, 177, 164, .08), transparent 62%),
    linear-gradient(180deg, #050711 0%, #060915 45%, #04060d 100%);
  letter-spacing: -.008em;
}

body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background-image:
    linear-gradient(rgba(255,255,255,.012) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.010) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(to bottom, rgba(0,0,0,.55), transparent 74%);
}

/* Internal design-direction controls are intentionally hidden in the shipped UI. */
[aria-label="Visual direction"] { display: none !important; }

header {
  border-bottom-color: rgba(148, 163, 255, .10) !important;
  background: rgba(5, 7, 17, .72) !important;
  box-shadow: 0 10px 40px rgba(0,0,0,.18);
}

header > div {
  min-height: 72px;
}

header nav[aria-label="Primary"] {
  padding: 4px;
  border: 1px solid rgba(148,163,255,.10);
  border-radius: 999px;
  background: rgba(255,255,255,.025);
}

header nav[aria-label="Primary"] a {
  padding: 9px 13px !important;
  border-radius: 999px;
}

header nav[aria-label="Primary"] a[aria-current="page"] {
  background: rgba(124,140,255,.12);
  box-shadow: inset 0 0 0 1px rgba(124,140,255,.14);
}

header nav[aria-label="Primary"] a span[aria-hidden="true"] { display: none; }

button, a {
  -webkit-tap-highlight-color: transparent;
}

button:not(:disabled) {
  cursor: pointer;
}

input, select {
  backdrop-filter: blur(16px);
}

.face {
  border: 1px solid rgba(136, 150, 255, .18);
  background:
    radial-gradient(700px 240px at 100% -18%, rgba(124,140,255,.16), transparent 60%) padding-box,
    linear-gradient(160deg, rgba(12,16,31,.96), rgba(8,12,24,.96)) padding-box,
    linear-gradient(135deg, rgba(126,140,255,.42), rgba(89,223,206,.20), rgba(255,255,255,.04)) border-box;
  box-shadow: 0 20px 60px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.045);
}

.face:hover {
  transform: translateY(-4px);
  border-color: rgba(144,156,255,.34);
  box-shadow: 0 28px 80px rgba(0,0,0,.42), 0 0 46px rgba(99,102,241,.10), inset 0 1px 0 rgba(255,255,255,.06);
}

.ringavatar {
  box-shadow: 0 0 0 3px rgba(124,140,255,.16), 0 10px 26px rgba(0,0,0,.28);
}

.rail {
  gap: 8px !important;
  scrollbar-width: none;
}

.rail::-webkit-scrollbar { display: none; }

footer {
  background: rgba(3,5,10,.72) !important;
  border-top-color: rgba(148,163,255,.10) !important;
}

/* Premium landing */
.premium-landing {
  position: relative;
  overflow: hidden;
}

.premium-hero {
  position: relative;
  isolation: isolate;
  min-height: min(860px, calc(100vh - 72px));
  display: grid;
  align-items: center;
  padding: 70px 0 92px;
}

.premium-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(700px 440px at 75% 38%, rgba(96,88,255,.24), transparent 65%),
    radial-gradient(520px 420px at 86% 54%, rgba(69,214,201,.11), transparent 66%);
}

.premium-hero::after {
  content: "";
  position: absolute;
  width: 760px;
  height: 760px;
  right: -270px;
  top: -250px;
  border-radius: 50%;
  border: 1px solid rgba(124,140,255,.12);
  box-shadow: 0 0 0 80px rgba(124,140,255,.02), 0 0 0 180px rgba(124,140,255,.012);
  z-index: -1;
}

.premium-shell {
  width: min(1240px, calc(100% - 32px));
  margin: 0 auto;
}

.premium-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(420px, .98fr);
  gap: clamp(44px, 7vw, 96px);
  align-items: center;
}

.premium-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(124,140,255,.16);
  border-radius: 999px;
  background: rgba(124,140,255,.06);
  color: #aeb8ff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.premium-eyebrow::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--pos);
  box-shadow: 0 0 16px rgba(76,227,178,.8);
}

.premium-title {
  margin: 24px 0 0;
  max-width: 760px;
  font-size: clamp(48px, 7.5vw, 92px);
  line-height: .94;
  letter-spacing: -.065em;
  font-weight: 820;
  text-wrap: balance;
}

.premium-title span {
  background: linear-gradient(105deg, #ffffff 4%, #a8b4ff 42%, #67dfd0 92%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.premium-lede {
  max-width: 620px;
  margin: 24px 0 0;
  color: var(--text-2);
  font-size: clamp(17px, 2vw, 21px);
  line-height: 1.65;
}

.premium-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.premium-proof {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 34px;
}

.premium-proof span {
  padding: 8px 11px;
  border: 1px solid rgba(148,163,255,.12);
  border-radius: 999px;
  background: rgba(255,255,255,.025);
  color: #93a1bd;
  font-size: 12px;
}

.premium-preview {
  position: relative;
  min-height: 520px;
  border: 1px solid rgba(139,151,255,.18);
  border-radius: 30px;
  background:
    radial-gradient(520px 240px at 80% -10%, rgba(99,102,241,.25), transparent 64%),
    linear-gradient(165deg, rgba(16,22,42,.92), rgba(7,10,22,.96));
  box-shadow: 0 48px 120px rgba(0,0,0,.50), inset 0 1px 0 rgba(255,255,255,.05);
  overflow: hidden;
  transform: perspective(1200px) rotateY(-4deg) rotateX(2deg);
}

.premium-preview::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(135deg, rgba(255,255,255,.05), transparent 24%);
}

.preview-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(139,151,255,.12);
}

.preview-dot { width: 8px; height: 8px; border-radius: 999px; background: rgba(255,255,255,.18); }
.preview-dot.live { background: var(--pos); box-shadow: 0 0 14px rgba(76,227,178,.65); }

.preview-grid {
  display: grid;
  grid-template-columns: 1.15fr .85fr;
  gap: 14px;
  padding: 18px;
}

.preview-panel {
  border: 1px solid rgba(139,151,255,.12);
  border-radius: 20px;
  background: rgba(255,255,255,.025);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.025);
}

.preview-player { grid-column: 1 / -1; padding: 18px; }
.preview-player-line { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.preview-avatar { width: 48px; height: 48px; border-radius: 16px; background: linear-gradient(145deg,#8693ff,#4bd8c8); box-shadow: 0 0 0 4px rgba(124,140,255,.10); }
.preview-copy { flex: 1; display: grid; gap: 7px; }
.preview-copy i { display: block; height: 8px; border-radius: 999px; background: rgba(255,255,255,.10); }
.preview-copy i:first-child { width: 48%; background: rgba(255,255,255,.68); }
.preview-copy i:last-child { width: 72%; }
.preview-chart { min-height: 280px; padding: 18px; display: flex; align-items: end; gap: 7px; }
.preview-chart span { flex: 1; min-width: 7px; border-radius: 7px 7px 2px 2px; background: linear-gradient(180deg,#7083ff,#4bd8c8); opacity: .78; }
.preview-chart span:nth-child(3n) { opacity: .28; }
.preview-books { padding: 18px; display: grid; gap: 10px; align-content: start; }
.preview-book { display: grid; grid-template-columns: 28px 1fr 50px; gap: 10px; align-items: center; padding: 11px; border-radius: 13px; background: rgba(255,255,255,.035); border: 1px solid rgba(139,151,255,.08); }
.preview-book b { width: 28px; height: 28px; border-radius: 9px; background: rgba(124,140,255,.18); }
.preview-book i { height: 7px; border-radius: 999px; background: rgba(255,255,255,.10); }
.preview-book em { height: 25px; border-radius: 8px; background: rgba(76,227,178,.10); border: 1px solid rgba(76,227,178,.20); }

.premium-section { padding: 86px 0; }
.premium-section-head { display: grid; gap: 13px; max-width: 720px; margin-bottom: 34px; }
.premium-section-head h2 { font-size: clamp(34px, 4vw, 54px); letter-spacing: -.045em; }
.premium-section-head p { color: var(--text-2); font-size: 17px; line-height: 1.65; }

.premium-feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0,1fr));
  gap: 16px;
}

.premium-feature-card {
  min-height: 230px;
  padding: 24px;
  border: 1px solid rgba(139,151,255,.12);
  border-radius: 22px;
  background: linear-gradient(160deg, rgba(20,26,49,.78), rgba(10,14,28,.80));
  box-shadow: 0 18px 54px rgba(0,0,0,.20), inset 0 1px 0 rgba(255,255,255,.035);
}

.premium-feature-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  margin-bottom: 22px;
  border-radius: 15px;
  color: #b5beff;
  background: linear-gradient(145deg, rgba(124,140,255,.18), rgba(74,213,198,.10));
  border: 1px solid rgba(139,151,255,.14);
}

.premium-feature-card h3 { font-size: 19px; letter-spacing: -.02em; }
.premium-feature-card p { margin-top: 10px; color: var(--text-2); font-size: 14px; line-height: 1.65; }

/* More premium treatment for the live board and research surfaces. */
main > div.mx-auto,
main > div > div.mx-auto {
  position: relative;
}

main .sticky.top-16 {
  border: 1px solid rgba(139,151,255,.10) !important;
  border-radius: 20px;
  margin-top: 10px;
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding: 14px !important;
  background: rgba(8,11,23,.80) !important;
  box-shadow: 0 14px 46px rgba(0,0,0,.20);
}

main [class*="rounded-"] {
  transition-property: border-color, background-color, box-shadow, transform;
}

@media (max-width: 1023px) {
  .premium-hero { padding-top: 42px; min-height: auto; }
  .premium-hero-grid { grid-template-columns: 1fr; }
  .premium-preview { min-height: 420px; transform: none; }
  .premium-feature-grid { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 639px) {
  .premium-shell { width: min(100% - 24px, 1240px); }
  .premium-hero { padding: 32px 0 70px; }
  .premium-title { font-size: clamp(44px, 15vw, 62px); }
  .premium-lede { font-size: 16px; }
  .premium-preview { min-height: 360px; border-radius: 24px; }
  .preview-grid { grid-template-columns: 1fr; }
  .preview-player { grid-column: auto; }
  .preview-chart { min-height: 180px; }
  .preview-books { display: none; }
  .premium-section { padding: 64px 0; }
  .premium-feature-grid { grid-template-columns: 1fr; }
  main .sticky.top-16 { border-radius: 16px; }
}

```

---

## FILE: apps/oblige-web/app/premium-surfaces.css

```css
/* Premium Board + Player surface pass. Visual-only: no data or API behavior changes. */

:root {
  --op-panel: rgba(9, 13, 28, .82);
  --op-panel-strong: rgba(12, 17, 35, .94);
  --op-stroke: rgba(145, 158, 255, .15);
  --op-stroke-strong: rgba(145, 158, 255, .30);
  --op-violet: #7b82ff;
  --op-cyan: #56d8df;
  --op-mint: #48dfb3;
  --op-pink: #ff7097;
  --op-shadow: 0 24px 80px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.035);
  --op-shadow-hover: 0 32px 100px rgba(0,0,0,.46), 0 0 46px rgba(99,102,241,.10), inset 0 1px 0 rgba(255,255,255,.05);
}

/* ---------- app chrome ---------- */
header {
  background: color-mix(in srgb, #050711 86%, transparent) !important;
  border-bottom: 1px solid rgba(145,158,255,.10) !important;
  box-shadow: 0 14px 48px rgba(0,0,0,.18);
}

header > div {
  max-width: 1320px !important;
}

header a[href="/"] > span:first-child {
  border: 1px solid rgba(139,151,255,.20);
  background: linear-gradient(145deg, #7b82ff 0%, #5868f5 48%, #4dd7d2 100%) !important;
  box-shadow: 0 0 0 4px rgba(123,130,255,.07), 0 10px 26px rgba(58,66,190,.26) !important;
}

header a[href="/"] > span:last-child {
  font-weight: 800 !important;
  letter-spacing: -.035em !important;
}

header nav[aria-label="Primary"] {
  border: 1px solid rgba(145,158,255,.10) !important;
  background: rgba(255,255,255,.022) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.02);
}

header nav[aria-label="Primary"] a {
  color: #8c99b5 !important;
}

header nav[aria-label="Primary"] a:hover,
header nav[aria-label="Primary"] a[aria-current="page"] {
  color: #f8f9ff !important;
  background: linear-gradient(145deg, rgba(123,130,255,.14), rgba(86,216,223,.06)) !important;
}

/* ---------- global app content ---------- */
main > div[class*="max-w-"] {
  max-width: 1320px !important;
}

main h1,
main h2,
main h3 {
  text-wrap: balance;
}

main h1 {
  letter-spacing: -.05em !important;
}

main [class*="border-[var(--line)]"] {
  border-color: rgba(145,158,255,.13);
}

main [class*="bg-[var(--surface)]"],
main [class*="bg-[var(--surface-2)]"] {
  backdrop-filter: blur(18px);
}

/* ---------- board heading ---------- */
main > div[class*="max-w-"] > div:first-child h1 {
  font-size: clamp(30px, 4vw, 46px) !important;
  font-weight: 800 !important;
}

main > div[class*="max-w-"] > div:first-child p {
  color: #7e8ca9 !important;
}

/* ---------- sticky search/filter dock ---------- */
main .sticky.top-16 {
  top: 72px !important;
  z-index: 24 !important;
  border: 1px solid rgba(145,158,255,.14) !important;
  border-radius: 22px !important;
  padding: 14px !important;
  background:
    radial-gradient(500px 120px at 10% -30%, rgba(123,130,255,.12), transparent 70%),
    rgba(7,10,22,.88) !important;
  box-shadow: 0 18px 58px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.025) !important;
  backdrop-filter: blur(28px) saturate(1.2) !important;
}

main .sticky.top-16 .rail button {
  min-height: 42px !important;
  padding-inline: 16px !important;
  border-color: rgba(145,158,255,.12) !important;
  background: rgba(255,255,255,.025) !important;
}

main .sticky.top-16 .rail button[aria-pressed="true"],
main .sticky.top-16 button[aria-pressed="true"] {
  color: #fff !important;
  background: linear-gradient(135deg, #6f79ff, #5c65e8) !important;
  border-color: rgba(151,162,255,.48) !important;
  box-shadow: 0 10px 28px rgba(73,82,214,.25), inset 0 1px 0 rgba(255,255,255,.14) !important;
}

main .sticky.top-16 input[type="search"] {
  min-height: 46px !important;
  border-color: rgba(145,158,255,.12) !important;
  background: rgba(255,255,255,.025) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.02);
}

main .sticky.top-16 input[type="search"]:focus {
  border-color: rgba(123,130,255,.55) !important;
  box-shadow: 0 0 0 4px rgba(123,130,255,.08) !important;
}

/* ---------- prop cards ---------- */
main .face {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(145,158,255,.15) !important;
  border-radius: 22px !important;
  background:
    radial-gradient(420px 180px at 95% -12%, rgba(123,130,255,.15), transparent 65%),
    linear-gradient(160deg, rgba(14,19,38,.95), rgba(7,10,22,.97)) !important;
  box-shadow: var(--op-shadow) !important;
  isolation: isolate;
}

main .face::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background: linear-gradient(135deg, rgba(255,255,255,.035), transparent 24% 76%, rgba(123,130,255,.025));
}

main .face:hover {
  transform: translateY(-5px) !important;
  border-color: rgba(145,158,255,.30) !important;
  box-shadow: var(--op-shadow-hover) !important;
}

main .face > button[aria-label^="Open "] {
  gap: 14px !important;
  padding: 18px 18px 14px !important;
}

main .face > button[aria-label^="Open "] > span:first-child {
  min-height: 56px;
}

main .face > button[aria-label^="Open "] > span:nth-child(2) {
  border-top-color: rgba(145,158,255,.10) !important;
  padding-top: 14px !important;
}

main .face > button[aria-label^="Open "] > span:nth-child(2) > span:last-child {
  font-size: clamp(24px, 2.1vw, 32px) !important;
  letter-spacing: -.05em !important;
}

main .face > button + div {
  gap: 8px !important;
  padding: 0 18px 18px !important;
}

main .face > button + div button {
  min-height: 46px !important;
  border-color: rgba(145,158,255,.12) !important;
  background: rgba(255,255,255,.028) !important;
}

main .face > button + div button:hover {
  border-color: rgba(145,158,255,.28) !important;
  background: rgba(123,130,255,.07) !important;
}

main .face > button + div button[aria-pressed="true"] {
  border-color: rgba(123,130,255,.52) !important;
  background: linear-gradient(135deg, rgba(123,130,255,.17), rgba(86,216,223,.07)) !important;
  box-shadow: 0 8px 26px rgba(70,77,192,.15) !important;
}

main .ringavatar {
  box-shadow: 0 0 0 3px rgba(123,130,255,.16), 0 10px 28px rgba(0,0,0,.34) !important;
}

/* ---------- player analysis hero ---------- */
main .face.mt-4.p-5,
main .face.mt-4.md\:p-6 {
  border-radius: 28px !important;
  background:
    radial-gradient(760px 280px at 92% -5%, rgba(123,130,255,.20), transparent 66%),
    radial-gradient(500px 260px at 0% 100%, rgba(86,216,223,.08), transparent 66%),
    linear-gradient(160deg, rgba(14,19,39,.98), rgba(6,9,20,.98)) !important;
}

main .face.mt-4.p-5 h1,
main .face.mt-4.md\:p-6 h1 {
  font-size: clamp(32px, 5vw, 56px) !important;
  line-height: .98 !important;
  font-weight: 820 !important;
  letter-spacing: -.055em !important;
}

main .face.mt-4.p-5 .ringavatar,
main .face.mt-4.md\:p-6 .ringavatar {
  filter: drop-shadow(0 18px 30px rgba(0,0,0,.38));
}

main .face.mt-4.p-5 > div:last-child,
main .face.mt-4.md\:p-6 > div:last-child {
  border-color: rgba(145,158,255,.14) !important;
  background: rgba(255,255,255,.035) !important;
  backdrop-filter: blur(18px);
}

/* ---------- market tabs ---------- */
main [role="tablist"].rail {
  gap: 8px !important;
  padding: 3px 0;
}

main [role="tablist"].rail button {
  min-height: 44px !important;
  border-radius: 999px !important;
  border-color: rgba(145,158,255,.13) !important;
  background: rgba(255,255,255,.025) !important;
}

main [role="tablist"].rail button[aria-selected="true"] {
  color: #fff !important;
  border-color: rgba(145,158,255,.38) !important;
  background: linear-gradient(135deg, #6f79ff, #5964df) !important;
  box-shadow: 0 10px 30px rgba(65,74,205,.24) !important;
}

/* ---------- research panels ---------- */
main [class*="shadow-[var(--shadow-1)]"] {
  border-color: rgba(145,158,255,.13) !important;
  background:
    radial-gradient(600px 180px at 100% -20%, rgba(123,130,255,.08), transparent 65%),
    rgba(9,13,28,.78) !important;
  box-shadow: 0 18px 56px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.025) !important;
}

main [class*="shadow-[var(--shadow-1)]"] > h2,
main [class*="shadow-[var(--shadow-1)]"] h2 {
  letter-spacing: -.035em !important;
}

/* line stepper + O/U */
main button[aria-label^="Lower the line"],
main button[aria-label^="Raise the line"] {
  background: rgba(255,255,255,.025) !important;
}

main button[aria-label^="Lower the line"]:hover,
main button[aria-label^="Raise the line"]:hover {
  background: rgba(123,130,255,.10) !important;
  color: #fff !important;
}

main [role="group"][aria-label="Side"] {
  border-color: rgba(145,158,255,.13) !important;
  background: rgba(255,255,255,.025) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.02);
}

main [role="group"][aria-label="Side"] button[aria-pressed="true"] {
  box-shadow: inset 0 0 0 1px currentColor, 0 8px 26px rgba(0,0,0,.16) !important;
}

/* dropdown controls */
main button[role="combobox"] {
  border-color: rgba(145,158,255,.13) !important;
  background: rgba(255,255,255,.025) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.018);
}

main button[role="combobox"]:hover,
main button[role="combobox"][data-state="open"] {
  border-color: rgba(123,130,255,.38) !important;
  background: rgba(123,130,255,.07) !important;
}

/* sample window strip */
main .rail.rounded-\[var\(--radius\)\] {
  border-color: rgba(145,158,255,.12) !important;
  background: rgba(255,255,255,.022) !important;
}

main .rail.rounded-\[var\(--radius\)\] button[aria-pressed="true"] {
  border-color: rgba(145,158,255,.24) !important;
  background: linear-gradient(145deg, rgba(123,130,255,.13), rgba(86,216,223,.055)) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 8px 24px rgba(0,0,0,.16) !important;
}

/* chart presentation */
main [title*=" · "] {
  filter: saturate(1.08);
}

main [title*=" · "]:hover {
  filter: saturate(1.18) brightness(1.08);
}

/* book prices */
main [data-best="true"] {
  border-color: rgba(72,223,179,.55) !important;
  background: rgba(72,223,179,.10) !important;
  box-shadow: 0 0 24px rgba(72,223,179,.06);
}

/* ---------- mobile nav ---------- */
nav[aria-label="Sections"] {
  inset-inline: 10px !important;
  bottom: 10px !important;
  border: 1px solid rgba(145,158,255,.14) !important;
  border-radius: 22px !important;
  overflow: hidden;
  background: rgba(7,10,22,.90) !important;
  box-shadow: 0 18px 58px rgba(0,0,0,.46), inset 0 1px 0 rgba(255,255,255,.035) !important;
  backdrop-filter: blur(28px) saturate(1.2) !important;
}

nav[aria-label="Sections"] a {
  min-height: 58px !important;
  border-radius: 16px;
  margin: 4px;
}

nav[aria-label="Sections"] a[aria-current="page"] {
  color: #fff !important;
  background: linear-gradient(145deg, rgba(123,130,255,.16), rgba(86,216,223,.06));
}

/* ---------- responsive ---------- */
@media (min-width: 1200px) {
  main .face > button[aria-label^="Open "] {
    min-height: 188px;
  }
}

@media (max-width: 1023px) {
  main .sticky.top-16 {
    top: 62px !important;
    border-radius: 18px !important;
  }

  main .face:hover {
    transform: none !important;
  }
}

@media (max-width: 639px) {
  body {
    background:
      radial-gradient(540px 360px at 100% -4%, rgba(87,94,220,.16), transparent 70%),
      linear-gradient(180deg,#050711,#050815 56%,#03050b) !important;
  }

  header > div {
    min-height: 62px !important;
  }

  main > div[class*="max-w-"] {
    padding-inline: 12px !important;
  }

  main .sticky.top-16 {
    margin-inline: 0 !important;
    padding: 10px !important;
    border-radius: 16px !important;
  }

  main .sticky.top-16 .rail {
    margin-inline: -2px;
  }

  main .sticky.top-16 .rail button {
    min-height: 40px !important;
    padding-inline: 14px !important;
  }

  main .face {
    border-radius: 18px !important;
    box-shadow: 0 16px 48px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.03) !important;
  }

  main .face > button[aria-label^="Open "] {
    padding: 16px 15px 12px !important;
  }

  main .face > button + div {
    padding: 0 15px 15px !important;
  }

  main .face.mt-4.p-5,
  main .face.mt-4.md\:p-6 {
    border-radius: 22px !important;
  }

  main .face.mt-4.p-5 h1,
  main .face.mt-4.md\:p-6 h1 {
    font-size: 34px !important;
  }

  main [class*="shadow-[var(--shadow-1)]"] {
    border-radius: 18px !important;
  }

  nav[aria-label="Sections"] {
    bottom: max(8px, env(safe-area-inset-bottom)) !important;
  }

  footer {
    padding-bottom: 96px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  main .face,
  main .face:hover,
  nav[aria-label="Sections"] a,
  header * {
    transition: none !important;
    transform: none !important;
  }
}

```

---
