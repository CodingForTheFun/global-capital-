# ObligePay history repair — 2026-09-12

## Checkpoint and scope

Isolated candidate `chatgpt/obligepay-reviewed-history-repair`, based on production-stable `3a470ad8bb35f2d92173a5d495c9fc1a459b5f20`. Railway's `autoprop-live` deployment and source were verified at that commit before editing. Production, other chats' branches, credentials, billing, authentication, database, schedulers and PrizePicks/Underdog ingestion/coverage budgets are unchanged. No merge or deployment is authorized by this checkpoint.

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

## Evidence and reproducible checks

`tests/fixtures/espn-history-repair.json` is a compact selection from public HTTP captures, not fabricated live board data. Sources: GitHub diagnostic run 34723644447 (defensive/kicker/pitcher/goalie/college logs and ambiguous Josh Allen search), and run 34724049167 (NFL team catalogue and complete Buffalo/Miami roster identity fields). Captures are from September 12, 2026. Their historical event rows are shortened for deterministic regression tests; fixture lengths are not production sample counts. Boundary-case roster tests are separately labelled synthetic.

The captured Josh Allen search is truncated/ambiguous; the captured current Buffalo/Miami rosters resolve ESPN athlete 3918298, and the replay uses his actual Buffalo passing log. The college fixture is used to verify the NCAAM schema, not to assert a current Purdue player identity.

- `node --test tests/public-history-repair.test.mjs tests/research-hydration-repair.test.mjs`: 20 regression tests passing locally.
- `npm run check`: 474 tests passing locally, zero failures; includes existing provider coverage, sanitizer, auth and shared analytics checks.
- UI race/cancellation/retry/display tests execute the actual frontend functions in a VM, not copied substitute functions.
- `CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-history-ui.mjs` attempts a full desktop/mobile browser replay with network interception. The local managed Chromium blocked navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`) before app execution; local visual QA is NOT claimed. The isolated GitHub runner will report its own browser result.

The browser replay never contacts production, signs up accounts, or requests paid odds. Its example lines are explicitly labelled test inputs; recorded game results are normalized through the candidate adapter and shared statistics engine. Do not mistake it for live provider verification.

## Remaining release gates

Check the candidate's GitHub regression/browser results. Full signed-in live-provider coverage across today's slate has not been verified by these fixtures. Unsupported markets or unavailable upstream player logs must still show their honest unavailable state. No claim is made that every consumer PrizePicks/Underdog selection, soccer league, fantasy-scoring system or quarter market now has logs.

Do not merge/deploy this candidate without an owner release instruction. After an approved rollout, confirm the served commit and authenticated research responses on representative real current lines. A smoke test of the unchanged production deployment does not verify this candidate.
