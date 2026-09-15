# Oblige Props sportsbook selector checkpoint — 2026-09-15

Adds a per-prop sportsbook dropdown to the current production runtime without changing provider APIs, backend contracts, credentials, or schedulers.

- Default: All books · best line.
- Options: only books with live normalized rows for that exact prop.
- Selection is scoped per prop card.
- Selected book controls that card's displayed line, price, side availability, historical research threshold, repriced projection, and ML target.
- Over/Under line and price display sits beside the dropdown.
- Missing data remains unavailable; no values are fabricated.
- No extra upstream request is made when switching books.
