# Jev gateway (Vercel)

A small Vercel service that holds the TypeSafe key and exposes Jev to the
Railway app. The main app stays on Railway; only Jev calls go through here.

```
Railway app ──(JEV_GATEWAY_SECRET)──▶ Vercel jev-gateway ──(TYPESAFE_API_KEY)──▶ api.typesafe.ai
```

## Endpoints

- `GET /api/health` — reports whether the key and secret are configured (booleans only).
- `POST /api/evaluate` — `Authorization: Bearer <JEV_GATEWAY_SECRET>`, body
  `{ state, questions, model? }` exactly as the
  [TypeSafe API](https://docs.typesafe.ai/api) defines it. `model` defaults to
  `jev-latest`. Returns `{ model, answers, usage }`. Retries 429/529 with backoff.

## Deploy

1. In Vercel, create or reuse a project with **Root Directory** set to
   `services/jev-gateway` (no framework preset, no build command).
2. Connect the TypeSafe integration to that project so it injects
   `TYPESAFE_API_KEY`.
3. Add `JEV_GATEWAY_SECRET` to that project — a long random string.
4. On Railway, set `JEV_GATEWAY_URL` (the Vercel deployment URL) and the same
   `JEV_GATEWAY_SECRET`.

Until step 4 is done the Railway client (`lib/jev/client.mjs`) returns
`{ ok: false, reason: 'not_configured' }` and callers keep their existing
behaviour.
