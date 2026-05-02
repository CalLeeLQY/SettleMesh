import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (stripeClient) {
    return stripeClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing environment variable: STRIPE_SECRET_KEY");
  }

  stripeClient = new Stripe(secretKey, {
    appInfo: {
      name: "AnyPay",
      version: "0.1.0",
    },
  });

  return stripeClient;
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing environment variable: STRIPE_WEBHOOK_SECRET");
  }

  return secret;
}

export function dollarsToCents(value: number | string) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid payment amount");
  }

  return Math.round(amount * 100);
}

export function stripeAmountMatches(
  actualAmountCents: number | null | undefined,
  expectedAmount: number | string
) {
  return actualAmountCents === dollarsToCents(expectedAmount);
}
