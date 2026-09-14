# Oblige Props on iPhone

## Immediate install path

Oblige Props is configured as a standalone iOS web app. On iPhone:

1. Open `https://www.obligepay.com` in Safari.
2. Sign in.
3. Tap Share.
4. Tap **Add to Home Screen**.
5. Turn on **Open as Web App**.
6. Tap **Add**.

The installed icon opens Oblige Props without Safari's normal browser chrome.

## App Store path

Do not submit a thin WebView wrapper. Apple requires App Store apps to provide enough app-specific utility beyond a repackaged website. A later native shell should add genuinely native value such as push alerts for saved props/snipes, Face ID session unlock, deep links, share-sheet actions, and native notification preferences while keeping the existing web/API product as the backend.

A public App Store release also requires Apple Developer signing, App Store Connect metadata, privacy disclosures, review access/demo credentials, and on-device/TestFlight QA. Because Oblige Props is sports-betting-adjacent research, keep the app positioned and implemented as analytics/research: it must not accept wagers, hold stakes, settle bets, or promise outcomes.

## Production safety

The service worker caches only static shell assets. It never caches `/api/*`, owner-console routes, or page navigations, so props, account state, permissions and billing data always come from the live server.
