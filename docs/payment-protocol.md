# SettleMesh Payment Protocol

Version: `settlemesh-2026-05-02`

This protocol keeps merchant integration simple: merchants price a resource in
credits, create a hosted checkout session, redirect the payer, then fulfill the
resource after either the merchant query API or the completion webhook confirms
payment.

## Assets

- Settlement asset: `credit`
- Display asset: `credit`
- Fiat bridge rate: `100 credits = 1 USD`
- Merchant settlement: merchants always receive credits, even when a payer uses
  Stripe fiat checkout.

## Discovery

```http
GET /api/v1/protocol
```

The response describes the protocol version, capabilities, endpoint templates,
and webhook signature rules.

## Create A Checkout

```http
POST /api/v1/checkout/create
Authorization: Bearer sk_live_xxx
Idempotency-Key: order_123
Content-Type: application/json

{
  "amount": 100,
  "description": "Premium report",
  "external_id": "order_123",
  "return_url": "https://merchant.example/success",
  "cancel_url": "https://merchant.example/cancel",
  "metadata": { "resource": "report" }
}
```

`amount` is an integer credit amount. `Idempotency-Key` is optional but strongly
recommended; repeated requests with the same key return the existing checkout
session for that merchant.

The response includes `payment_protocol`, which is the canonical machine-readable
payment requirement:

```json
{
  "payment_protocol": {
    "version": "settlemesh-2026-05-02",
    "kind": "hosted_checkout",
    "asset": "credit",
    "settlement_asset": "credit",
    "amount": 100,
    "amount_credit": 100,
    "fiat_amount_usd": 1,
    "checkout_url": "https://settlemesh.example/checkout/session_uuid",
    "status_url": "https://settlemesh.example/api/v1/checkout/session_uuid",
    "payment_methods": {
      "credit": true,
      "fiat": true,
      "mock_fiat": false
    }
  }
}
```

## Query A Checkout

```http
GET /api/v1/checkout/{id}
Authorization: Bearer sk_live_xxx
```

Merchants should treat `status = completed` as the authoritative synchronous
fulfillment signal. Webhooks are the asynchronous signal.

## Completion Webhook

SettleMesh sends a `checkout.completed` webhook after the checkout transaction is
committed.

```http
POST https://merchant.example/webhook
Content-Type: application/json
X-AnyPay-Signature-Version: v1
X-AnyPay-Timestamp: 1777651200000
X-AnyPay-Signature: hmac_sha256_hex
```

Signature v1 signs:

```txt
{X-AnyPay-Timestamp}.{raw_request_body}
```

Verification example:

```js
const crypto = require("crypto");

function verifyAnyPayWebhook({ body, timestamp, signature, secret }) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const ageMs = Math.abs(Date.now() - Number(timestamp));
  return ageMs <= 5 * 60 * 1000 && expected === signature;
}
```

Webhook attempts are recorded in `webhook_deliveries`, so merchants can audit
delivery status from the database side and the platform can add retries without
changing the public protocol.
