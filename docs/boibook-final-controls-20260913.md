# ObligePay sportsbook / Auto Scout final consolidation

Base: production-stable fb509ff648d528b9d0a3f6f410e265de140d9e71.
User source: boibook-built(2).zip, SHA256 864f7b5d333e7599f045fff6b8023dd0cb78365865433d99107d14975de2b23e.

The uploaded archive is a reconstructed dark-green sportsbook interface with provider/sample separation and a hypothetical slip calculator. Its README expressly excludes real-money wager submission, deposits, withdrawals, accounts and wallets. None are activated by this release.

Production already contains the main GameBoard and the single eight-tool Auto Scout intelligence studio, plus Taco-only props in Auto Scout. PR53 was closed without merge to avoid replacing that concurrent work with a second engine. This incremental release ports only independent BoiBook-inspired controls into the existing GameBoard:

- American/decimal display, without changing canonical American prices or calculator arithmetic. Display preference is stored locally.
- Game favorites and a favorites-only filter. Favorites are scoped by the existing account ID in this tab's sessionStorage and survive reload; they are not cross-device or server-persisted saves.
- CSV export of the visible games and selected bookmaker quotes. Retains original lines, labeled American odds and timestamps. Neutralizes formula prefixes in text cells.
- Responsive controls at phone/tablet/desktop widths.

No dependency, provider, API, polling, quota, authentication, billing, database, start command, worker, or deployment settings changes. Auto Scout, its intelligence calculations and the Taco placement remain byte-for-byte unchanged.

Tests: existing scripts/verify-sportsbook.mjs now calls scripts/assert-game-controls.mjs. Existing auth/Ask/projection/Taco checks remain. The normal integrated Next.js build and browser workflow validates prices, favorites, persisted preferences, actual CSV contents, zero extra game requests for local controls, and 375/390/768px geometry. The Auto Scout browser regression is also triggered by this integration to protect the separate tab. Synthetic data is confined to explicit test routes, never production data.

Source syntax checks passed locally. Full build/browser/production status must be recorded from actual CI and Railway evidence, not inferred from file presence.

Keep these known research limits visible: Change Radar is visit-local; timeline has stored lines but no established historical injury/lineup feed; basketball minute scenarios are proportional what-ifs rather than calibrated predictions; teammate graphs require explicit verified participation and otherwise remain unavailable. No new advanced feed is purchased or fabricated.

Rollback: revert this focused controls commit; no migration or persisted server-data changes.
