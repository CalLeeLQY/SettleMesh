export const PAYMENT_PROTOCOL_VERSION = "settlemesh-2026-05-02";
export const CREDIT_ASSET = "credit";
export const CREDIT_TO_USD_RATE = 100;

export type PaymentMethods = {
  credit: boolean;
  fiat: boolean;
  mock_fiat: boolean;
};

export type CheckoutProtocolSession = {
  id: string;
  amount_credit: number;
  description: string;
  status: string;
  expires_at: string;
};

export function creditAmountToUsd(amountCredit: number) {
  return Number((amountCredit / CREDIT_TO_USD_RATE).toFixed(2));
}

export function buildCheckoutProtocol({
  baseUrl,
  session,
  paymentMethods,
}: {
  baseUrl: string;
  session: CheckoutProtocolSession;
  paymentMethods: PaymentMethods;
}) {
  const checkoutUrl = new URL(`/checkout/${session.id}`, baseUrl).toString();
  const statusUrl = new URL(`/api/v1/checkout/${session.id}`, baseUrl).toString();

  return {
    version: PAYMENT_PROTOCOL_VERSION,
    kind: "hosted_checkout",
    asset: CREDIT_ASSET,
    settlement_asset: CREDIT_ASSET,
    amount: session.amount_credit,
    amount_credit: session.amount_credit,
    fiat_amount_usd: creditAmountToUsd(session.amount_credit),
    description: session.description,
    status: session.status,
    expires_at: session.expires_at,
    checkout_url: checkoutUrl,
    status_url: statusUrl,
    payment_methods: paymentMethods,
  };
}

export function getRequestBaseUrl(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get("origin") ||
    new URL(request.url).origin
  );
}

export function parseIdempotencyKey(value: string | null) {
  if (!value) {
    return { ok: true as const, key: null };
  }

  const key = value.trim();
  if (!key) {
    return { ok: true as const, key: null };
  }

  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    return {
      ok: false as const,
      error:
        "Idempotency-Key must be 128 characters or fewer and contain only letters, numbers, dots, underscores, colons, or hyphens",
    };
  }

  return { ok: true as const, key };
}

export function validateCheckoutMetadata(value: unknown) {
  if (value === undefined) {
    return { ok: true as const, metadata: {} as Record<string, unknown> };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false as const, error: "metadata must be a JSON object" };
  }

  const serialized = JSON.stringify(value);
  if (serialized.length > 4096) {
    return { ok: false as const, error: "metadata must be 4KB or smaller" };
  }

  return { ok: true as const, metadata: value as Record<string, unknown> };
}

export function validateOptionalString({
  name,
  value,
  maxLength,
}: {
  name: string;
  value: unknown;
  maxLength: number;
}) {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string" || value.length > maxLength) {
    return {
      ok: false as const,
      error: `${name} must be a string no longer than ${maxLength} characters`,
    };
  }

  return { ok: true as const, value };
}
