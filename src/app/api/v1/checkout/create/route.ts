import { NextResponse } from "next/server";
import { getAdminClient, hashApiKey } from "@/lib/merchant-auth";
import { getCheckoutPaymentOptions } from "@/lib/payment-options";
import { getSafeExternalUrl } from "@/lib/redirect";
import {
  buildCheckoutProtocol,
  creditAmountToUsd,
  getRequestBaseUrl,
  MIN_STRIPE_PAYMENT_AMOUNT_CREDIT,
  parseIdempotencyKey,
  validateCheckoutMetadata,
  validateOptionalString,
} from "@/lib/protocol";

const MAX_CHECKOUT_AMOUNT_CREDIT = 10_000_000;

type TimingMark = {
  name: string;
  start: number;
  duration?: number;
};

type MerchantCheckoutRpcResult = {
  ok: boolean;
  status?: number;
  error?: string;
  idempotent_replay?: boolean;
  merchant?: {
    id: string;
    user_id: string;
    name: string;
    webhook_url: string | null;
    webhook_secret: string;
    is_active: boolean;
    allow_guest_checkout: boolean;
    guest_checkout_min_credit: number;
    mock_fiat_enabled: boolean;
  };
  session?: {
    id: string;
    amount_credit: number;
    description: string;
    status: string;
    expires_at: string;
  };
};

function finishTiming(mark: TimingMark) {
  mark.duration = performance.now() - mark.start;
}

function serverTimingHeader(marks: TimingMark[]) {
  return marks
    .filter((mark) => typeof mark.duration === "number")
    .map((mark) => `${mark.name};dur=${mark.duration!.toFixed(1)}`)
    .join(", ");
}

function jsonWithTiming(
  body: Parameters<typeof NextResponse.json>[0],
  init: ResponseInit | undefined,
  timings: TimingMark[]
) {
  const response = NextResponse.json(body, init);
  const header = serverTimingHeader(timings);
  if (header) {
    response.headers.set("Server-Timing", header);
    response.headers.set("X-SettleMesh-Timing", header);
  }
  return response;
}

export async function POST(request: Request) {
  const timings: TimingMark[] = [];
  const mark = (name: string) => {
    const timing = { name, start: performance.now() };
    timings.push(timing);
    return timing;
  };

  // Authenticate merchant via API key
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonWithTiming(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
      timings
    );
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith("sk_live_")) {
    return jsonWithTiming(
      { error: "Invalid API key" },
      { status: 401 },
      timings
    );
  }

  // Parse request body
  let body: {
    amount: number;
    description: string;
    external_id?: string;
    metadata?: Record<string, unknown>;
    return_url?: string;
    cancel_url?: string;
  };

  const parseTiming = mark("parse");
  try {
    body = await request.json();
    finishTiming(parseTiming);
  } catch {
    finishTiming(parseTiming);
    return jsonWithTiming({ error: "Invalid JSON body" }, { status: 400 }, timings);
  }

  const { amount, description, external_id, metadata, return_url, cancel_url } = body;
  const idempotency = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotency.ok) {
    return jsonWithTiming({ error: idempotency.error }, { status: 400 }, timings);
  }

  if (
    !Number.isInteger(amount) ||
    amount < MIN_STRIPE_PAYMENT_AMOUNT_CREDIT ||
    amount > MAX_CHECKOUT_AMOUNT_CREDIT
  ) {
    return jsonWithTiming(
      {
        error: `amount must be an integer between ${MIN_STRIPE_PAYMENT_AMOUNT_CREDIT} and ${MAX_CHECKOUT_AMOUNT_CREDIT} credits`,
      },
      { status: 400 },
      timings
    );
  }

  if (!description || typeof description !== "string" || description.length > 500) {
    return jsonWithTiming(
      { error: "description is required" },
      { status: 400 },
      timings
    );
  }

  const externalId = validateOptionalString({
    name: "external_id",
    value: external_id,
    maxLength: 255,
  });
  if (!externalId.ok) {
    return jsonWithTiming({ error: externalId.error }, { status: 400 }, timings);
  }

  const checkoutMetadata = validateCheckoutMetadata(metadata);
  if (!checkoutMetadata.ok) {
    return jsonWithTiming({ error: checkoutMetadata.error }, { status: 400 }, timings);
  }

  const safeReturnUrl = return_url ? getSafeExternalUrl(return_url) : null;
  if (return_url && !safeReturnUrl) {
    return jsonWithTiming(
      { error: "return_url must be a valid http(s) URL" },
      { status: 400 },
      timings
    );
  }

  const safeCancelUrl = cancel_url ? getSafeExternalUrl(cancel_url) : null;
  if (cancel_url && !safeCancelUrl) {
    return jsonWithTiming(
      { error: "cancel_url must be a valid http(s) URL" },
      { status: 400 },
      timings
    );
  }

  const admin = getAdminClient();
  const rpcTiming = mark("supabase_checkout_rpc");
  const { data, error } = await admin.rpc("create_merchant_checkout_session", {
    p_key_prefix: apiKey.slice(0, 12),
    p_key_hash: hashApiKey(apiKey),
    p_amount: Math.floor(amount),
    p_description: description,
    p_external_id: externalId.value,
    p_metadata: checkoutMetadata.metadata,
    p_return_url: safeReturnUrl,
    p_cancel_url: safeCancelUrl,
    p_idempotency_key: idempotency.key,
  });
  finishTiming(rpcTiming);

  const result = data as MerchantCheckoutRpcResult | null;
  if (error || !result) {
    return jsonWithTiming(
      { error: "Failed to create checkout session" },
      { status: 500 },
      timings
    );
  }

  if (!result.ok || !result.merchant || !result.session) {
    return jsonWithTiming(
      { error: result.error ?? "Failed to create checkout session" },
      { status: Number(result.status ?? 500) },
      timings
    );
  }

  const { merchant, session } = result;
  const baseUrl = getRequestBaseUrl(request);
  const paymentMethods = getCheckoutPaymentOptions(merchant, session.amount_credit);

  return jsonWithTiming(
    {
      id: session.id,
      url: `${baseUrl}/checkout/${session.id}`,
      amount_credit: session.amount_credit,
      description: session.description,
      status: session.status,
      expires_at: session.expires_at,
      payment_methods: paymentMethods,
      fiat_amount_usd: creditAmountToUsd(session.amount_credit),
      mock_fiat_amount_usd: creditAmountToUsd(session.amount_credit),
      ...(result.idempotent_replay ? { idempotent_replay: true } : {}),
      payment_protocol: buildCheckoutProtocol({
        baseUrl,
        session,
        paymentMethods,
      }),
    },
    undefined,
    timings
  );
}
