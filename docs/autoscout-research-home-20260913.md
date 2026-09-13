# Auto Scout restored as the main product on ObligePay.com

Owner direction supersedes the sportsbook expansion. Base: d77624585961b48169b996b3d9b7a446d0965a0b; branch chatgpt/restore-autoscout-home-20260913.

The production domain, start command, volume, worker, provider variables and account/subscription storage remain unchanged. Root requests now reach the original account gate and native v5 research shell instead of spawning/proxying the newer Next.js sportsbook. /apex remains supported. Retired /sportsbooks and /preview bookmarks redirect to /apex; the legacy Taco hash is preserved. The retired guest and game-market endpoints return 410 without provider requests.

The complete guest/sportsbook frontend and its old branding/navigation assets are excluded from the Docker image. Source remains in Git only for recovery: it is not another active website, hidden tab, or separate running service. No wager processing was present, and none is introduced. User account data, existing server-side saved props and browser preferences are not deleted or migrated.

The v5 frontend is not replaced or moved to React. A small explicit presentation adapter removes the bet-slip host/action and slip-capacity label, but leaves the Save action, research calculations and event handlers intact. The original source remains recoverable. The build preparation script no longer replaces Auto Scout with ObligePay Edge or rewrites payment descriptions.

One scoped navy/emerald theme replaces the Edge presentation layer. It improves panel spacing, search/filter controls, typography, desktop navigation and mobile controls without another data-fetching layer. The account landing page uses the same palette and original authentication code. Browser title and installed-app metadata use Auto Scout. An accessible search shortcut focuses the existing player search.

Retained research capabilities: original multi-sport board, filters, full drawer, game-log statistics, saved props, Intelligence Studio, exact-offer Taco guards, existing ML availability checks, Ask/projection integrations, account and billing contracts. Missing historical event/teammate feeds and unavailable trained models remain honestly labeled. Rebranding does not establish new data coverage.

The retired sportsbook/guest release browser gates are replaced with direct account/research-home tests. Pure historical game-market normalization tests remain; the original research/data/auth/security regression suite remains. CI must validate both the native research home and the existing intelligence/ML/Taco browser fixtures before promotion. Local tests are not a deployment claim.

Rollback: revert this focused restoration. No database migration, external purchases, changed secrets or account transitions are involved. Do not merge earlier sportsbook-control candidates back over this owner reversal.
