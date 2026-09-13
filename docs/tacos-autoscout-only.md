# Taco placement correction

Owner requested Tacos only in Auto Scout, not the sportsbook.

- Sportsbook board switch contains Game lines and Player props only.
- Removed unused Next.js TacoBoard and its import/render path.
- Legacy /sportsbooks#tacos and /#tacos redirect to /apex#tacos.
- Auto Scout quick prop controls contain 🌮 Taco-only props, off by default.
- A separate display-only asset uses existing /api/apex/taco-offers and current sport.
- The navigation bridge remains byte-for-byte unchanged and performs no fetch or credential operations.
- Back to regular props restores the board. Scanner rules, measured stats, Ask, saves, providers, credentials, backend APIs and budgets are unchanged.
- Only verified feed offers with unexpired discount metadata display; empty, malformed and failed responses remain explicit. Live Taco availability is not claimed.
- Existing release build/QA checks placement, no sportsbook entry, original/discounted lines, expired-offer rejection, mobile layout, sport switching and return navigation. Fixtures are confined to CI.

Preserve parallel Auto Scout intelligence work. This correction adds an isolated Taco view, not changes to scout-ui-v5 state or closures.
