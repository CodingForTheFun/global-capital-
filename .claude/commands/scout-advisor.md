---
description: Get architectural advice on AutoProp Scout Pro before starting work, or have a proposed change reviewed against the project's invariants and known traps.
argument-hint: [what you're considering, or leave blank to review current changes]
---

Consult the `advisor` subagent about: $ARGUMENTS

If nothing was specified above, review the current uncommitted changes and the
current branch's divergence from `production-stable` instead.

Have the advisor:

1. Read `AUTOPROP_COORDINATION.md` for decisions made by other sessions.
2. Check the proposal against the permanent invariants — regular lines only,
   PrizePicks only, today only, missing data stays null, fail closed, no
   third-party access-control bypass, per-user isolation.
3. Check it against the traps this codebase has actually hit, especially
   `Number(null) === 0`, cross-provider join keys, and second implementations
   of the filter engine or error boundary.
4. Say whether this is an engineering decision or an owner decision. If it is
   an owner decision — the `main`/`production-stable` Goblin conflict, which
   server is canonical, whether to buy a SportsDataIO scope — say so instead of
   inventing a technical answer.

Report back a recommendation with its tradeoff, not a survey of options. Include
anything that could not be verified from a dev container without production
credentials.
