# Auto Scout completion audit and implementation handoff

Audit date: 2026-09-10 UTC. Phase 1 only. No application, production configuration, credential, or database changes made.

## Source of truth

- Repository: `CodingForTheFun/global-capital-`.
- GitHub `production-stable` and Railway's latest successful deployment agree on `25dec72431fc84fefbab70106424ed44c25cfebc`.
- Railway deployment: `4ca65619-2ef8-4e45-8c1f-a24319ee7e32`, created 18:55:58 UTC, SUCCESS.
- Project `985b0a23-b223-4d66-8d5e-76a6a11a0a89`; service `autoprop-live`, ID `f6d34023-04e3-4799-a3c4-defab50a7a1e`.
- Production start command: `node frontdoor-clearsports.mjs`; Dockerfile build; `/api/health`; persistent `/app/data`; one configured replica.
- Production: https://autoprop-live-production.up.railway.app/apex
- Supabase Auto Scout: `irthqoecbhuasvcnsfjz`, reported ACTIVE_HEALTHY.
- Audit branch: `chatgpt/autoscout-completion-audit`, based on the deployed commit. Refresh remote state before implementation or promotion.
- A separate checkout at `/workspace/scratch/2a0d113e4278/clearsport`, branch `ui/clearsport-research-polish`, has an uncommitted `apex-v2/scout-ui-v5.js` edit based on older `6de5e41`. It was not modified. Inspect and selectively reconcile useful presentation work; never copy this older file over production wholesale.
- Railway reports staged variable changes that predate this audit. No staged changes were accepted. A future release must not blindly apply them.

## Current runtime and preserved work

`frontdoor-clearsports.mjs` rewrites the research import in a generated runtime copy of `frontdoor-prod.mjs`. The frontdoor starts three children:

| Surface | Runtime | Preserve |
| --- | --- | --- |
| `/apex`, `/api/apex/props`, line history and diagnostics | `apex-v2/server-core.mjs`, injected `scout-ui-v5.js` | Canonical data core and current v5 UI |
| `/api/apex/research` | `lib/autoscout/research-service-v2.mjs` in frontdoor | ClearSports game-log attempt, season context, SportsDataIO fallback |
| `/apex-next`, `/api/apex-next/*` | `apex-v3/server.mjs` | Separate Claude lab; do not substitute for `/apex` |
| Other routes, including legacy props, live and auth | `server-scout.mjs` | Existing owner/access-code authentication and scanner |

The separate Railway `autoprop-worker` service is configured from older `autoprop-friends-v4` at `45f0adec`, using `server-v6.mjs`. It is not the Auto Scout research data-core worker. Its runtime health was not audited; do not repoint or delete it as part of frontend work.

Claude's latest fetched `claude/apex-market-project-txf4lp` is `7507a80`, already in production ancestry. Preserve its public sanitizer, provider-key market mappings, metadata normalization fix, and opt-in ingestion worker. Production additionally includes `591ff24` and `25dec72`, which are newer than that branch. The parked `claude/research-pipeline-reference` and `claude/supabase-auth-standalone-reference` are references, not merge candidates.

`chatgpt/research-foundation-phase3` contributes the deployed database token/RPC repair and cached-board backfill. `chatgpt/pickfinder-research-layer` contributes v5. `chatgpt/astra-frontend-polish` adds an unintegrated polish script; it includes DOM-text filtering and must not be injected as a second filter system. Selectively reuse visual ideas only.

## What was actually verified

| Check | Evidence / result |
| --- | --- |
| Baseline syntax and tests | `npm ci --ignore-scripts --no-audit --no-fund`, then `npm run check`: **295 passed, 0 failed, 0 skipped**. First attempt lacked Playwright; dependency installation resolved that environment failure. |
| Railway deployment | Latest deployment SUCCESS, live GET `/api/health` 200; startup logs show successful warm-up and persistence. A HEAD request returns 404 and is not the health contract. |
| Live NFL board | GET returned 750 actual line rows, 79 markets, 2 events, 7 sportsbooks; regular-only metadata true. This is a point-in-time sample, not a guarantee of full slate coverage. |
| Deployed UI | Browser loaded `/apex`, rendered 79 groups, opened Matthew Stafford's drawer and showed book comparisons. Sampled console had an extension error, no observed application error. Not a full browser regression pass. |
| Small viewport | Read-only DOM inspection at reported 500px viewport showed document width 485px. Exact iPhone sizes, safe areas, keyboard and desktop regression testing remain required. |
| Research | Matthew Stafford passing yards returned HTTP 200, `available:false`, `CLEARSPORTS_SEASON_ONLY`, a supplied season total 4707, real image/position/team context, and fallback `SEASON_UNAVAILABLE`. No per-game log was returned. Do not label 4707 a projection or average, or invent a season label absent from source. |
| History persistence | SQL aggregate: 6,854 snapshots, 17:53:21–18:56:38 UTC, up to 10 points per prop/book/side series at inspection time. Data exists; the database is not empty. |
| History API | GET `/api/apex/line-history` returned persisted rows. Query parameter is `bookmaker`, not `bookmakerKey`; side is `side`. |
| Auth boundary | Anonymous `/api/auth/status` 200 with required=true/authenticated=false. `/api/account/me` 401 through current legacy routing. `/api/apex/diagnostics` 403. Actual account login/logout not exercised. |
| Supabase isolation | Public tables inspected with RLS enabled; saved_props/favorites/alerts have own-user predicates. Backend RPC functions check a hashed enabled token before access. No user/private token rows read. |

A Docker image was not built locally. Provider-entitled successful game logs, full authenticated flows, all sports in the browser, alerts, and complete desktop/mobile behavior are **not verified**. Existing CI production smoke checks the currently deployed URL even on PRs; that cannot prove an unpromoted candidate's behavior.

## Foundation gaps and decisions

### 1. Research truth, identity and coverage — first implementation task

Relevant files: `lib/autoscout/research-service*.mjs`, `lib/data-sources/clearsports/{research,season-research,client}.mjs`, `lib/analytics/rolling.mjs`, `apex-v2/scout-ui-v5.js`.

- Keep the connected provider chain. The new game-log adapter being called does not prove that a subscription supplies per-game rows; the live sample still returns only season context.
- Preserve current JSON fields; add explicit section-level coverage (logs, season aggregate, projection, context) so unavailable logs do not hide supplied team/position/artwork/context, controls, books or history.
- Pass `providerMarketKey` all the way into the ClearSports game-log adapter. It currently uses display labels and loses the stable key that newer paths accept.
- Use one shared pure calculation implementation for server and browser line/side changes. `finalizeResearch` exists, but SportsDataIO still returns its separately built response, an unused `finalizeClearSports` remains, and the browser has another calculator. Current tests call the helper twice with different source labels rather than exercising both service paths.
- Validate finite numeric results, stable player/game identity, date, completed-game status when supplied, deduplication, season and period before interpreting rows. Do not resolve ambiguous same-name players without team/provider identity. Do not treat arbitrary timestamps on aggregate rows as proof of game-level data.
- Existing log requests cap at 40 games and rolling `season` uses all returned rows. Require a verified season scope/completeness before exposing Season hit rate/average; otherwise show unavailable or explicitly label a sampled window. Never promote a capped sample to a whole season.
- Preserve pushes outside both hits and losses. Normalize numeric strings before comparisons. Browser recalculation must preserve missing-line semantics, recalculate projection delta, and match server rounding and H2H team identity.
- Home/away/H2H selections must apply consistently to cards, chart and table. Current venue filters affect only chart/table. Use the same team matching as the server; browser `normTeam` is insufficient for prefixed provider IDs such as `nfl_lar` versus full team names.
- Null market results stay unavailable. Quarters, kicking points requiring weighted scoring, and ambiguous touchdown markets stay unmapped until the exact calculation is supported.
- Add targeted tests for these data-integrity risks, not screenshot snapshots of implementation text.

### 2. Request budget and freshness

- ClearSports game-log adapter now requests stats every 3 minutes and games/injuries every 5 minutes, using a different client instance from the six-hour season adapter. This defeats shared cache reuse and can significantly increase calls after the new production change.
- Consolidate the adapter request cache/coalescing; use the existing long cache policy for season-only feeds, sensible resource-specific freshness for actual game logs, and bounded negative caching/backoff for unavailable/unauthorized feeds. Do not change API vendors or environment names.
- Put one bounded frontend research queue over visible rows and drawer requests. Repeated `prefetch()` calls currently create independent sets of three workers. Coalescing identical requests does not cap different requests globally.
- Include event/team/market identity and source freshness in research cache keys. Current keys omit matchup and have no TTL. Reuse loaded real logs when only line/side changes.
- Fix sport-switch race: `sport` changes while `load()` returns early when busy, allowing old response data under new sport tabs. Use cancellation/generation guards. Also guard stale drawer/history responses.
- Stop repeated history requests on every line/window/filter repaint. History changes independently from selected research line.
- Keep provider event/market caps; public coverage should say it reflects available loaded markets without exposing commercial limits. Do not silently increase quota to fulfill an "all" label.

### 3. Line-history architecture

- Keep persisted snapshots and token-gated read RPC. Select a single prop + sportsbook + side before calculating opening/current movement. Current UI combines multiple books/sides and treats any two rows as a time trend.
- Use the current `bookmaker` query contract. Show timestamps and stored prices; only chart actual chronological observations. One point: **Building line history**. Distinguish earliest retained observation from a true market opener.
- The RPC orders oldest first and limits rows; do not call the last row in an oldest-limited response "current" without checking completeness. Add a compatible retrieval option or latest-series aggregation while preserving existing callers.
- Only one scheduler may own freshness and persistence. Retain default-off `AUTOSCOUT_INGEST_ENABLED`; refactor the frontdoor's existing scheduled pass to delegate to one budgeted implementation rather than activating both. Preserve low-frequency defaults until quota behavior is verified. Cached boards may backfill entities but cannot create fresh observations.
- Sharing a provider cache across processes matters: frontdoor and core instantiate separate clients. Prefer a single owner in the core, with an explicit mutually exclusive bootstrap path and regression tests; leave Railway start command intact.

### 4. Filtering, sorting and comparison

- Adapt grouped board rows into `lib/filters/index.mjs`, extend that engine additively, and expose it to the existing vanilla frontend as a browser-safe module. Remove the board's parallel predicate implementation; do not install the polish branch's DOM filters.
- Extend for books, saved state, availability and multiple research-window thresholds. Preserve legacy default applicability rules; new explicit research thresholds must not admit unknown statistics as threshold matches.
- Apply selected Over/Under to displayed metrics and drawer defaults, not just to whether a group has that side (the current behavior).
- Null-aware sorting for recent/L5/L10/L15/season/H2H/projection delta, books, player and time. Stable tie-breaks; missing stats last. Explain the loaded research population and progressively load useful rows instead of issuing hundreds of calls for a global sort.
- Add access to rows beyond the current hard `slice(0,180)` rendering cap.
- Compare price at the same line and side. Current `bestPrice` compares incompatible thresholds and can highlight worse lines. Present best line separately from best price at the chosen line, without profitability claims. Handle ties.
- Consensus should count each intended book/line observation deliberately, not give a two-sided book double influence over a one-sided book.
- Enforce existing non-promotional/main-line locks on every normalization path. The Odds API currently relies primarily on `_alternate` keys; inspect supported explicit promotional flags and test fail-closed handling without inventing flags or treating an unknown promo as safe.

### 5. Saves, auth and database ownership

- Actual production auth is the owner/access-code service in `server-scout.mjs`. `lib/auth/*` account routes are wired in `server.mjs`, which the production frontdoor does not start. Supabase auth/profile tables exist but that does not establish a working end-user Supabase session.
- Preserve legacy cookies and owner controls. Reuse the tested account handlers additively if enabling individual accounts in the production server; do not swap the entire server or deploy the old Supabase reference branch.
- Account saves require a verified individual account ID. Do not treat a shared invite code/owner subject as an individual user's identity, and never key saves by a browser-supplied user ID.
- Existing `public.saved_props` references `public.users`/`auth.users`; volume-account IDs cannot simply be inserted there. Use an explicit backend-owned identity mapping/collection for existing app accounts in a private schema, accessed only by the verified server session through the existing server credential boundary, unless a verified Supabase-auth session is already available. Keep existing Supabase-owned saves untouched and support their current RLS path if used.
- Prefer using the existing account store on the persistent Railway volume for initial account-bound saves if the database identity bridge is not enabled; this is real server persistence, not localStorage. Report which persistence mode is actually in use and do not claim Supabase saves until verified. Guest saves may be device-local and clearly labeled, with explicit import when a real account signs in.
- Mail delivery is not proven configured. Existing verified-email registration must fail honestly when delivery is unavailable; do not invent verification success or send test messages. This can block activation of new individual accounts even while the UI is complete.
- Database has seven applied migrations, but this checkout tracks only the original core SQL. Capture reviewed schema/migration reconciliation before future schema changes. Do not reapply old core SQL blindly.
- Advisors flag anonymous/authenticated SECURITY DEFINER RPC grants. Inspection shows intentionally token-gated ingest/history; do not revoke them blindly and break persistence. `account_state` with RLS/no public policies is intentionally private. `current_user_is_admin` consults stored role and `auth.uid()`. Full live authenticated RLS regression still required.
- Advisor references: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable and https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

### 6. Public safety and routes

- Keep `lib/safe-error.mjs` and `lib/public-sanitize.mjs`. Extend sanitization to remaining public proxies, especially `/api/apex-next/health`, which still exposes provider/configuration/diagnostic fields. Main `/api/health` still exposes persistence backend/mode. Public research retains provider-specific codes and `dataSource`; translate public availability while retaining owner diagnostics.
- Confirm root/legacy and `/apex-next` routes retain their intended functions and safe error behavior. Do not make dormant account routes appear operational merely by adding navigation.
- Never expose provider keys, backend RPC tokens or service-role keys to browser code. No secret values were retrieved for this audit.
- Existing source treats passed scheduled start time as LIVE in odds normalization. Use supplied live status/scores when available; otherwise distinguish scheduled/start-passed from confirmed live.

## Medium implementation sequence

1. Refresh production refs and handoffs. On this isolated branch, implement the research truth and cache fixes above first, with service-path tests. Exact starting files: `research-service-v2.mjs`, ClearSports adapters/client, shared analytics and v5 request state.
2. Correct history series selection and independent rendering; reconcile scheduler ownership without increasing default spend. Test same-time cross-book snapshots, one-point history, newest-point retention and stale response guards.
3. Integrate one filter engine and null-aware sort/comparison helpers, then extend v5 board and drawer. Preserve dark navy, white typography, electric blue actions and restrained green result indicators. Reconcile existing UI work selectively.
4. Restore product navigation to working Research, Live, Saved, Scanner and Account/Settings experiences. Complete server-bound saves using the verified identity/persistence path above. Alerts should expose only implemented rule management; delivery remains unavailable until real backend support exists.
5. Mobile cards with Projection/L5/L10/L15/Season/H2H/books; accessible research sheet with focus/escape management; deliberate skeletons, errors, empty states, timestamps, complete sport-specific columns where supplied. Fix the `.asBar` class collision between top navigation and chart bars. The existing 6–10px statistical labels need readable sizing.
6. Candidate validation: full check suite; real contract tests; isolated desktop/iPhone QA; switches and filters; side/line recomputation; history; saves/account isolation; data fallback/null/push cases; no major application console errors; no unexpected polling; no secrets in public payloads. Live integration checks use only configured access and small bounded samples.
7. Stop for LOW only when major work and meaningful validation are complete. LOW handles cosmetic/copy/docs residue, never unresolved data/security work.
8. Before production promotion, re-read current deployment and refs, reconcile concurrent work, require a candidate-specific release check, preserve staged Railway changes, and verify the actual deployed SHA. Final production audit covers desktop/mobile, live data, research, database/auth, filters/sports, books/history, safety and quota. Do not claim success for unavailable provider data.

## Phase boundary

HIGH audit and architecture decisions are complete. No feature implementation was performed in this phase. Resume only after the user switches to MEDIUM and says **CONTINUE**. If implementation reveals a genuinely new complex auth/provider/data-integrity problem, describe it accurately rather than improvising an architecture under a cleanup phase.
