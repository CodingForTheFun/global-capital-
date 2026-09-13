# Independent Edge release status — September 12, 2026

## Scope

The owner requested a separate site, not a merge into ObligePay Auto Scout. All new code is confined to standalone/edge-sports-20260912. Never merge this independent app tree into main or production-stable. This task did not modify the existing Auto Scout application or Railway services.

## Verified build

Application commit: 56500c70623e939929009db0abe2522972f34e70.
GitHub Actions run: 34729029049.

- Dependency installation succeeded and produced a real package-lock.json.
- Eight domain tests passed.
- TypeScript and Vite production build succeeded.
- Twenty integrated desktop/mobile/API/browser assertions passed.
- No browser JavaScript errors and no external browser requests.
- Screenshots, source and compiled static assets retained in edge-standalone-verified.

Checks include search, NFL routing, empty sport coverage, adjusted research lines, pushes, over/under, virtual stake calculations, saved local history, mobile drawer and isolation from Auto Scout. No real accounts, bets or payments were used.

## Publishing blocked by account limits

Railway refused a new project: Free plan resource provision limit exceeded. No upgrade or existing-service replacement was performed.

An independent Netlify site was created: edge-standalone-ty, site ID 3ff40dca-bb87-481b-829b-1141dfcb6b49. Public visitor settings are enabled only for that new site.
The tested compiled build was uploaded to Netlify production deployment 6aa5f41bf6f826fb243f22c1. Netlify returned state=error, skipped=true, error_message='Skipped due to account credit usage exceeded', published_at=null. Therefore the new site is NOT live.

The deployment capability was passed only as one-time strong ciphertext to its ephemeral CI recipient. No plaintext token or private key was committed. The recipient private key was deleted; the encrypted handoff and one-time deployment scripts have been removed from the branch. Automatic CI now only validates and packages; it does not repeatedly attempt deployments.

An AppDeploy connection was suggested as an alternative and was not yet installed at the last check. Finish publishing only through an available, authorized hosting connection; do not change billing without approval.

## Product boundary

This is an interactive sample-data version of the approved design. Virtual credits have no cash value. Demo slips are browser-local and ungraded. There are no connected live feeds, real bets, deposits, withdrawals, account authentication or subscription billing. Original Auto Scout keys, accounts and backend are not reused.
