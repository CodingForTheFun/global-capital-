# Backend release-parent recovery — 2026-09-20

This is a release-control-only recovery marker after PR #464 correctly failed the production review gate because its required pre-merge review evidence was missing.

- Source application correction: PR #463 (`Fail closed on incomplete fantasy-history windows`).
- The correction is already merged into `production-stable`; this file makes no Oblige Props application behavior changes.
- This file is not the active Railway watched deploy-lock path, so this merge must not start a customer-facing deployment.
- No provider, auth, scheduler/lease, quote-expiry, persistence, polling, secret, billing, database, DNS, or customer-data changes are included.
- Purpose: restore a PR-backed serialized parent so a separate reviewed deploy-lock PR can release the already-tested correctness fix through the normal production gate.
