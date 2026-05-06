# SettleMesh Merchant Demo

This is a standalone test merchant website. It represents the app that a third-party
merchant would own: the browser talks to this merchant server, and this merchant
server calls SettleMesh with its secret API key.

The demo covers:

- creating a hosted checkout session
- redirecting the buyer to SettleMesh
- returning to merchant success/cancel pages
- receiving signed `checkout.completed` webhooks

## Configuration

1. Start SettleMesh locally at `http://127.0.0.1:3000`.
2. Register or sign in to SettleMesh.
3. Open `/developer`, register a merchant, and set:

```txt
Website URL: http://127.0.0.1:4020
Webhook URL: http://127.0.0.1:4020/webhook
```

4. Create an API key in the Developer page.
5. Create a `.env` file in this folder. You can start from `env.example`:

```bash
SETTLEMESH_BASE_URL=https://www.settlemesh.io
SETTLEMESH_API_KEY=your_merchant_api_key
SETTLEMESH_WEBHOOK_SECRET=your_webhook_secret
MERCHANT_APP_URL=http://127.0.0.1:4020
DEFAULT_CHECKOUT_AMOUNT_CREDIT=50
PORT=4020
```

`SETTLEMESH_WEBHOOK_SECRET` is optional for local testing, but set it when you want
the demo to reject unsigned or incorrectly signed webhooks.

## Run

From this folder:

```bash
npm run dev
```

Then open:

```txt
http://127.0.0.1:4020
```

## Routes

- `/` main demo page
- `/health` health check endpoint
- `/api/checkout` local merchant endpoint that calls AnyPay `checkout/create`
- `/api/checkout/status?id=checkout_session_id` local merchant endpoint that queries checkout status
- `/webhook` local merchant webhook receiver
- `/success` local merchant success page
- `/cancel` local merchant cancel page

## Minimal integration

### Create checkout

The merchant backend calls SettleMesh:

```js
const response = await fetch(`${SETTLEMESH_BASE_URL}/api/v1/checkout/create`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${SETTLEMESH_API_KEY}`,
    "content-type": "application/json",
    "idempotency-key": orderId,
  },
  body: JSON.stringify({
    amount: 50,
    description: "Starter Pack",
    external_id: orderId,
    return_url: "https://merchant.example/success",
    cancel_url: "https://merchant.example/cancel",
    metadata: {
      product: "starter-pack",
    },
  }),
});

const checkout = await response.json();
```

Then the merchant frontend redirects the buyer:

```js
window.location.href = checkout.url;
```

### Verify webhook

SettleMesh sends:

```txt
POST /webhook
X-AnyPay-Signature: hmac_sha256_hex
X-AnyPay-Signature-Version: v1
X-AnyPay-Timestamp: 1234567890
```

Verify the raw body with your merchant webhook secret:

```js
const expected = crypto
  .createHmac("sha256", SETTLEMESH_WEBHOOK_SECRET)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex");
```

Only fulfill the merchant order after signature verification and an event of
`checkout.completed`.
