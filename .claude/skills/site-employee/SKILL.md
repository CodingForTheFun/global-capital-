---
name: site-employee
description: "Daily obligeprops.com improvement run: find what is broken or could be better on the live site, build up to three small fixes, check them with code and Jev, and open one PR for the owner to approve. Use when the daily site-employee routine fires, or when asked to run it by hand."
---

# Site employee: daily improvement run

You improve obligeprops.com a little every day. You build and test changes;
the owner decides what ships. Follow this loop in order. Stop early when
there is nothing worth doing. "No worthwhile change today" is a good result.

## Hard rules (never break these)

- **Never** comment `SAFE TO MERGE`, approve, or merge. Never touch the
  release gate, `.github/`, Railway settings, or domains. Your job ends at an
  open PR.
- **Only presentation code.** `node scripts/site-employee/check-scope.mjs`
  must pass before you open a PR. No data routes, providers, ingestion, auth,
  billing, Supabase, the CSP (`lib/web/public-surface.mjs`), dependencies,
  Dockerfiles or Next config.
- **Never invent data.** A number, player, line or stat on the page must come
  from a real feed. If data is missing, show that it is missing.
- **No secrets** in code, logs, PR text or screenshots.
- **One PR per run, at most 3 changes.** If your previous PR is still open,
  don't start new work (see step 1).

## 1. Intake

1. Check your open PRs to `production-stable` (title starts with
   `Site employee:`). If one is open:
   - CI red: fix it on that PR's branch, validate, push, then stop.
   - CI green: stop. Report "waiting on your approval of #N" and nothing else.
2. Read `docs/site-employee/ideas.md`. It holds everything already shipped,
   rejected (with the reason), and queued. Never re-propose a rejected idea
   unless the reason no longer applies. If it no longer applies, say why.

## 2. Find

Run these against production (`https://www.obligeprops.com`):

- `node scripts/site-qa/run.mjs` is the hourly QA check. Every finding is a
  top-priority candidate.
- Walk `/`, `/board`, `/scores`, `/news`, `/research`, `/account` at 390px and
  1280px with Playwright. Look for:
  - truncated text
  - tap targets under 44px
  - text contrast below 4.5:1
  - missing labels
  - layout jumps
  - confusing empty or error states
  - slow pages (LCP over 2.5 s, CLS over 0.1)
- Note ideas from what you see. Keep each one small and concrete: one
  component, one clear user benefit.

## 3. Choose

Rank the candidates with Jev (`mcp__plugin_jev_jev__jev_rank`, or the Jev
connector). Use this order:
1. broken
2. wrong data shown
3. accessibility
4. performance
5. polish
6. new ideas

Within a tier, prefer high user impact, high confidence and a small diff. Take
at most 3.

## 4. Build and check (for each chosen change)

1. Implement it on a branch named `claude/site-employee-YYYYMMDD`, based on
   `origin/production-stable`.
2. Code gates. All must pass:
   - `npx tsc --noEmit` in `apps/oblige-web`
   - `npm test` in `apps/oblige-web`
   - `node scripts/run-tests-clean-env.mjs`
   - `npx next build` in `apps/oblige-web`
   - `node scripts/site-employee/check-scope.mjs`
   - add or update a test that fails without your change
3. Browser gate: run the change locally with the production CSP applied, as
   `scripts/site-qa/run.mjs` does with `SITE_QA_BASE`, and confirm the problem
   is gone with nothing new broken.
4. Jev review (`jev_check`). Ask each question separately:
   - "Does this diff do exactly what its one-line description says, and
     nothing else?"
   - "Does the PR text claim only what the gates above actually showed?"
   - "Does this change how the site looks?" If yes, it needs before/after
     screenshots in the PR.
5. A failed gate or a failed Jev check means one fix and a re-check. **At
   most 2 revision rounds.** If it still fails, or Jev is uncertain, drop the
   change and log it in `ideas.md` with the reason.

## 5. Ship

Open **one** PR to `production-stable`:

- **Title:** `Site employee: <short summary of the changes>`.
- **Body:**
  - what changed and why, one line each
  - the gates passed
  - Jev's verdicts
  - before/after phone screenshots for any visual change, pushed to the
    `site-employee-screens` branch and linked by their raw URLs
  - a final line: "Needs your `SAFE TO MERGE` comment to ship."
- Update `docs/site-employee/ideas.md` in the same PR. Move shipped ideas to
  Proposed; add dropped ones to Rejected with the reason.

## 6. Report

End with a short summary for the owner's phone:
- the PR link
- what's in it, in plain words
- what you dropped and why

No jargon, and no code in the summary.
