# Taco placement correction

Owner requested Tacos only in Auto Scout, not the sportsbook.

- Sportsbook board switch contains Game lines and Player props only.
- Removed the unused Next.js TacoBoard and its render/import path.
- Legacy /sportsbooks#tacos and /#tacos redirect to /apex#tacos.
- Auto Scout quick prop controls contain 🌮 Taco-only props, off by default.
- Display-only isolated panel uses existing /api/apex/taco-offers and current sport.
- Back to regular props restores the board; no changes to scanner rules, measured stats, Ask, saves, providers, credentials, backend routes or budgets.
- Only verified feed offers with unexpired discount metadata display; empty, malformed and failed responses remain explicit. No live Taco availability is claimed.
- Existing release build/QA now checks correct placement, no sportsbook entry, original/discounted lines, expired-offer rejection, mobile layout, sport switching and return navigation. Fixture data is confined to CI.

Preserve parallel Auto Scout intelligence work; this correction only extends the existing public navigation bridge, not scout-ui-v5 state or closures.
