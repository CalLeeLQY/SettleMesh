# SettleMesh

SettleMesh is a Next.js/Supabase MVP for a credit-based payment gateway. The app
currently uses the AnyPay product name in the UI and exposes hosted checkout,
merchant API keys, user top-ups, wallet ledger entries, and Stripe-backed fiat
payment flows.

## Tech Stack

- Next.js App Router with React and TypeScript
- Supabase Auth, Postgres, and SSR session helpers
- Tailwind CSS v4
- Stripe Checkout integration for fiat top-up and checkout payments

## Getting Started

Install dependencies and start the local app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Create a local environment file such as `.env.local` or `.env` with the values
for your Supabase and payment provider projects.

Required for the core app:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Required for Stripe flows:

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
# Optional. Defaults to card so Checkout keeps working while account-level
# payment methods are being reviewed. Use card,wechat_pay after Stripe enables
# WeChat Pay for the account, or dynamic to let Stripe Dashboard decide.
STRIPE_PAYMENT_METHOD_TYPES=card
```

Configure the Stripe webhook endpoint to send Checkout events to
`/api/stripe/webhook`. The app handles `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
and `checkout.session.expired`.

Development and test-only switches:

```bash
ENABLE_MOCK_FIAT_CHECKOUT=true
```

`mock-fiat` checkout is available by default only for local development
(`NODE_ENV=development` without a hosted deployment environment). Set
`ENABLE_MOCK_FIAT_CHECKOUT=true` to opt in explicitly, or
`ENABLE_MOCK_FIAT_CHECKOUT=false` to force-disable it locally.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Database Migrations

Supabase migrations live in `supabase/migrations`. The checkout completion path
uses the `complete_checkout_session` RPC so wallet debits, merchant credits,
ledger entries, and session completion happen in one database transaction. Top-up
completion uses the existing `complete_topup_order` RPC and may then complete a
linked checkout when the top-up was started from `/checkout/{id}`.

The historical baseline schema was created before this repo had local migration
files. Treat the current migrations as forward migrations and add a full baseline
export before relying on repeatable greenfield deployments.

## Key Routes

- `/api/v1/protocol` exposes the current payment protocol version, capabilities,
  endpoint templates, and webhook signature rules.
- `/dashboard` shows the signed-in user's wallet and recent ledger entries.
- `/topup` starts a Stripe Checkout top-up and returns to the requested in-app path.
- `/developer` lets a signed-in user create merchant settings and API keys.
- `/checkout/[id]` is the hosted checkout page for credit or fiat payment.
- `/api/stripe/webhook` finalizes Stripe top-up and fiat checkout payments.
- `/api/v1/checkout/create` lets merchants create hosted checkout sessions.
- `/api/v1/checkout/[id]` lets merchants query checkout session status.

See `docs/payment-protocol.md` for the merchant-facing protocol contract,
including the `payment_protocol` response object, idempotent checkout creation,
and webhook verification.

## Test Utilities

- `test/merchant-demo` is a standalone local merchant site that creates hosted
  checkout sessions through a merchant API key.
- `test/payment-smoke` is a Node-based smoke test harness. Review it before use,
  because it depends on seeded Supabase data and may lag behind current app
  behavior.

## Security Notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Keep mock payment endpoints disabled in production unless intentionally running
  a controlled test environment.
- Redirect parameters are expected to be same-origin paths such as `/dashboard`
  or `/checkout/{id}`.
- Merchant-provided `return_url` and `cancel_url` values must be valid `http` or
  `https` URLs.
- Stripe webhook handling and status polling verify the provider-reported
  payment amount before completing top-ups or fiat checkout sessions.
- Merchant completion webhooks use signature version `v1`, signing
  `{X-AnyPay-Timestamp}.{raw_body}` with the merchant `webhook_secret`.
- The historical database baseline and RLS policies are not fully versioned in
  this repo; add a Supabase baseline migration before relying on repeatable
  greenfield deployments.
