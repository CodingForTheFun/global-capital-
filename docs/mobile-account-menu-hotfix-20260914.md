# Mobile account menu hotfix — 2026-09-14

Adds an always-visible top-right account/security menu on the research app, especially on mobile.

The menu reuses the existing server-backed account flows and exposes:
- Sign in / create account when signed out
- Reset password when signed out
- Account & security when signed in
- Security & devices when signed in
- Saved props
- Display settings
- Sign out
- Support / Control only when the server-issued capabilities authorize them

No authentication, authorization, billing, provider, or entitlement rules are moved into the browser. The owner and support routes remain server-protected.
