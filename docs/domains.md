# Domains

Canonical customer origin: **https://www.obligeprops.com**

Everything else that resolves to this service redirects there. The redirect
lives in `lib/edge/gateway.mjs` (`redirectRetiredHost`) and runs before any
other request handling.

## Current state

| Hostname | DNS today | Serves | Action |
| --- | --- | --- | --- |
| `www.obligeprops.com` | CNAME `g6o5edca.up.railway.app` | the site | none — working |
| `www.obligepay.com` | CNAME `eukxt6y7.up.railway.app` | **TLS warning** | update CNAME (below) |
| `obligeprops.com` | A `15.197.225.128`, `3.33.251.168` | 404 | forward to www (below) |
| `obligepay.com` | A `15.197.225.128`, `3.33.251.168` | parked | optional, forward to www |

Both zones are on GoDaddy (`ns*.domaincontrol.com`).

## Why the old domain shows a security warning

`www.obligepay.com` still points at Railway but had been removed from the
service, so Railway answers it with the wildcard certificate for
`*.up.railway.app`. That name does not cover `www.obligepay.com`, so browsers
refuse the connection:

```
subject: CN=*.up.railway.app
subjectAltName does not match www.obligepay.com
SSL: no alternative certificate subject name matches 'www.obligepay.com'
```

A retired domain that throws a certificate error reads to a visitor as a
compromised site, not a moved one. It is worse than the domain simply not
resolving.

## Required change 1 — www.obligepay.com

The hostname is attached to the service again, so Railway will issue a
certificate as soon as DNS points at the new target it assigned.

At GoDaddy, in the `obligepay.com` zone, edit the existing `www` record:

| Field | Value |
| --- | --- |
| Type | CNAME |
| Name | `www` |
| Value | `fua2met6.up.railway.app` |
| TTL | 600 |

The current value is `eukxt6y7.up.railway.app`, which belongs to the earlier
attachment and no longer validates. Certificate issuance is automatic and
usually completes within minutes of propagation. Verify with:

```
curl -sSI https://www.obligepay.com/ | head -1      # expect 301
```

## Required change 2 — the bare obligeprops.com

Railway asks for a CNAME at the bare domain, but **GoDaddy cannot host a CNAME
at the zone apex** — that is a DNS restriction, not a Railway one. Two ways
forward:

**Option A (recommended, no Railway involvement): GoDaddy Forwarding.**
Domain Settings → Forwarding → Add, forward `obligeprops.com` to
`https://www.obligeprops.com`, permanent (301), forward only. The bare domain
then never reaches this service, so its Railway attachment can be removed to
stop it sitting in a permanently unvalidated certificate state.

**Option B: move the zone to a DNS provider that supports ALIAS/ANAME at the
apex** (Cloudflare, Route 53, DNSimple), then point the apex at
`8525blpb.up.railway.app`. Only worth it if you want the apex served directly
rather than redirected.

Either way the visitor ends at `https://www.obligeprops.com`.

## Optional — obligepay.com bare

Same treatment as change 2, forwarded to `https://www.obligeprops.com`.
Only matters if the bare old domain was ever shared.

## Adding another hostname later

1. Attach it to the `autoprop-live` service so it can hold a certificate.
2. Point DNS at the target Railway returns.
3. If it should redirect rather than serve, add it to `retiredHosts` in
   `lib/edge/gateway.mjs` and extend `tests/canonical-host-redirect.test.mjs`.

Never add a Railway hostname to `retiredHosts`. The platform healthcheck and
the deploy smoke tests call the service domain directly, and redirecting those
fails every deploy.
