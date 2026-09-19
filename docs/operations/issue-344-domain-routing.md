# Issue #344: apex DNS / forwarding divergence

Status: **PRODUCTION REPAIR BLOCKED; DO NOT CLOSE #344.** The branch supplies diagnosis and regression/acceptance tooling, not a production DNS change. No application, provider, webhook, auth, secret, deployment, or Railway service setting was changed.

## Verified evidence

Collected 2026-09-19 01:39:28 UTC (September 18, 20:39:28 America/Chicago) by the read-only GitHub Actions domain probe:

- Run: https://github.com/CodingForTheFun/global-capital-/actions/runs/35413325236
- Artifact: `issue344-domain-routing-proof`, ID `10574821286`.
- The runner resolver, Cloudflare 1.1.1.1, Google 8.8.8.8, and both authoritative nameservers agree. This is not merely one stale recursive cache.
- Authoritative NS: `ns41.domaincontrol.com`, `ns42.domaincontrol.com`.
- Apex A records: `15.197.225.128` and `3.33.251.168`, authoritative TTL 3600. No apex AAAA or CNAME answer was returned.
- www CNAME: `g6o5edca.up.railway.app`, authoritative TTL 3600; observed target A `69.46.46.35`.
- Apex HTTPS root GET returns 301 to `https://www.obligeprops.com` **without preserving the query**. Apex `/board`, `/research`, `/account` GETs return 404 from an EC2/GoDaddy forwarding endpoint. HEAD `/board` returns 405. API and PWA paths also return 404. Apex responses have no Railway request IDs.
- Apex normal TLS is a valid GoDaddy certificate for `obligeprops.com`, not the www Railway certificate. This rules out a public apex certificate-expiry explanation for the observed HTTP 404.
- www `/board` returns 200 with `Research Terminal` and Railway headers. Both generated Railway service hostnames return the identical board SHA-256 `999c2e1a0f4746641cd199b72552dd3b7469a737b28251ea7a9c74f70a457819`.
- Forced HTTPS/SNI probes to observed Railway edge addresses `69.46.46.114`, `69.46.46.34`, and `69.46.46.35` all serve www correctly. Apex at those same addresses fails certificate hostname verification (curl error 60). **These addresses are observations, not supported replacement DNS records. Do not hard-code them or accept curl -k as proof.**
- Railway HTTP logs from 01:39:27 through 01:39:34 UTC contain the www/railway-host probes under `ObligeProps-Issue344-ReadOnly/issue344-35413325236`, no apex probe requests, and four real PropLine webhook deliveries returning 200.

This proves that apex public traffic is diverted before the application. The existing Railway apex custom-domain attachment does not, on its own, establish usable public routing or TLS readiness.

## Expanded live acceptance

Run https://github.com/CodingForTheFun/global-capital-/actions/runs/35413787748 at 2026-09-19 01:48:52 UTC used verifier commit `879ba804726970a7a091f4c31d6d46eab34488c3`. Policy tests passed (29/29). The public job intentionally failed, preserving the incident.

All 22 www checks passed; all 22 apex checks failed. The www results include:

- `/`, `/board`, `/research`, `/account`: GET and HEAD 200, with encoded, repeated, empty, plus-sign and percent-encoded query parameters.
- `/site.webmanifest`, `/manifest.webmanifest`, `/app.webmanifest`: 200, manifest JSON and same-origin scope/start URL.
- `/sw.js`, `/app-worker.js`: 200, JavaScript and revalidation headers.
- `/api/account/me`: 200 JSON, signed out with no user; `/api/account/google/status`: 200 with the supported boolean readiness shape. This does not claim a completed Google sign-in.
- `/api/apex/props` and `/api/oblige-workspace`: expected 401 JSON; `/api/apex/diagnostics`: expected 403 JSON; protected responses remain non-cacheable.
- `/api/health`: 200. `/login`: its existing direct 302 to `/`.
- The same-origin Next image optimizer and the existing verified artwork resolver both return real PNG content for the existing public-photo delivery test. Resolver delivery remains observational, as in the previous verifier; optimizer delivery remains required.

The new probe sends only credential-free GET/HEAD requests. It never sends a webhook request, enters OAuth consent, creates an account, signs anyone out, or initiates provider polling. Full authenticated-session/OAuth and deployed-commit identity proof remain explicitly UNVERIFIABLE rather than being inferred from a title or readiness endpoint.

## Existing resources to preserve

Railway project `985b0a23-b223-4d66-8d5e-76a6a11a0a89`, production environment `478dc6b9-c485-49d7-8bd4-a8d28cdcc1ac`.

Frontdoor service `autoprop-live`, ID `f6d34023-04e3-4799-a3c4-defab50a7a1e`, target port 3000.

- Existing apex domain ID: `6974de2d-ca50-4b80-b13f-4b7e37cf20c5`.
- Existing www domain ID: `4347a1f7-847d-4c31-95c9-c88495c0a8f1`.
- Leave www CNAME, all other DNS/MX/TXT records, nameservers, auth secrets, cookie Domain/SameSite attributes, OAuth callback configuration and `PUBLIC_SITE_ORIGIN` unchanged during diagnosis.
- Keep `POST https://www.obligeprops.com/api/propline/webhook` direct. Do not redirect or replay it. Verify with real delivery logs, not synthetic events.
- Do not delete/recreate a working custom domain, redeploy the backend, or move the www domain onto the frontend-only service to solve an upstream forwarding fault.

## Controlled repair gate

1. Export/snapshot the existing DNS zone and forwarding settings from the authorized GoDaddy account. Retrieve the **exact current required DNS and verification records** for the existing apex Railway domain; the connected domain-list tool does not expose those records or certificate status. Never infer apex's required target/TXT from www's CNAME or from an observed edge IP. GoDaddy documents that domain forwarding owns/locks the apex A record until forwarding is removed: https://www.godaddy.com/help/forward-my-godaddy-domain-12123 . Do not disable the current forwarder until a replacement route and rollback have been prepared.
2. Replace root-only forwarding with supported apex routing to the existing frontdoor, or a TLS-capable path-aware edge configuration. Direct serving has the smallest application change. A canonical navigation policy may redirect GET/HEAD page entry routes to `https://www.obligeprops.com` using the original raw path and query, preferably temporary 307 during validation. It must run before creating host-bound auth state. Keep API/auth callbacks, webhook paths, service-worker scripts, manifests and same-origin assets directly served/proxied; a blanket cross-host 301/302/307/308 is not acceptance. Do not move tokens into URLs or broaden cookie scope to force a pass.
3. The provider must support the chosen apex DNS mechanism. If the existing DNS account cannot represent it, stop for an explicit edge/DNS-provider decision instead of changing the whole zone or guessing A records. Treat certificate readiness as a separate cutover gate: complete the provider's verification/issuance procedure and verify apex HTTPS with normal certificate validation. Any necessary DNS-to-certificate transition must be controlled and observed; no certificate bypass is an acceptable end state.
4. Recheck both authoritative nameservers and independent resolvers, TLS/SNI, normal public routing, GET and HEAD, and query retention. Then run the acceptance command below. Inspect real www webhook deliveries during the same window. Complete a real existing-account sign-in/callback/session/sign-out check through apex entry and www before claiming auth acceptance; never fabricate a session or change owner privileges for testing.
5. Rerun the existing `public-after-deploy` job against the actual deployed frontend revision. Leave the issue open on FAILING or UNVERIFIABLE evidence. Do not simply change the verifier's hostname to www or turn on unrestricted redirect following.

## Commands and reports

```sh
node --test tests/public-domain-routing.test.mjs
node scripts/verify-public-domain-routing.mjs
# Existing post-deploy board readiness allowance, bounded to 12 attempts:
DOMAIN_PROOF_BOARD_ATTEMPTS=12 node scripts/verify-public-domain-routing.mjs
```

The acceptance artifact remains `artifacts/public-restored-terminal/report.json`. Reports retain the www baseline even when apex fails. Navigation redirects are limited to one exact apex-to-HTTPS-www hop; path/query rewrites, unknown hosts, downgrade, credentials, fragments and redirect loops fail. APIs and service workers never follow redirects. The existing restored-board title, real optimizer photo delivery, TypeScript/build and browser checks are retained.

The isolated DNS diagnostic workflow's success means collection completed; it is not a health verdict. The public acceptance workflow exits nonzero until the required public checks pass.

## Access limitation at diagnosis time

The available GoDaddy connector exposes domain suggestions/availability only, not authenticated DNS or forwarding edits. A plugin search did not find a connected DNS manager. Railway's diagnostic agent returned `Agent usage limit reached`; no limit/billing changes were made. Connected Railway read tools were sufficient to inspect attachments/config and correlate logs, but not to repair the authoritative GoDaddy forwarding rule. Production DNS and routing therefore remain unchanged and unresolved.
