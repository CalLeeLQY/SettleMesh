# Merchant Demo

This is a simple standalone test website for local development.
It creates hosted checkout sessions through AnyPay.

## Configuration

Create a `.env` file in this folder:

```bash
ANYPAY_BASE_URL=http://127.0.0.1:3000
ANYPAY_API_KEY=your_merchant_api_key
MERCHANT_APP_URL=http://127.0.0.1:4020
PORT=4020
```

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
- `/success` local merchant success page
- `/cancel` local merchant cancel page

## Purpose

Use this site as a safe starting point for:

- product page experiments
- checkout button experiments
- redirect flow testing
- merchant checkout integration work
