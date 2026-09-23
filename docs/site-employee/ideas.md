# Site employee ideas log

The daily site employee (`.claude/skills/site-employee/SKILL.md`) reads this
before every run and updates it in its PR. Keep entries to one line: the idea,
where, and the outcome or reason.

## Queued (worth doing)

- Research card: the sportsbook badge truncates to 4 letters ("DRAF" for
  DraftKings). Use the book's short name or its logo mark.
  (`apps/oblige-web/components/player-prop-research-card.tsx`)
- Research card: the book select reads "Best pric…" on phones. Shorten the
  label or widen the control.
- Board: player headshots that fail to load leave a blank gap; show initials
  like the research card does.

## Proposed (in an open PR, waiting on the owner)

_(none)_

## Shipped

- 2026-09-22: one stylesheet and token system, indigo accent, self-hosted
  fonts, and a one-row 5-item phone dock (#624, live via #627/#628).
- 2026-09-22: ESPN news photos served from our own domain through a strict
  relay; the CSP is unchanged (#624).
- 2026-09-22: the `oblige-web` Railway build fixed by pinning the Turbopack
  root (#625).

## Rejected (don't re-propose unless the reason changes)

- Loosening the CSP to allow ESPN images or Google Fonts directly. It weakens
  security; the relay and self-hosting solve both instead.
