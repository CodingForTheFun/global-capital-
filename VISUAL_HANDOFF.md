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
