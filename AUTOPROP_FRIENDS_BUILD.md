# AutoProp Scout Pro — Friends Build

This branch is the integration target for the shareable multi-user build.

Baseline: latest `main` from the other AutoProp chat.

Carry forward all non-conflicting main features, including unlock-aware PickFinder auth, focused prop search, adaptive scan controls, payment-ready server pieces, and the coordination contract.

Add/require:
- Each AutoProp user has a separate account.
- Each user connects only their own PickFinder account.
- PickFinder credentials, cookies, rules, results, and history are isolated per user.
- No user's PickFinder session can be used by another user.
- A scan cannot start until the user's saved PickFinder session is positively verified as unlocked.
- Malformed placeholder records never reach the visible prop feed.
- Live game scores/game status and supported live player box-score data are available independently of PickFinder scans.
- Mobile-first shareable dashboard.

Latest user instruction supersedes the earlier regular-only-only restriction: retain the other chat's latest multi-book/Goblin functionality where it is explicitly verified and clearly labeled. Do not fabricate or infer unavailable lines.
