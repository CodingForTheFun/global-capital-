# Organized player board and verified artwork

Owner requested correct player images, fewer N/A props, and prop-type categories without repeated player cards. Built from production 09f9b050d81cad47d49884428de581265045bea3 on chatgpt/organized-player-board.

## Implemented

- Prop-type category chips and one card per player in each category. All-players view also keeps one card per player and provides a selector for that player's exact market/game combinations. Pagination operates on unique players, not repeating market rows. No event's lines or logs are combined with a different event. Provider identities, sport and team-unit identities remain separate.
- Duplicate same-book/side/line quotes retain the latest supplied timestamp. No invented current quotes or source reassignment.
- Artwork endpoint now uses an exact league-qualified public athlete identity, verified source photo URL, response content checks and bounded/coalesced requests. Removed the active route's unsafe 'first player result' fallback. A fresh versioned disk cache and URL bypass old wrong-athlete/one-week missing-image caches. Short unavailable/error caching permits recovery; absent photographs use an explicitly unavailable neutral placeholder, never another athlete.
- Real NFL longest-completion, longest-rush, longest-reception and defensive-interception columns now resolve. Passing interceptions cannot count as defensive interceptions. Unknown required fields remain unavailable, not zero.
- Empty identity-search results and retryable source failures no longer stick in long-lived caches. Research batches retain their original selected line/side cache key while requests are in flight.
- Whole-prop missing history is a compact explained availability panel instead of eight repeated N/A cells. Genuine missing H2H or current-season samples still show N/A. Loading, retry and sport-transition state are distinct.

## Validation evidence

Application candidate 931d4077a20d050c86e48740fdafeaaf625d509f passed GitHub Actions run 34728723801, artifact organized-board-validation:

- npm run check: 487 tests passed, no failures or skips.
- Chromium 1440x900 desktop and 390x844 mobile: unique-player categories and all-players grouping; all ten fixture player prop/game selections reachable; 20 + 4 nonrepeating paginated players; automatic research in batches of at most four; initial skeletons; line and side recalculation; no-log display; failed-image fallback; sport-switch state; failed-batch retry; no page JavaScript errors or horizontal overflow.
- Browser data above are isolated captured-history/test-offer fixtures, not production quotes. Real-source checks were separate: verified actual photograph responses for Aaron Rodgers (NFL), Jayson Tatum (NBA), Caitlin Clark (WNBA), Shohei Ohtani (MLB), and Lionel Messi (MLS).
- Live public historical rows returned for Jordan Love longest completion (15), Puka Nacua longest reception (17), and Micah Parsons defensive interceptions (14). Test line 0.5 was an arbitrary verification threshold, not a live sportsbook quote or recommendation.

After candidate validation, a read-only production-check workflow/script was added to verify actual signed-in desktop/mobile categories, nonrepeating cards, rendered numeric L5 metrics and verified loaded image responses after rollout. Its results must be checked separately; the existence of this script is not proof of a successful production run.

## Preserved constraints

No production settings, provider credentials, auth, paid data plans, database permissions, scheduler settings, hard regular-line exclusions or account/guest-dashboard code changed. Existing blocked PR #46 was not merged or used to bypass its workflow approval gate. Source gaps remain explicit: do not claim all athletes, all photos or every statistical market now have complete coverage. Newly updated source history is not fabricated to hide N/A.
