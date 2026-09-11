# What Auto Scout needs before it can take payments

You asked for subscriptions and payment methods, and chose to see the
requirements before any payment code is written. This is that list.

Nothing here is a payment integration. The account system, the plan model and
the daily limits are built and live in the code; the only thing missing is the
processor, and the reason to hold it is below.

**Check the current wording of any policy quoted here against the processor's
own live documentation before you act on it.** Acceptable-use policies for this
category change, and a summary written today is evidence of intent, not a
guarantee.

---

## 1. The distinction the whole thing rests on

Every major processor treats *gambling* as a restricted or prohibited business,
and treats *sports information and analytics* as ordinary commerce. Auto Scout
is the second thing. That is not a technicality you argue after the fact — it
has to be visibly true in the product, because a reviewer will look at the live
site, not at a description of it.

What keeps Auto Scout on the right side of that line today:

- It does not accept wagers, hold stakes, or settle bets.
- It does not hold customer funds or move money between users.
- It reports what the connected sportsbook feeds and game logs actually
  returned. It does not promise outcomes.
- The betslip is a sizing calculator. Nothing in it places a bet anywhere.

What would move it across the line, and must not be added without deciding to
become a regulated business first:

- Taking a stake, holding a balance, or paying out.
- Affiliate links that hand a user off to a sportsbook for a cut of their
  losses. This is a **separate** regulated activity in most US states and many
  countries, with its own licensing, and processors treat revenue from it
  differently than subscription revenue.
- Any copy that reads as a guarantee: "locks", "guaranteed winners", "can't
  lose", a claimed win rate you cannot evidence from your own records.

The last one is the easiest to trip over and the most common reason this
category gets shut down. Marketing copy is part of the compliance surface.

---

## 2. Age gating

Sports-betting-adjacent products are sold to adults. The legal minimum is 18 in
most places and 21 in a number of US states.

The practical standard for a research tool is:

- An age attestation at sign-up ("I am 18 or older"), recorded with a timestamp
  against the account.
- Terms that make 18+ a condition of use.
- No advertising placement aimed at minors.

Full identity verification (document upload, KYC) is what a *sportsbook* needs.
A subscription research product does not, unless a processor asks for it
specifically.

**Decision needed from you:** 18 or 21 as the stated minimum. 21 is the
conservative choice and costs you very little, because the people who will pay
for this are overwhelmingly over 21 anyway.

## 3. Geography

Some jurisdictions restrict even information services about sports betting.
Others are a problem because of sanctions rather than gambling law.

- Sanctions screening is not optional and is not something you implement
  yourself: Stripe, Paddle and PayPal all block sanctioned countries at their
  own layer once you are onboarded. That part comes free.
- Blocking specific US states is a business decision, not a legal requirement
  for a pure information product. If you decide to, it is a country/region
  check at sign-up and a line in the terms — not a geolocation SDK.

**Decision needed from you:** sell worldwide, or restrict. Restricting later is
harder than restricting now, because you have to cancel existing subscribers.

## 4. The documents a processor will ask for

Have these written and live on the site *before* applying, because the
application asks for their URLs:

| Document | What it must contain |
| --- | --- |
| Terms of Service | What the subscription is, 18+ (or 21+), no guarantee of outcomes, that this is information and not betting advice, how to cancel |
| Privacy Policy | What you collect (email, sign-in provider, saved props, usage counts), what you do with it, who it is shared with, how to delete an account |
| Refund policy | Stated plainly. For a monthly digital subscription, "cancel anytime, no refund for the current period" is standard and accepted |
| Pricing page | Price, billing interval, and what each plan includes, visible before checkout |
| Contact | A real, monitored email address on the site |

A processor reviewing a sports-data subscription will look for exactly these,
and the review goes faster when they are already there.

## 5. The business itself

- A registered business entity and a bank account in its name.
- Tax registration for the jurisdiction the entity is in.
- For EU/UK customers, VAT on digital services — this is the strongest argument
  for a merchant of record (see below), which handles it for you.

## 6. Which processor

| Option | What it means here |
| --- | --- |
| **Stripe Billing** | Lowest fees, best API, most control. You are the merchant: you own sales tax and VAT. Sports analytics is permitted; read their restricted-business list yourself and keep a copy of the date you read it |
| **Paddle / Lemon Squeezy** | Merchant of record: they take a larger cut and handle VAT, sales tax and invoices entirely. Materially less work, and their review for this category is stricter and slower |
| **PayPal** | Already partially wired in this codebase (`payments/paypal.mjs`, one-time payments, not subscriptions). Familiar to customers, but the account-freeze risk in betting-adjacent categories is real and the subscription API is the weakest of the three |

My recommendation is **Stripe**, with the caveat that you own VAT. If you would
rather never think about tax, Paddle, and accept the higher cut.

**Decision needed from you:** which one. It changes the integration, not the
architecture — the seam is the same either way.

---

## 7. What is already built, waiting for that decision

- `lib/billing/entitlements.mjs` — the plan ledger. `grantPlan()` requires a
  `source` naming what authorised it, so a subscription can only ever come from
  a processor webhook and never from something the browser claims.
- `lib/billing/usage.mjs` — the daily counts that make a plan mean something.
  Enforced right now on `/api/props/predict` and `/api/props/ask`.
- `PLANS` in `entitlements.mjs` — free and pro, with the limits each gets.
  Prices are deliberately not in there yet, because a price that exists in the
  code but not at a processor is a price nobody can pay.

When a processor is chosen, the work is: a checkout route, a webhook endpoint
that verifies the processor's signature and calls `grantPlan()` / `revokePlan()`,
and a price on the plan card. The parts that touch the rest of the app are
done.

## 8. What I need from you to switch sign-in on

Separately from payments, two things are needed before anyone can create an
account on the live site:

1. **A transactional email provider**, so verification and password-reset codes
   are actually delivered. Set one of `RESEND_API_KEY`, `POSTMARK_API_TOKEN` or
   `SENDGRID_API_KEY`, plus `MAIL_FROM` on a domain you control. Without this,
   email sign-up is a dead end — the code is generated and never arrives — and
   the panel says so rather than pretending otherwise.
2. **Google OAuth credentials**, if you want the Google button. Create them in
   Google Cloud Console with the authorised redirect URI
   `https://www.obligepay.com/api/account/google/callback`, then set
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`.

Google alone is enough to open sign-up, because Google has already verified the
address. Email alone is enough too. Neither is set today, so the sign-in panel
currently explains that accounts are not switched on yet.

Also set **`ACCOUNT_OWNER_EMAIL`** to your own address before sign-up opens.
Without it, the first account created becomes the owner account — which, on a
public sign-up page, means the first stranger through the door.
