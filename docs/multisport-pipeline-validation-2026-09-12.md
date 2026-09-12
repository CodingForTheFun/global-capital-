# Multi-sport pipeline repair — validation, 2026-09-12

## Candidate and scope

Application candidate: `05dc5c2b163d8e448e1347acbea9c5e0149b2822`, based on production `3a470ad8bb35f2d92173a5d495c9fc1a459b5f20`. Temporary feature-only transport/probe workflows were removed after validation. Production promotion and actual Railway rollout require separate verification.

Fixed the shared market/entity contract, game-log normalization/resolution, current/prior-season handling, research calculations and visible-card hydration. Supported research paths: NFL, NBA, WNBA, MLB, NHL, NCAAF, NCAAB, MLS, EPL and UCL. This does not promise every possible prop market is covered by the public source.

## Gates passed

GitHub Actions run `34725469244` (Final multi-sport pipeline verification): all gates passed. Artifact: `final-multisport-validation`.

- `npm run check`: 471 tests passed, 0 failed, 0 skipped.
- Chromium desktop 1440 x 900 and mobile 390 x 844: automatic visible-page research, batches no larger than four, initial skeletons, real calculation updates on line/side changes, honest no-log and zero-current-season N/A, pagination, stale sport-response exclusion, and failed-batch retry all passed. No page JavaScript errors or horizontal overflow.
- Browser verification used a local test server with captured source fixtures and test offers. It was not a logged-in production session and did not verify current sportsbook quotes.
- A separate live public-source integration check at 2026-09-12T23:28:34Z returned historical game logs in all ten supported leagues. Test thresholds were arbitrary verification inputs, not betting recommendations or verified current lines.

## Real-source samples

| Research request | Verified returned games | Meaning |
| --- | ---: | --- |
| NFL Jordan Love, player_sacks | 15 | Passing-context sacks taken, not defensive sacks |
| NFL Micah Parsons, player_sacks | 14 | Individual defensive sacks |
| NFL Brandon McManus, kicking points | 14 | Real kicking stat columns |
| NFL Green Bay Packers Defense, team_sacks | 17 | Team defensive box scores, isolated from player identity |
| NBA Jayson Tatum, points | 22 | Regular/postseason rolling history |
| WNBA Caitlin Clark, assists | 36 | Real assists game logs |
| MLB Paul Skenes, pitching outs | 29 | Base-three innings conversion |
| MLB Shohei Ohtani, total bases | 130 | Batting-only stat group |
| NHL Connor Hellebuyck, saves | 57 | Goalie-only stat group |
| NHL Connor McDavid, shots on goal | 88 | Skater game logs |
| NCAAF Arch Manning, passing yards | 13 | One current-season game plus verified previous regular-season games |
| MLS Lionel Messi, shots on target | 21 | MLS-specific history |
| EPL Erling Haaland, shots | 3 | Current verified EPL games; prior-season coverage incomplete |
| UCL Erling Haaland, shots | 8 | Verified prior competition history; no invented current season |
| NCAAB Cayden Boozer, points | 34 | Verified previous regular-season games |
| NCAAB Caleb Foster, points | 31 | Verified previous regular-season games |

An additional college athlete search, Brock Davis, returned PLAYER_NOT_FOUND rather than borrowing another athlete's logs.

## Calculation and coverage semantics

- Visible cards now request research automatically. Loading skeletons are distinct from unsupported/no-history states; failed batches have a retry action.
- League-qualified athlete IDs, normalized accents/punctuation/suffixes and team aliases avoid unsafe cross-sport or cross-provider ID guesses. Team-unit props require a verified team identity.
- QB sacks taken, individual defensive sacks and team defensive sacks are separate. Explicit defensive markets cannot silently become QB sacks taken.
- Combo markets require their real components. Missing components are not zero. Pitching 5.2 innings means 17 outs, not 17.5.
- L5/L10/L15 use the actual eligible sample, backfilling with immediately prior regular-season logs when needed. Active regular-season SZN is isolated from previous-season and postseason rolling history and labels its year and incomplete coverage.
- AVG and DIFF share the same selected sample; DIFF subtracts the active line from the unrounded mean. Line and side changes recalculate without refetching historical logs.
- Research hit rates use hits divided by all eligible games. Pushes are disclosed and are not wins; the current active-pick streak stops on a push or miss. Legacy scanner qualification semantics were preserved.
- No prior opponent meeting means H2H N/A. No verified current-season games means SZN N/A, not a mislabeled previous season. A missing player/feed is not automatically called a rookie.

## Remaining source limits

The current public soccer game-log payload does not provide every advanced passes/tackles field. Those fields remain N/A with a reason unless genuine matching columns are supplied. Some EPL prior-season requests returned UCL events despite their filter metadata claiming EPL; mismatched-competition rows are rejected and the history is marked partial. Thus an L5 card can legitimately have a three-game sample rather than fabricated backfill. Other unsupported or unverified markets and athlete identities remain explicit unavailable states.

No paid-stat fallback, new API credentials, billing change, authentication change, database permission change, scanner hard-lock relaxation or Railway environment/configuration change was made. Soccer odds remain on-demand rather than adding new paid background polling. Do not accept pre-existing staged Railway variables during rollout.
