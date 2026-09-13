# Per-prop trained-model connection

## Shipping boundary

This change wires a **read-only Sportstradamus prediction feed** into every active
Auto Scout prop card, the research drawer, and each Sportsbooks comparison row.
It does **not** include trained weights, run a trainer, or claim predictions are
currently available. When no validated output exists, the panel says that no
trained model is loaded. It does not fabricate 50/50 probabilities or reuse L5
hit rates as forecasts. The existing optional, paid language-model analysis is
unchanged and is not called automatically by the new panel.

Reviewed upstream: `tjjerome/Sportstradamus`, commit
`a7c401297266142563b75104f4ea00d480fde3fb`, MIT, © 2023–2026 Trevor Jerome.
The public source and v4.2.0 release have no trained weight downloads. Upstream
training uses Python 3.11 and LightGBMLSS plus league-specific feature matrices,
archived odds and calibration artifacts. Its advertised code coverage is NFL,
NBA, WNBA, MLB and NHL, not college or soccer. Having that source is not the same
as having trained, independently validated models for the owner's data.

## Serving

`POST /api/props/ml`, behind the existing account gate, accepts at most 24 exact
prop targets per request. It reads `${DATA_DIR:-./data}/ml/predictions.json`.
There are **no new paid requests, background odds collectors, Python services,
credentials, billing changes, or Railway variable changes**. The file is checked
at most once per five seconds and must be published atomically. The browser
coalesces visible targets and refreshes model status every 30 seconds while
visible. A line/player/event/book switch never inherits another prediction.

A ready panel displays the predicted mean, estimated over/under (and any push)
probabilities, the evaluated line/book, model version and held-out sample count.
All are labeled estimates. No confidence score is invented; no bet is placed.
Historical statistics remain in their existing deterministic engine. ML does not
change the hard regular-line scanner rules, reorder picks, or auto-size a slip.

## Activation requires actual training and held-out evidence

1. Run a reviewed, pinned upstream installation in a separate **trusted training
   environment**, not the web server. Use its documented `meditate` training and
   `prophecize` scoring commands on legitimately available historical data.
   Do not fetch a random pickle and execute it. Costs/data entitlements for a
   training worker have not been approved or provisioned by this change.
2. Preserve one actual pre-game forecast per athlete/event/market, its exact
   posted sportsbook line and both prices, and the eventual completed result.
   Do not synthesize historical lines. Do not evaluate on training games.
3. `node scripts/evaluate-prop-ml.mjs heldout-records.json model-validation.json`
   evaluates the temporal evidence. It requires at least 300 observations in 50
   different events, no train/test leakage, valid source references, real
   before-game odds timestamps, Brier below .25 and no worse than the paired
   no-vig book baseline, event-cluster bootstrap upper 95% difference below
   .005, and calibration error no greater than .075. These are conservative
   serving checks, not proof of profitability. Evidence remains operator-supplied;
   timestamp validation is not independent verification of every source record.
4. Convert `data/runtime/current_offers.parquet` to records JSON **inside that
   trusted upstream environment**, e.g. pandas `to_json(orient='records')`.
   Supply its `current_meta.json` with verified `source_commit` and
   `feature_cutoff` metadata from the scoring job. No timestamp is guessed.
5. Export a real current canonical Auto Scout board through its existing
   authorized API. List model artifact/evidence paths in `model-files.json`:
   `[{"artifactFile":"models/NBA_points.pkl","evidenceFile":"evidence/NBA_points.json"}]`.
   These files stay outside the repository and browser. Then run:

   ```sh
   node scripts/export-sportstradamus.mjs \
     --offers scored-offers.json --meta scored-meta.json --board current-board.json \
     --model-files model-files.json --output data/ml/predictions.json
   ```

   The exporter recomputes the evaluation, verifies each model file's SHA-256
   **without executing it**, matches one exact canonical target, and atomically
   publishes the snapshot. Only an authorized operator writes the runtime
   volume. There is deliberately no public upload/admin bypass endpoint.

## Evidence schema

A held-out file has `model` and `records`. Model fields: `id`, `version`, `sport`,
`marketId`, `artifactSha256`, `sourceCommit`, `trainedThrough`. Each record has
`eventId`, `playerId`, `gameStartTime`, `forecastAt`, `settledAt`, `oddsObservedAt`,
`sourceOddsRecordId`, `sourceStatsRecordId`, `actualValue`, `projection`, `line`,
`probabilityOver`, `probabilityUnder`, `probabilityPush`, `overPrice`, `underPrice`.
Times are explicit-zone ISO timestamps. Test fixtures are not usable evidence.

## Exactness and intentional unavailable cases

The public upstream display snapshot drops both original side probabilities
and clips the reported preferred-side probability at .90. This initial bridge
therefore imports only full-game integer-stat **half lines**, zero push mass,
and un-clipped preferred-side probabilities below .90. It rejects integer-line
push cases or clipped records rather than reconstructing missing probability
mass. The serving contract itself can represent over/under/push once a reviewed
full-distribution bridge is available. Fantasy scoring, ambiguous QB/defensive
sacks and period markets are not mapped to nearby models. Source platform must
match the actual book; Underdog is never relabeled as PrizePicks. A missing
Commence time, conflicting namesakes, unsupported market, expired record, or
unscored line remains unavailable. Source data and trained-model coverage must
be expanded before all prop types can yield predictions.

UI numeric-state tests use local synthetic fixtures; they are never shipped as
prediction data. Deployment verification must report the **actual** model status
rather than declaring a ready engine merely because the panel or API exists.

## Taco badge isolation

Taco badges are only next to an individual quoted line, not a player headshot, category, or sportsbook heading. `lib/ui/offer-promotion.mjs` defines a normalized trusted-adapter contract: `promotion.type=taco`, `source=prizepicks`, `verified=true`, `status=active`, a source record ID, timezone-qualified starts/expires/observed times, and exact offerId/sport/eventId/playerId/marketId/side/line bindings. Source observations expire after 15 minutes or the stated expiry/kickoff, whichever is first. Missing metadata fails closed. These are **our normalized contract fields**, not a claim that The Odds API documents/supplies them. The existing adapter supplies no verified Taco feed; no real current Tacos have been fabricated, fetched or independently verified in this change. Scanner main-line rules are unchanged. The badge guard and distinct-prop examples are verified with synthetic fixtures only.
