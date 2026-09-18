# ObligeProps isolated PropLine training

This branch is a **one-shot training runtime**, not the production website.
Do not merge its root Dockerfile or railway.json into production-stable.

The website is checked first: /api/oblige-workspace must reject unauthenticated reads and the served /board JavaScript must contain the canonical-workspace-v1 release marker. Before any provider call, private artifact storage must reject anonymous access and pass an authenticated write/read/checksum round trip.

Credentials are supplied to only this new Railway service by reference to existing autoprop-live variables. Never copy their values into source, tool output, logs, URLs, or reports. Required: PROPLINE_API_KEY and TRAINING_STORE_TOKEN (the existing backend ingest token). No existing service variables or provider scheduler are changed.

## Dataset and training

Discover every sport from /v1/sports. Bulk-export resolved props over the configured completed historical window, honor actual quota/export cap headers, and keep a 10%/100-call minimum reserve for the website. Max 80 provider requests per run, 128 MiB per export, 512 MiB total streamed data, and a one-hour checked work budget. No automatic paid retry, cron, or second ingestion loop.

Exports are cached privately by sport/date-window hash. Canary rows are excluded and customer_token is never stored. Existing local history was inventoried before backfill: 49,089 ESPN rows across five sports; it is not mislabeled as an existing PropLine opening-line corpus.

One training observation per exact sport/market/player/event, selected outcome-blind from paired opening prices. Missing player IDs, results, pre-event opening snapshots, ambiguous result conflicts, or book-specific DFS payouts are excluded, with counts reported. Fantasy scoring is kept book-specific. Closing lines and post-event scores are not features. Past-game features use only outcomes resolved before the prediction feature cutoff.

Candidates: regularized logistic/ridge, histogram gradient boosting, and extra trees. Split by chronological event-day blocks, purge outcome availability across boundaries, select algorithms on a tuning block, fit temperature scaling on a later calibration block, and evaluate the untouched final block. Report projection MAE, multiclass log loss, conditional non-push Brier/calibration, and event-clustered bootstrap comparison with the opening no-vig book baseline.

The existing minimum 300 observations / 50 events, Brier, calibration and bootstrap thresholds are preserved as candidate-quality checks. **No candidate is auto-published.** The new artifacts do not impersonate the pinned Sportstradamus engine. A production model still requires compatible registry/inference integration and proven live feature parity. Small datasets are marked insufficient instead of fabricating history or validation.

## Private persistence

Only the private oblige-model-training bucket is used, via the authenticated oblige-training-artifacts edge endpoint. It verifies the existing ingest token using an existing guarded read RPC before any storage operation. No raw data, fitted models, or tokens are uploaded to public GitHub.

Checkpoints: runs/<run-id>/report.json. Private exports: exports/<sport>/<window-hash>.csv.gz. Fitted candidate joblib files are checksummed and read back before reporting them persisted. Rerunning the same completed run does nothing; cached exports are reused on a paused run. The process exits after one pass with restartPolicyType NEVER.

Reference: https://prop-line.com/docs, retrieved 2026-09-18.
