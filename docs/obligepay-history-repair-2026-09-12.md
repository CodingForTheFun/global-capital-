# ObligePay history repair — 2026-09-12

## Checkpoint and scope

Isolated candidate `chatgpt/obligepay-reviewed-history-repair`, based on production-stable `3a470ad8bb35f2d92173a5d495c9fc1a459b5f20`. Railway's `autoprop-live` deployment and source were verified at that commit before editing. Production, other chats' branches, credentials, billing, authentication, database, schedulers and PrizePicks/Underdog ingestion/coverage budgets were not changed. No merge or deployment is authorized by this checkpoint.

The existing production history engine and automatic board hydration were already connected. The earlier review's suggestion that no historical layer existed was too broad. This patch fixes concrete mapping, identity, coverage and UI failure paths in that existing implementation.

## Actual repairs

- Scope stable market keys to their correct sport. Unknown, period, alternate, team and incompatible keys cannot fall back to a plausible but unrelated display label.
- Add observed football defensive sacks, solo/assisted/total tackles, defensive interceptions, field goals, PATs, kicking points, pass+rush yards and longest-pass/rush/reception mappings. Shared `sacks`/`interceptions` columns require the appropriate offensive/defensive schema. QB sacks taken must not become a defensive-sack statistic. Team/unit markets stay unsupported, not assigned to a player.
- Add MLB canonical runs, home-run/triples/strikeout and pitcher hits/earned-runs/walks/outs mappings; enforce batting/pitching categories. Innings are baseball outs, not decimal innings: 5.1 becomes 16 outs. Add NHL blocked-shot key support. Route NCAAB through the same public-history adapter with explicit college-league validation.
- Expire unsuccessful/ambiguous identity searches after five minutes rather than caching the failure permanently. Resolve an ambiguous/truncated search only when the exact current team or both exact matchup rosters establish one unique athlete in the requested league. Never use an unrelated provider's numeric ID. Missing/ambiguous rosters fail closed; roster reads are cached/coalesced and bounded.
- Backfill from at most two explicitly listed prior seasons, including a skipped year, without relabelling older games as current-season results. Reject a response that ignores its requested year. Malformed completed games invalidate full-season coverage rather than silently inflating completeness. Genuine zeroes remain values; DNPs and unfinished games remain excluded.
- Cancel a superseded board-research batch on sport change; release the shared hydration lock and wake the current board. Add a 90-second request timeout and explicit retry for incomplete batches. Old errors cannot poison the new sport.
- Distinguish loading/retry, unsupported statistic, unmatched player, no completed games and push-only/no-decisions states instead of labelling every empty gauge “No game log.” Show the source season year on the board's season badge.

No alternate scoring engine was added. Existing L5/L10/L15/L20/SZN/H2H, streak and average-vs-line calculations remain shared between backend and frontend; line/side changes reuse the same observed games. Pushes remain excluded from the decided-game percentage denominator.

## Evidence and completed checks

The application repair was committed at `6d23f55c0c7762d03023161c36e2c81f0810f23c`. All seven initial source/test/doc blobs matched the locally tested manifest before the isolated branch push. The temporary patch transport and one-time write workflow were removed from the candidate tree. Subsequent changes corrected the browser-test harness and made read-only checks repeatable; no further application changes were required.

**Fully verified candidate: `1409eb5ea4fd9169e48b6772042cbd66e64d79c6`.** GitHub Actions run **34724735029**, job **103636788838**: syntax checks, all **474 tests**, and both full-style Chromium browser replays passed. Artifact **10307840981** contains the exact source archive, SHA, test log, browser log and four screenshots. This documentation update is not a further application change.

`tests/fixtures/espn-history-repair.json` is a compact selection from public HTTP captures, not fabricated live board data. Sources: diagnostic run 34723644447 (defensive/kicker/pitcher/goalie/college logs and ambiguous Josh Allen search), and run 34724049167 (NFL team catalogue and complete Buffalo/Miami roster identity fields). Captures are from September 12, 2026. Historical event rows are shortened for deterministic regression tests; fixture lengths are not production sample counts. Boundary-case roster tests are separately labelled synthetic.

The captured Josh Allen search is truncated/ambiguous; captured Buffalo/Miami rosters resolve ESPN athlete 3918298, and replay uses his actual Buffalo passing log. The college fixture verifies the NCAAM schema, not a current Purdue player identity.

- `node --test tests/public-history-repair.test.mjs tests/research-hydration-repair.test.mjs`: 20 added regression tests passing.
- `npm run check`: 474 passing, zero failures locally and in the isolated GitHub runner; includes existing provider coverage, sanitizer, auth and shared analytics checks.
- UI race/cancellation/retry/display tests execute the actual frontend functions in a VM, not substitute functions.
- `node scripts/verify-history-ui.mjs`: desktop 1440x1000 and mobile 390x844 passed. Tests verify the actual stylesheet, UTF-8 rendering, no horizontal page overflow, sport-switch recovery while the prior batch is blocked, populated research cards, line stepper, Over/Under recalculation, and no page or script/stylesheet response errors.
- All four final screenshots were inspected. The earlier local managed Chromium blocked navigation before app execution. An initial runner replay tested interactions but missed the stylesheet; that harness error was corrected and the final full-style replay passed. No local visual pass is claimed.

The browser replay never contacts production, signs up accounts, or requests paid odds. Its example lines are test inputs, not current offers; recorded game results are normalized through the candidate adapter and shared statistics engine. Do not mistake screenshots or these fixture results for live provider verification. The permanent candidate workflow is read-only and no longer collects public feeds on each run.

## Remaining release gates

Full signed-in live-provider coverage across today's slate has not been verified by these fixtures. Unsupported markets or unavailable upstream player logs must still show their honest unavailable state. No claim is made that every consumer PrizePicks/Underdog selection, soccer league, fantasy-scoring system, team/unit or quarter market now has logs.

No PR was opened in this step: the repository's current PR-triggered production-smoke workflow creates a live smoke account and requests production boards. Keeping this checkpoint branch-only avoids those production writes and possible paid refreshes. This does not replace release approval or skip release checks.

Do not merge/deploy this candidate without an owner release instruction. After approval, inspect the latest production/base diff for parallel work, run the normal release gates, confirm the served commit and verify authenticated research responses on representative real current lines. A smoke test of the unchanged production deployment does not verify this candidate.
