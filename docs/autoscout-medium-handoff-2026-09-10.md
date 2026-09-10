# Auto Scout — Medium implementation checkpoint

Status: implementation candidate, NOT production-ready or deployed.

Branch: `chatgpt/autoscout-completion-audit`, based on production `25dec72431fc84fefbab70106424ed44c25cfebc` plus the High audit commit. Other Claude/ChatGPT worktrees were preserved. Read `AUTOPROP_COORDINATION.md` and the High audit before continuing.

## Changes

- Existing v5 frontend extended with a navy/blue research board, desktop statistics, mobile cards, responsive drawer, safe unavailable states, accessible control labels, keyboard drawer handling, display preferences and real destination links. No replacement app or provider migration.
- Board filtering calls the existing `lib/filters/index.mjs`. Its new optional book, research availability, multiple window thresholds, saved, start-time and projection-difference filters fail closed when explicitly required data is missing. Existing default qualifier behavior is preserved.
- Board lines are actual supplied offers for the selected side/book; the drawer separately reports the book-weighted median consensus. Best-price highlights compare the same threshold and side. Adjusting a research line does not alter sportsbook quotes.
- Shared `lib/analytics/research.mjs` computes side/line/venue windows, strictly matched H2H, deduplicated games and push outcomes. API and frontend use it. Truncated logs do not become season statistics. Complete-season coverage requires explicit evidence. Individual games cannot become season totals. Known unfinished games are excluded, including statuses on joined games.
- Both existing research providers and fallback paths remain. ClearSports adapters share a coalescing cache. Failed requests have bounded cooldown caches. Research responses are cached; browser concurrency is three with a bounded pending queue, no automatic whole-board historical fan-out, and useful explicit batches. Superseded sport loads are aborted/ignored.
- Drawer exposes independent context even when game history is unavailable. It offers local line/side/window/venue recalculation, actual game bars with a common threshold scale, pushes, sport-specific log columns, book comparison, and a persisted history table scoped to prop/book/side. A single snapshot says “Building line history.” No artificial observations are created.
- Added `/api/saved-props` on the deployed legacy auth server. Saves use the existing authenticated access-profile subject on the mounted data volume, with atomic writes, serialized mutations, owner/member separation, origin checks, rate limits and revocation checks. These are **access-profile saves**, not new Supabase Auth accounts; sharing a code shares its saved list. The UI explains this and offers explicit device-save import. A server error does not silently switch to device-only persistence.
- Existing Supabase `saved_props` is not used because its foreign keys require actual Supabase Auth users, while the deployed auth server does not issue those identities. No database schema, RLS, RPC permission, auth identity or provider environment changes were made.
- The core process now owns the existing frugal persistence scheduler and board cache. It automatically stays off when Claude's opt-in ingest worker is enabled. The frontdoor no longer starts a second scheduler. No new snapshot behavior on cache hits.
- Public Apex-next health/board responses use the existing sanitizer. Provider infrastructure fields remain private. Browser access is limited to a fixed allowlist of shared source modules and CSS.
- `npm run dev` now starts the actual ClearSports frontdoor, honors `--port`, disables legacy automatic scanning and keeps demo mode off. Production start configuration is unchanged.

## Verification actually completed

| Check | Result |
|---|---|
| `npm run check` | 304 tests passed, zero failures; includes existing syntax checks |
| Saved storage isolation and concurrent writes | Passed |
| Actual `server-scout.mjs` saved API with test credentials | Passed: anonymous 401, cross-origin 403, same-profile persistence across sessions, owner/member isolation, alternate rejection, revoked-session 401 |
| Game/season separation with test provider responses | Passed: aggregate rejected as game log, active joined game excluded, genuine zero preserved, individual game rejected as season total, shared cache |
| Actual `frontdoor-clearsports.mjs` HTTP smoke with no provider credentials | Passed: health, shell, stylesheet, transitive browser-module imports/MIME, anonymous saved API, public health sanitization and unavailable research |
| Diff whitespace validation | Passed |
| Supervised preview startup | Passed after development entry-point repair |
| Candidate desktop/mobile browser QA | **Blocked; not passed** |
| Candidate Railway deployment/build | **Not performed**; no Docker runtime available locally |
| Candidate live Supabase/auth/provider end-to-end audit | **Not performed** |

The project is a Node/vanilla-JavaScript application with no separate frontend compilation script. Syntax/test and HTTP smoke passes are not a Railway container-build pass.

## Browser blocker and exact resumption task

The browser can reach the preview root. The `/apex` script's request for `/assets/lib/analytics/research.mjs` fails with `net::ERR_BLOCKED_BY_CLIENT`. A direct browser navigation to that resource is also rejected. The real production entry-point HTTP smoke independently confirms that the resource and its transitive dependencies return HTTP 200 and JavaScript MIME types. Do not infer that the UI passed from the server checks.

The Sites preview troubleshooting skill permits at most two start attempts, already used: the first failed because the old dev command listened on 3000; the second succeeded after the entry-point repair. It prohibits bypassing the browser restriction with alternate hosts/ports or rewriting working source to compensate for browser access rejection. No alternate browser-control path was used.

**Resume in Medium with browser QA once the preview access restriction is resolved.** Verify the real captured board (never invent product data) and available provider game logs, desktop and iPhone layouts, filters and sorting, sport-switch races, chart alignment including zero/negative results/pushes, line/side recalculation without requests, focus restoration, save/import/logout/error paths, and isolated line-history series. Correct any defects before switching to Low. A visual polish pass has not yet been validated.

After those checks, reconcile `production-stable` again before integration. Run the repository checks against the reconciled commit. Do not apply unrelated staged Railway environment changes. The earlier audit push was rejected by automatic approval review; do not assume this checkpoint was published. Resolve publication authorization without bypassing that rejection, then use the existing deployment path and perform the user's full live production audit. Do not declare Auto Scout finished until those gates pass.

Alerts remain explicitly unavailable; no delivery is simulated. Full-season averages/hit rates, injury/starter/minutes context, H2H and projections remain unavailable wherever the connected feeds do not supply reliable evidence.

## Subsequent implementation checkpoint

Latest application commit: `e20983c`. The five implementation commits beginning at `d3d14c6` also add stable refresh/focus behavior, stale saved-snapshot labels, preserved partial research context, an observation-only history chart, research retry, and fallback historical-game eligibility guards. Final checkpoint: **308 tests passed**, zero failures; changed JavaScript syntax checks passed. Working application changes are committed locally. No deployment or browser-pass claim.

Claude review scope: review these commits without rebuilding. Prioritize sample eligibility/null/push semantics, access-profile save isolation, UI refresh/focus races, real-line selection versus consensus, history-series isolation, and browser/mobile behavior. Return verified defects with file/function and reproduction steps for targeted fixes. Browser access, Railway container build/deployment and live end-to-end verification remain outstanding.
