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
# TypeSafe connection

Set `TYPESAFE_API_KEY` only on the Railway `oblige-web` service. The server-only
client in `lib/typesafe.ts` uses the official TypeSafe SDK and `jev-latest`.
At Node server startup, instrumentation makes one small synthetic connection
request per process (8-second timeout, no retries). It logs only
`[typesafe] connected` or a sanitized failure status. This uses a small amount
of TypeSafe API usage per start; page loads and health checks do not call Jev.
Builds skip the check. A missing key or provider failure does not stop the site.

This establishes connectivity only. It does not generate prop projections,
modify provider data, or enable an unrestricted public inference endpoint.
Future server features can import `createTypeSafeClient` and must separately
bound request size, authentication, budgets, and validate their domain results.

Connection regression tests (Node 22.6+):
`node --conditions=react-server --experimental-strip-types --test tests/typesafe.test.mjs`
