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
