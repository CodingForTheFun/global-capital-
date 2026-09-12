# DFS deployment verification — 2026-09-11 (America/Chicago)

The owner explicitly authorized deployment with “Deploy it.” PR #39 was merged into production-stable as `3a470ad8bb35f2d92173a5d495c9fc1a459b5f20`, preserving candidate HEAD `994b41b8648b716b3131b9a46f1c67612db99ec6` and its successful release-check run `34653977592`.

Railway deployment `ae496d78-1a6f-4dda-8e3d-833ed4786053` reached SUCCESS with that exact merge commit. Existing Railway variables, source settings, API keys, authentication, database configuration, and polling schedulers were not changed in this deployment turn. The earlier runtime override still limits collection to 10 events per sport; the code's 25-event default does not override that setting.

Runtime logs verified health=200, provider configured, and new cache-miss boards: NFL 10 events / 28 markets / 9,254 lines; NBA 10 events / 96 lines; WNBA 8 events / 426 lines; MLB 10 events / 199 lines; NCAAF 10 events / 398 lines. These are total returned lines, not PrizePicks/Underdog-specific counts, and not a complete-consumer-board claim.

Open verification at this checkpoint: actual per-platform counts/timestamps and browser controls. A local shell cannot resolve external hosts in this session, and the web reader rejected the API URLs, so the existing hosted GitHub Actions production-smoke mechanism is being used for supported post-deployment verification. Do not weaken authentication or network protections.

Runtime follow-up flags: an NCAAB warm-up request reported EXCEEDED_FREQ_LIMIT; the later empty NCAAB persistence bootstrap succeeded. NFL persistence bootstrap logged persisted=false, whereas NBA/WNBA/MLB/NCAAF bootstrap entries logged persisted=true. Do not call NFL persisted history verified from these logs.

This document is on the isolated verification branch only; do not merge further code or trigger another production deployment solely for this note.
