# ML training checkpoint — 2026-09-13

## Status

User requested: "Train the model enable them".

Four separate Auto Scout NFL point-estimate research models were actually fitted and saved. Zero models were enabled on production. The original Sportstradamus engine has NOT been trained successfully or activated by this work. Do not relabel these candidates as Sportstradamus, validated sportsbook probabilities or a completed all-sports engine.

Work branch: `chatgpt/ml-training-20260913`.
Tested training commit: `556ba71e3549dd25f873c87c39e4c239ff20d71d`.
Successful GitHub Actions run: `34750320290` (Train real-history NFL research candidates).
Artifact: `autoscout-nfl-trained-research-candidates`, ID `10316105123`, 4,877,869 bytes.
Artifact ZIP SHA256: `7f2cbc0f85eabdc7dc954e4383d2302d193cffc44318d6e9140aed562410e64f`.
Training completed at `2026-09-13T09:53:37.531910+00:00`.
GitHub artifact retention ends September 27; preserve the downloaded model/data bundle rather than relying on the temporary artifact indefinitely.

## Real training data and evaluation

Public nflverse player statistics and schedules for regular seasons 2020–2025, retrieved with nflreadpy 0.1.2. Downloaded 112,450 raw player-stat records; selected 34,919 supported QB/WR/RB/TE player-game records across 1,615 distinct games. Every selected row matched its season/week/team schedule and its source game ID where supplied. No missing player identity was imputed. Unsupported/unknown positions are excluded, not treated as zero-valued offensive players.

Poisson-objective LightGBM point regressors, not Sportstradamus weights. Hyperparameters selected using 2020–2022 development and 2023 validation. Evaluated artifacts fitted on 2020–2024, with the entire 2025 season held out from fitting and parameter choice. The 2025 season ends on January 4, 2026 in these records. Features use only strictly earlier games for the same player, measured lags/rolling statistics, and schedule metadata. No invented odds, pregame forecast timestamps, lineups, injury effects or synthetic training outcomes. Synthetic unit tests are separate code tests only.

| Model | Training player-games | Held-out player-games | Held-out games | Model RMSE | Prior-10 mean RMSE | Error reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Passing attempts | 2,639 | 598 | 272 | 9.911357 | 11.674693 | 15.1% |
| Passing completions | 2,639 | 598 | 272 | 6.735989 | 7.818962 | 13.9% |
| Passing touchdowns | 2,639 | 598 | 272 | 1.102346 | 1.156524 | 4.7% |
| Receptions | 21,260 | 4,885 | 272 | 1.667329 | 1.708210 | 2.4% |

Error reduction means reduction in root-mean-squared STAT prediction error versus the same player's prior-10-game mean, not improved win rate, accuracy percentage or return on investment. Rows overlap across the three quarterback models and must not be added as distinct evidence. All four event-cluster bootstrap intervals for MSE(model) minus MSE(baseline) were below zero in this one retrospective season. This is not a sportsbook comparison or a forward live test.

The downloaded artifact was checked locally: all four model hashes matched, source outcomes matched canonical game rows, there were no duplicate player/game keys, feature dates preceded game dates, training preceded held-out dates, loaded model weights reproduced every held-out estimate, and reported metric arithmetic was reproduced. Three targeted synthetic feature/identity tests passed both locally and in CI.

## Why production remains disabled

1. The original pinned Sportstradamus `a7c401297266142563b75104f4ea00d480fde3fb` trainer did not reach fitting. Run `34749715158` hit missing cold-start `odds_api` configuration. Run `34749839168` fixed empty credential/config initialization without supplying credentials, then the current-season history loader returned empty logs and failed at `KeyError: gameday`. No original model weights were produced. These are preserved diagnostics, not successful original-engine training.
2. The four successful research models are point estimators with their own features and model format. No serving adapter was installed for them, and they do not satisfy the original Sportstradamus output contract.
3. No real-line over/under probability validation or current exact-target forecast publication was completed. Existing `lib/ml/contract.mjs` requirements (including 300 observations / 50 independent events and paired sportsbook probability evaluation) were not lowered. Do not fabricate historical forecast times or count repeated quotes as independent games.
4. A read-only starting inventory found 7 saved projection-ledger entries, none settled, and zero `player_statistics` rows. Stored pregame quotes covered only 20 past MLB games and one past NFL game at the time inspected; other archived sports do not fill this engine's supported independent-game requirement. Public historical stats are now saved, but historical player-prop lines plus trustworthy outcomes still need to be joined for the probability path.
5. The provider diagnostic inspected from `2026-09-13T09:16:02Z` reported zero remaining odds credits and last successful ingestion at `03:11:25.850Z`. This concerns fresh odds coverage, not the public historical-stat downloads. No plan upgrade, extra credit purchase, secret access or paid-provider requests were made by these training jobs.

Next engineering work: finish legitimate multi-season cold-start preparation for the original engine or explicitly design a separate point-estimate serving contract; preserve measured candidate artifacts; obtain/join real timestamped odds/outcomes; evaluate probabilities without leakage; publish only matching validated fresh results; then test actual deployment. Initial models are NFL-only, not trained coverage for every league.

## Production preservation

This branch started at `d77624585961b48169b996b3d9b7a446d0965a0b`. Production subsequently advanced independently to `bbc4aee8458fa68ef60843da61558efaba0dcf3a` with the Auto Scout research-home restoration. Preserve that newer work. No merge, deployment, production file write, runtime variable, database mutation, permission change, auth change, Taco change or billing change was performed in this training session. The branch adds training workflows, scripts, tests and this checkpoint only.
