# ClearSports production integration

Verified against the live ClearSports API on 2026-09-10.

- ClearSports is used for real season-level player-stat context only.
- NFL player-stat payloads are season aggregates and do not contain game/date identity, so they are not used to fabricate L5/L10/L15 hit rates.
- The Odds API remains the live player-prop and sportsbook-line source.
- SportsDataIO remains the historical game-log fallback when the connected subscription exposes those feeds.
- ClearSports requests are cached for six hours by default and duplicate in-flight requests are coalesced to protect the 1,000-credit free-tier quota.
