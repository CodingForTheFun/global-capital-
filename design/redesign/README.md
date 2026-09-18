# Oblige Props — redesign comps

`oblige-directions.html` is a self-contained, clickable comp. Open it in any
browser, including a phone. Nothing is installed and nothing is fetched except
Google Fonts and ESPN headshots.

Two switchers sit in the bar across the top:

- **Direction** — three visual directions, applied to the same components.
- **Surface** — landing, prop board, player detail, account and support.

## The three directions

| | Base | Type | Reads as |
|---|---|---|---|
| **A · Midnight Terminal** | `#07090E` near-black, mint accent | Inter + JetBrains Mono | A trading terminal. Tight, quiet, numbers first. |
| **B · Broadcast** | Warm black, orange-red accent | Archivo display, uppercase | Pre-game television. Loud, editorial, big type. |
| **C · Daylight Ledger** | `#F6F8FB` paper, navy + amber | Source Serif + Inter | An analyst's sheet. Hairline rules, serif headings. |

Every direction is the same stylesheet with a different token block. Nothing
below the token block knows which one is active — that is what makes the switch
instant, and it is the same mechanism the production theme would use.

## Player face cards

The cards carrying a player's face keep one identity across all three
directions: a dark, lit card with a gradient ring, so a player reads the same
whether it sits on the dark board or the light one.

Behind each face is that club's own backdrop — the mark or landmark you would
recognise, washed in the club's two colours. Bengals stripes, Vikings horns,
the Cowboys star, the Chiefs arrowhead, an Eagles wing, Dolphins surf, a Bills
bison, the Golden Gate for San Francisco. Each one is a single absolutely
positioned layer, so it never affects layout and never moves when the card
animates, and a scrim keeps the name and the numbers readable whatever colours
a club brings.

## What is real and what is sample

Real: the ESPN athlete ids, so the headshots are the actual players; the
sportsbook list; the market types; the board counts.

Sample: the game logs and prices. Each player is generated onto its own hit
rate, so sorting the board by hit rate does something visible.

## Motion

All motion is transform and opacity only — no width, height, top or left, so
nothing reflows mid-animation. Reveal on scroll is staggered 36–45ms per item,
counters ease once on entry, bars grow from the baseline, and the sticky header
condenses on scroll. Everything collapses to its final state under
`prefers-reduced-motion: reduce`, verified with the motion setting on.

## Checked

- 375, 390, 768, 1024 and 1440 wide, in all three directions, on all four
  surfaces: no horizontal page scroll anywhere.
- No console errors or page errors.
- Reduced motion: every bar, meter and counter still renders its real value.
