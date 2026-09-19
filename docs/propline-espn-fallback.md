# PropLine -> ESPN research fallback

For sports already covered by the verified ESPN research contract, completed-game research now uses:

1. PropLine raw completed-game archive when the exact sport/market identity validates.
2. ESPN public completed-game logs when PropLine is unavailable, unmapped, empty, redacted, or identity validation fails.
3. Existing fail-closed unavailable state when neither source has verified evidence.

This fallback is deliberately limited to historical research/stat evidence. ESPN is not treated as a sportsbook or DFS prop provider and cannot manufacture missing current prop lines, prices, odds, payout multipliers, provider timestamps, or book availability.

ESPN fallback retains its existing player/team/league identity validation, completed-game checks, exact market-stat mapping, H2H extension, caching/backoff and persistence. It adds no scheduler and does not widen live provider polling.

For sports/markets outside ESPN's verified contract, existing PropLine/ClearSports/line-only behavior remains unchanged.
