import Stripe from "stripe";

let stripeClient: Stripe | null = null;
type CheckoutPaymentMethodType =
  | "acss_debit"
  | "affirm"
  | "afterpay_clearpay"
  | "alipay"
  | "alma"
  | "amazon_pay"
  | "au_becs_debit"
  | "bacs_debit"
  | "bancontact"
  | "billie"
  | "blik"
  | "boleto"
  | "card"
  | "cashapp"
  | "crypto"
  | "customer_balance"
  | "eps"
  | "fpx"
  | "giropay"
  | "grabpay"
  | "ideal"
  | "kakao_pay"
  | "klarna"
  | "konbini"
  | "kr_card"
  | "link"
  | "mb_way"
  | "mobilepay"
  | "multibanco"
  | "naver_pay"
  | "nz_bank_account"
  | "oxxo"
  | "p24"
  | "pay_by_bank"
  | "payco"
  | "paynow"
  | "paypal"
  | "payto"
  | "pix"
  | "promptpay"
  | "revolut_pay"
  | "samsung_pay"
  | "satispay"
  | "sepa_debit"
  | "sofort"
  | "sunbit"
  | "swish"
  | "twint"
  | "upi"
  | "us_bank_account"
  | "wechat_pay";
type StripeCheckoutPaymentMethodConfig = {
  payment_method_types?: CheckoutPaymentMethodType[];
  payment_method_options?: {
    wechat_pay?: {
      client: "web";
    };
  };
};

const PAYMENT_METHOD_UNAVAILABLE_PATTERN = /wechat_pay|No valid payment method types/i;
const DYNAMIC_PAYMENT_METHOD_VALUES = new Set(["all", "auto", "automatic", "dashboard", "dynamic"]);

const PAYMENT_METHOD_ALIASES: Record<string, CheckoutPaymentMethodType> = {
  apple_pay: "card",
  cash_app_pay: "cashapp",
  google_pay: "card",
};

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

  if (!rawTypes || DYNAMIC_PAYMENT_METHOD_VALUES.has(rawTypes.toLowerCase())) {
    return {};
  }

  const paymentMethodTypes = Array.from(
    new Set(
      rawTypes
        .split(",")
        .map((type) => type.trim().toLowerCase())
        .filter(Boolean)
        .map((type) => PAYMENT_METHOD_ALIASES[type] ?? (type as CheckoutPaymentMethodType))
    )
  );

  if (paymentMethodTypes.length === 0) {
    return {};
  }

  if (paymentMethodTypes.includes("link") && !paymentMethodTypes.includes("card")) {
    paymentMethodTypes.unshift("card");
  }

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

function shouldFallbackToCard(error: unknown) {
  return error instanceof Error && PAYMENT_METHOD_UNAVAILABLE_PATTERN.test(error.message);
}

function hasNonCardPaymentMethod(config: StripeCheckoutPaymentMethodConfig) {
  return config.payment_method_types?.some((type) => type !== "card") ?? false;
}

function shouldUseCardFallback(config: StripeCheckoutPaymentMethodConfig) {
  return !config.payment_method_types || hasNonCardPaymentMethod(config);
}

export async function createStripeCheckoutSession(
  params: Parameters<Stripe["checkout"]["sessions"]["create"]>[0]
) {
  const stripe = getStripeClient();
  const paymentMethodConfig = getStripeCheckoutPaymentMethodConfig();

  try {
    return await stripe.checkout.sessions.create({
      ...params,
      ...paymentMethodConfig,
    });
  } catch (error) {
    if (!shouldUseCardFallback(paymentMethodConfig) || !shouldFallbackToCard(error)) {
      throw error;
    }

    return stripe.checkout.sessions.create({
      ...params,
      payment_method_types: ["card"],
    });
  }
}

export function stripeAmountMatches(
  actualAmountCents: number | null | undefined,
  expectedAmount: number | string
) {
  return actualAmountCents === dollarsToCents(expectedAmount);
}
