# History Model v3 — implementation checkpoint

## Status (2026-09-25)

Preparation only. A feature branch and authenticated Jev preflight have been created. No sports-model implementation, model training, production merge, deployment, provider-cadence change, or new training schedule has been performed by this work. Do not describe this checkpoint as a trained or deployed model.

Repository: `CodingForTheFun/global-capital-`.
Website base: `production-stable` at `a1ff512bc2f3041c1872b575870c512e52b73b72`.
Working branch: `chatgpt/history-model-v3-20260925`.
Preserve concurrent work and revalidate the exact combined candidate before release.

## Verified findings

### Adaptive prediction

Source: `lib/ml/adaptive.mjs` at the website base above.

- The fallback is `adaptive-ridge-v2`, with a four-term feature vector based on a player's last result, last-three vs last-ten difference, and recent slope.
- `walkForward` uses at most eight checks. Those checks evaluate a raw fitted adjustment. The returned projection subsequently applies model-selection/shrinkage logic and an H2H adjustment. The reported errors therefore do not evaluate the complete returned prediction pipeline.
- H2H is not entirely absent: an exact string match against `research.matchup.opponent` or `research.opponent` adds a bounded adjustment when at least two matches exist. This does not prove canonical opponent identity or correct opponent coverage for a particular customer prop. Do not claim H2H is already correct everywhere.
- `probs` converts the projection, line and a residual-derived sigma through a normal CDF. No separately held-out probability calibration is required in this fallback before returning `available:true` and probability values.
- `cleanLogs` uses `Number(r.value)`, so null or empty-string values can become zero. It checks date against `now`, but this function itself does not require an explicit completed-result state or a point-in-time feature-availability timestamp.

Source: `lib/ml/snapshot-store.mjs` at the same base.

- Validated snapshot predictions have a separate gate. When those are unavailable, the explicitly injected research resolver enables the adaptive fallback.
- The adaptive research request includes player, sport, market, line, event and start time, but no explicit opponent parameter. Trace the canonical target and research resolution before changing this contract; do not invent an opponent from display text.
- Changes must cover every consumer of the shared prediction service, not just the screenshot's card. Enumerate those consumers before claiming global coverage.

### Existing training runtime

Railway already has an isolated `oblige-propline-training` service with cron `0 */6 * * *`, start command `python -u /app/factory.py`, and source branch `chatgpt/propline-training-runtime-20260918`. Its inspected deployment was `295f65c9-4227-4f53-9521-8c8a18e47ea0`, commit `c6b95c0b3ab78678fc982fd5099ffac7b5749640`.

The returned runtime-log window contains:

- 2026-09-20T12:05Z: `TRAINING_PAUSED`, reason `merged_export_memory_budget`, `trainedCandidates:0`.
- Repeated later `FACTORY_BOUNDED_STOP` with reason `website_new_workspace_not_served`.
- Repeated `FACTORY_RETRYABLE_STORAGE_STOP` with reason `private_storage_read`, including 2026-09-25T18:01:02Z.

A successful container exit/deployment status is not proof of successful training. Do not duplicate this scheduler or increase provider polling to address these failures. Inspect the factory's actual repository path/build mapping before modifying it; `/app/factory.py` is a container path and the root repository file lookup did not resolve.

### Required Jev preflight

The owner's Jev-before-coding requirement remains in force. Jev is a bounded helper/checker, not the sports prediction model or the website builder.

The inspected `CodingForTheFun/oblige-jev-mcp/src/server.js` exposes `jev_check(state, checks)` and `jev_decide(state, question, choices)`. Legacy `/mcp` intentionally returns 404. The active route requires the existing `MCP_ACCESS_TOKEN`; its value must never appear in code, PRs, logs, screenshots or chat.

The new preflight references the GitHub Actions secret `MCP_ACCESS_TOKEN`. Run `36184736596`, job `108235252819`, exited 2 with `JEV_ACCESS_MISSING`: the secret was not available to that job. No successful Jev inference is claimed. Configure that existing credential securely or use a genuinely connected authenticated Jev tool before starting model code. Do not weaken Jev authentication or substitute a different model silently.

## Implementation order after the preflight passes

1. **Repair the evidence path and fail-closed contract.** Trace canonical player/event/opponent/market/period/scoring-rule identities and reconcile card L10, model history and H2H against the same eligible games. Reject null, blank, non-finite, unfinished, duplicate, conflicting and post-cutoff observations; preserve legitimate zeros and pushes. Add point-in-time provenance. Do not use prior conversational player statistics or screenshots as training records.
2. **Build one shared, sport/market-aware feature and forecast pipeline.** Use verified L5/L10/L20, season and career context; shrunk H2H; home/away; workload and role; rest; and meaningful opponent/context features when actually supplied by trusted sources. Missing context stays explicit, not invented. Treat individual-opponent sports such as tennis appropriately rather than forcing team DvP onto them. Every historical fold must rebuild the entire feature, adjustment and selection pipeline using only information available at that historical prediction time. Do not count the same games repeatedly as independent evidence through overlapping windows.
3. **Separate projection from calibrated probabilities and price-aware EV.** Evaluate the final projection with held-out errors. Fit the probability layer on separate chronological calibration data and evaluate on later untouched, event-grouped data. Measure Brier score, log loss, calibration by probability band and sport/market, uncertainty, sample size and appropriate baseline comparisons. Fit transforms/tuning only on earlier folds. Support sport/stat-appropriate distributions and explicit push/void rules. A low RMSE or an arbitrary percentage cap must not substitute for probability calibration. Preserve an honestly labeled supported projection when probabilities cannot be released; all consumers must understand null probabilities instead of coercing them to zero. EV requires an exact fresh quote or verified DFS payout/rules, not a default -110 assumption.
4. **Repair and extend the existing automatic factory.** Resolve private-storage failures and replace brittle retired-layout checks with equivalent current health/auth/data-contract checks; do not simply bypass them. Keep existing cadence, budgets and single-scheduler ownership. Consume verified settled results and persisted pregame inputs, not the website's own forecasts as ground-truth labels. Use bounded memory/batches, durable checkpoints, idempotent settlement, a single-run lease, timeouts/backoff and bounded artifact retention. Skip training when there is insufficient new eligible data. Maintain a versioned model registry and immutable pregame forecast ledger. Candidates run in shadow first and replace the incumbent only after documented sample, quality, calibration and non-regression gates pass. Retain rollback and a stop switch. Training every six hours does not guarantee improvement or indefinite service availability.

## Required acceptance evidence

- Deterministic tests for null/blank values, real zeros, duplicate/conflicting identities, future and unfinished games, exact opponent resolution, H2H shrinkage and missing context.
- Chronological leakage tests for all transformations and complete final-pipeline backtests, including same-event grouping and the effect of later data on earlier predictions.
- Calibration and insufficient-data tests that prevent the adaptive fallback or any UI/board path from bypassing the gate; integer-line pushes and missing-price EV tests.
- Model artifact schema/version checks, corruption/staleness rejection, training lock/resume tests, incumbent comparison, rollback and resource-budget tests.
- A real-data report distinguishing training, calibration and untouched test samples. Never label synthetic test fixtures as real training or claim 100% sport/market coverage when evidence is missing.
- Exact candidate CI/release checks, an explicit production deployment record, and verified canonical board/research rendering. Preserve existing layout, routing, authentication, accounts, source normalization and provider cadence.

No automatic promotion, new paid service, destructive migration, secret exposure, or release-gate bypass is authorized by this checkpoint.
