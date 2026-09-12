# ObligePay Edge Guest Dashboard

Standalone Next.js App Router preview experience for unauthenticated visitors.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `OPENAI_API_KEY` to enable `/api/ask-prop`.

## Guest conversion behavior

- 4 sample prop cards are interactive.
- Locked rows and advanced filters open the account modal.
- Line adjustment changes by 0.5.
- Over/Under changes chart hit coloring.
- Guests get one AI question per browser session.
- The server also sets an HTTP-only guest-use cookie and returns `403 { error: "AUTH_REQUIRED" }` on a second request.
- AI answers are constrained to the supplied card JSON and must not provide betting advice.

## Integration

Keep this app isolated until build verification passes. Once verified, it can replace the public guest route while the existing Auto Scout backend remains the authenticated data engine.
