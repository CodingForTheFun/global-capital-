# History Model v3: first implementation, not production-trained

## Scope and status

Owner request: fix global History Model overconfidence, include verified H2H and
other available context, and train continuously from verified API/site outcomes.
This is a **first-stage safety and feature/validation implementation**. It is NOT
a completed trained/calibrated replacement or a claim of deployment/accuracy.
Work starts from production-stable a1ff512bc2f3041c1872b575870c512e52b73b72.

Changed shared path: lib/ml/routes.mjs -> createMLStore in snapshot-store.mjs ->
adaptivePrediction. No page-specific patch, redesign, provider/polling changes,
new credentials, database mutations, account changes or second ingestion worker.

## Implemented

- Replace normal-CDF probabilities derived from a handful of ridge residuals with
  an explicit MODEL_WITHHELD state. Adaptive projection/probability fields are
  null; exact previously validated Sportstradamus snapshots retain priority.
- Fit the projection candidate with L5/L10/L20, trend, verified same-opponent H2H,
  same-home/away and explicit season features. H2H/split effects are shrunk by
  sample size and learned inside ridge, not bolted onto an already-tested forecast.
- Walk-forward forecasts run the final algorithm, including past-only strategy
  selection and train-only scaling. Evaluation RMSE/MAE refer to those forecasts.
- Reject target/future games, explicit non-final/unverified rows and invalid
  available/completed timestamps. Fold training/strategy selection respects
  available timestamps when supplied. Do not infer exact availability for rows
  without it: these remain historical checks, not real-line prospective validation.
- Null/blank/boolean values are not zeros. Genuine zeros and negative verified
  values remain real data (e.g. negative fantasy totals). No distribution/domain
  certification for projections is claimed before the probability release gate.
- Deduplicate exact records; reject conflicting same-event records. Cap history
  at 120 and reject unexpectedly oversized feeds. Deep-history recovery counts
  the same clean rows used by fitting, preserving its existing bounded calls.
- Descriptive current-line over/under counts retain actual sample sizes, handle
  pushes explicitly, and are never substituted for probabilities.
- Missing H2H/season/home-away data remains explicit. Opponent defense/DvP,
  injury, lineup, workload and market-price inputs are NOT claimed implemented
  in this patch; add only through verified timestamped adapters.

## Verification

Local: Node 22 syntax checks and 22 targeted tests passed. Deterministic synthetic
fixtures test software behavior, NOT model accuracy, calibration, ROI or training
on real customers/API results. The original contract.mjs was byte-checked against
GitHub blob 346763c6fdacacc4b5d84fe5eabb65276a51807b. The original snapshot-store.mjs
was byte-checked against 15e5d869a3bccea5f8da8c33c50e420ec459d317 before modification.
Full combined-repository release checks and production smoke remain required.

Jev: existing oblige-jev-mcp source declares MCP version 1.0.2 and tools jev_check
and jev_decide. A real verification attempt through Railway's agent returned
"Agent usage limit reached". No successful Jev inference/review is claimed.
Do not bypass its authentication or reveal tokenized URLs/credentials.

## Existing automatic trainer: reuse, do not duplicate

Railway already has oblige-propline-training, service
 d01629ae-1e18-435a-a1cc-f4100c533d5d, in AutoProp Scout Pro production.
Source branch: chatgpt/propline-training-runtime-20260918.
Deployed commit: c6b95c0b3ab78678fc982fd5099ffac7b5749640.
Schedule: 0 */6 * * *; start: python -u /app/factory.py.
Source: ops/propline-training/factory.py, copied into /app by its isolated Dockerfile.
The factory resumes bootstrap, then selects weekly 180-day cohorts. It is not a
completed new v3 model and its runtime Dockerfile MUST NOT replace the website's.

Observed logs, deployment 295f65c9-4227-4f53-9521-8c8a18e47ea0:
- 2026-09-25 18:01:02Z: FACTORY_RETRYABLE_STORAGE_STOP / private_storage_read.
- 2026-09-25 12:01:27Z: FACTORY_BOUNDED_STOP / website_new_workspace_not_served.
- Earlier 2026-09-20 runs: TRAINING_PAUSED / merged_export_memory_budget with
  trainedCandidates=0. These older runs are not proof of current total inventory.
A SUCCESS deployment does not mean a successful training run.
No training service settings, schedules or variables were changed by this patch.

## Remaining before promotion

1. Repair authenticated private-store reads and confirm durable round trips;
   diagnose/update the website compatibility check against the actual current
   research product without disabling account/data-integrity checks. Resolve
   bounded export processing without raising quotas or making unbounded reads.
2. Persist immutable trusted server-side pregame feature/line/model snapshots and
   verified settlements. Do not train on page clicks, user-submitted results,
   retrospectively assigned current lines, or the model's own predictions as truth.
3. Join exact player/event/sport/stat/period/platform/line IDs. Use leakage-safe
   event-grouped training, separate probability calibration, and untouched later
   evaluation periods with enough independent events. Handle push/void/retirement
   outcomes by the actual sport/platform rules.
4. Add sport/market-specific distribution and probability models; evaluate Brier,
   log loss, calibration bins and projection errors against incumbent/baselines.
   H2H is context, not a requirement to invent a matchup record or overweight one.
5. Version feature schema/artifacts and promote only passing candidates. Retain a
   last-known-good champion, durable checkpoints, resource/time limits and an
   atomic rollback path. Reuse the existing scheduled worker after it is repaired.
6. Validate every actual UI consumer, clear any stale v2 caches, and run required
   combined release/production checks. Do not force a failed parent branch live.

No promise of indefinite uptime, uninterrupted APIs or profitability is possible.
Recurring training needs working credentials, storage, quota, compute and monitoring.
