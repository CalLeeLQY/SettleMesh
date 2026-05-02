import Stripe from "stripe";

let stripeClient: Stripe | null = null;
type CheckoutPaymentMethodType = "card" | "wechat_pay";
type StripeCheckoutPaymentMethodConfig = {
  payment_method_types?: CheckoutPaymentMethodType[];
  payment_method_options?: {
    wechat_pay?: {
      client: "web";
    };
  };
};

const DEFAULT_CHECKOUT_PAYMENT_METHOD_TYPES: CheckoutPaymentMethodType[] = ["card"];

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

export function getStripeCheckoutPaymentMethodConfig(): StripeCheckoutPaymentMethodConfig {
  const rawTypes = process.env.STRIPE_PAYMENT_METHOD_TYPES?.trim();

  if (rawTypes && ["auto", "automatic", "dynamic"].includes(rawTypes.toLowerCase())) {
    return {};
  }

  const paymentMethodTypes = (rawTypes
    ? rawTypes
        .split(",")
        .map((type) => type.trim())
        .filter(Boolean)
    : DEFAULT_CHECKOUT_PAYMENT_METHOD_TYPES) as CheckoutPaymentMethodType[];

  const paymentMethodOptions: NonNullable<StripeCheckoutPaymentMethodConfig["payment_method_options"]> = {};
  if (paymentMethodTypes.includes("wechat_pay")) {
    paymentMethodOptions.wechat_pay = { client: "web" };
  }

  return {
    payment_method_types: paymentMethodTypes,
    ...(Object.keys(paymentMethodOptions).length > 0
      ? { payment_method_options: paymentMethodOptions }
      : {}),
  };
}

export function stripeAmountMatches(
  actualAmountCents: number | null | undefined,
  expectedAmount: number | string
) {
  return actualAmountCents === dollarsToCents(expectedAmount);
}
