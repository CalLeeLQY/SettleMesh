# AnyPay Payment Smoke Test

This is a lightweight integration test project for AnyPay's mock payment flows.
It focuses on the hosted checkout and payment APIs described in [docs/functional-testing-guide.md](../../docs/functional-testing-guide.md).

## What It Covers

The suite exercises these core flows:

- test user creation
- wallet auto-provisioning
- login/session access
- mock top-up
- merchant registration
- merchant API key generation
- checkout session creation
- logged-in credit payment
- insufficient balance -> top-up -> pay
- guest mock-fiat payment
- session status query
- webhook delivery and signature verification
- merchant earnings and earned-credit reuse
- invalid session / expired session
- invalid API key handling

## Requirements

- AnyPay app running locally, usually at `http://localhost:3000`
- valid Supabase keys in the repo root `.env.local`
- base data already present in Supabase:
  - `topup_packages`
  - wallet/profile auto-provisioning

## Usage

From this folder:

```bash
npm test
```

Or from the repo root:

```bash
node test/payment-smoke/run.js
```

## Optional Environment Variables

These default well for local development, but you can override them:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANYPAY_BASE_URL` | `http://localhost:3000` | AnyPay app URL |
| `WEBHOOK_PORT` | `4010` | Local webhook receiver port |
| `REPORT_DIR` | `./reports` | Where JSON reports are written |

## Output

The script prints a pass/fail log to stdout and writes a timestamped JSON report to:

```txt
test/payment-smoke/reports/
```

Each report includes:

- scenario name
- pass/fail result
- summary counts
- generated IDs useful for debugging

## Notes

- This suite intentionally tests the current mock flows. It does not use Stripe, WeChat Pay, or Alipay.
- The script creates disposable test users and merchant records in Supabase.
- It does not delete generated data so that webhook/session/order traces remain available for inspection.
