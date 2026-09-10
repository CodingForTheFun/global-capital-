# AutoProp Scout Pro

Production PickFinder prop-research worker and mobile dashboard. The live service uses Playwright, strict fail-closed filtering, encrypted sessions, adaptive dropdown rollback, dynamic PickFinder app/book discovery, ranked PrizePicks Goblin/Demon lines, focused player/prop search, and PayPal/card checkout scaffolding.

Production scans are live-only; there is no sample-data fallback in the scanner entry point.

## Accounts

The dashboard is gated by real user accounts backed by **Supabase Auth**. The
old shared `DASHBOARD_PASSWORD` gate has been removed entirely.

Sign-up sends a 6-digit code to the user's email, the code confirms the
address, and the session is then held in a single AES-256-GCM encrypted,
HTTP-only cookie. Supabase tokens never reach the browser and nothing is
stored in `localStorage`.

| Route | Purpose |
| --- | --- |
| `/auth.html` | Sign in, sign up, email confirmation, password recovery |
| `/admin.html` | Admin console (admins and the owner only) |
| `/` | Dashboard (any confirmed account) |

Roles live in `public.users.role` and are `USER`, `PREMIUM`, `ADMIN`, `OWNER`.
The first account created becomes `OWNER`. Managing the PickFinder connection
and editing scan rules require `ADMIN` or `OWNER`; every other `/api/` route
requires a confirmed account.

### Required setup

1. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (see `.env.example`).
2. **Turn on 6-digit codes.** In the Supabase dashboard under
   *Authentication → Email Templates*, edit **Confirm signup** and
   **Reset password** so the body includes `{{ .Token }}`. Supabase ships
   templates that only contain `{{ .ConfirmationURL }}`; without `{{ .Token }}`
   no code is emailed and the confirmation screen cannot be completed.
3. Optional: set `SUPABASE_SERVICE_ROLE_KEY` to enable the admin console's
   identity panel (confirmation state, last sign-in) and server-side
   subscription writes.
4. Optional: configure a mail provider (`MAIL_PROVIDER` and friends) for this
   app's own security alerts — new-device sign-ins and password changes.
   Supabase sends the verification and reset codes; it does not send these.

Database provisioning is handled by the `handle_new_user` trigger: every
`auth.users` row gets a `public.users` profile and a free `subscriptions` row,
so no foreign key is ever left dangling.

## Data layer

`db/repositories.mjs` is the single read/write path to Supabase and is
deliberately **fail-closed**: with no database configured, or no rows ingested,
every call returns `{ available: false, reason }`. Nothing estimates, derives
or fabricates a statistic.

| Surface | Table | Behaviour without a provider |
| --- | --- | --- |
| Line history / movement | `line_snapshots` | Reports "no history recorded" |
| Book spread | `prop_lines` | Reports "no book lines stored" |
| L5 / L10 / L15 / H2H | `player_statistics` | Reports "no game-stat provider connected" |
| Injuries | `injuries` | Reports "no injury provider connected" |
| Live scores | `games` | Reports "no live scores provider connected" |
| Headshots | `players.headshot_url` | Returns `null` so the UI renders initials |

Headshots are only ever served from a licensed URL a provider wrote. Images are
never scraped, hot-linked or substituted with look-alikes.

### Writes go through the existing ingest function

The database already exposes a token-gated backend path,
`public.autoscout_ingest_board(p_token, p_payload)`, which upserts bookmakers,
markets, events, players, props, lines and snapshots in one transaction and
returns per-section counts. `db/ingest.mjs` speaks that contract, so writes use
it rather than opening a second write path. Set `AUTOSCOUT_BACKEND_TOKEN` to a
value whose SHA-256 hash is enabled in `private.autoscout_backend_tokens`.
Without it, line-history writes fall back to a direct service-role insert, and
without Supabase they report `skipped` rather than silently succeeding.

`providers/catalog.mjs` reports which data sources have credentials present.
A source without its environment keys reports `missing-credentials` — it is
never described as connected.

## Subscriptions

`billing/entitlements.mjs` defines the tiers and what each unlocks. The server
enforces them; the UI only mirrors them. Admins and owners are never gated out
of the product they operate. Free accounts get a daily scan budget; line
history requires Pro.

## Commands

```bash
npm start      # production server (server-production.mjs)
npm run dev    # watch mode
npm run scan   # one-off CLI scan
npm run check  # syntax check every module, then run the test suite
npm test       # node:test suite
```
