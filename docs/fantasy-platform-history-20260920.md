# Shared fantasy history

Fantasy Score and Fantasy Points research can now use PropLine's graded actual
values for the selected platform when a complete verified local scoring formula
is not available. This is one shared path rather than a WNBA-only formula.

The provider contract is `PlayerHistoryOut` / `PlayerHistoryEntryOut` from
https://api.prop-line.com/openapi.json and the completed-game archive described
at https://prop-line.com/docs (checked 2026-09-20).

The fallback requires the exact player, sport, market and bookmaker. Each recent
completed game must have a finite, non-redacted resolved value at that bookmaker.
Grades must agree with the historical line. Conflicting duplicates, voids,
missing values and incomplete samples remain unavailable. Zero and negative
scores are valid. The selected prop's current threshold is applied by the same
research engine as other props, not copied from old win/loss grades.

The game archive prevents unpriced games from silently disappearing from rolling
windows. Full-game results are never used for periods or multi-player combos.
Unknown or ambiguous sport namespaces remain unavailable. Missing provider data
does not become a verified formula and a returned sample is not a complete season.

Existing verified NBA/MLB PrizePicks formulas remain preferred. The recent
incomplete-component and retryability fixes are unchanged. The legacy browser
league allowlist is removed so server-verified results can reach that surface.
No source budget, scheduler, account, deployment gate or frontend design changes.

Regression coverage includes 17 exact sport namespaces across PrizePicks and
Underdog, identities, zero/negative values, missing/void/redacted records,
conflicts, current/future games, periods, combos and transport failures. This is
contract coverage, not a claim that the provider has historical data for every
sport or player. Production coverage must be checked after rollout.

Production integration also admits full-game fantasy research for every known
board sport without enabling automatic provider polling. Source-native periods
and season tags remain restricted. Legacy per-prop book selection participates
in request/cache identity; queued requests capture the original selection and
cannot reuse another platform's generic base cache. Single and batch requests
both retain event cutoff, period and player role. Raw and prefixed upstream player
IDs are checked against all IDs returned by history and archive. Regression tests
execute the composed production client's real functions and the batch parser.
