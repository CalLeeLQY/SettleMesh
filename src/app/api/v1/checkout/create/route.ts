import { NextResponse } from "next/server";
import { verifyApiKey, getAdminClient } from "@/lib/merchant-auth";
import { getCheckoutPaymentOptions } from "@/lib/payment-options";
import { getSafeExternalUrl } from "@/lib/redirect";
import {
  buildCheckoutProtocol,
  creditAmountToUsd,
  getRequestBaseUrl,
  parseIdempotencyKey,
  validateCheckoutMetadata,
  validateOptionalString,
} from "@/lib/protocol";

const MAX_CHECKOUT_AMOUNT_CREDIT = 10_000_000;

export async function POST(request: Request) {
  // Authenticate merchant via API key
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 }
    );
  }

  const apiKey = authHeader.slice(7);
  const merchant = await verifyApiKey(apiKey);
  if (!merchant) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401 }
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

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { amount, description, external_id, metadata, return_url, cancel_url } = body;
  const idempotency = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotency.ok) {
    return NextResponse.json({ error: idempotency.error }, { status: 400 });
  }

  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_CHECKOUT_AMOUNT_CREDIT) {
    return NextResponse.json(
      { error: `amount must be an integer between 1 and ${MAX_CHECKOUT_AMOUNT_CREDIT} credits` },
      { status: 400 }
    );
  }

  if (!description || typeof description !== "string" || description.length > 500) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 }
    );
  }

  const externalId = validateOptionalString({
    name: "external_id",
    value: external_id,
    maxLength: 255,
  });
  if (!externalId.ok) {
    return NextResponse.json({ error: externalId.error }, { status: 400 });
  }

  const checkoutMetadata = validateCheckoutMetadata(metadata);
  if (!checkoutMetadata.ok) {
    return NextResponse.json({ error: checkoutMetadata.error }, { status: 400 });
  }

  const safeReturnUrl = return_url ? getSafeExternalUrl(return_url) : null;
  if (return_url && !safeReturnUrl) {
    return NextResponse.json(
      { error: "return_url must be a valid http(s) URL" },
      { status: 400 }
    );
  }

  const safeCancelUrl = cancel_url ? getSafeExternalUrl(cancel_url) : null;
  if (cancel_url && !safeCancelUrl) {
    return NextResponse.json(
      { error: "cancel_url must be a valid http(s) URL" },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  if (idempotency.key) {
    const { data: existingSession } = await admin
      .from("checkout_sessions")
      .select("id, amount_credit, description, status, expires_at")
      .eq("merchant_id", merchant.id)
      .eq("idempotency_key", idempotency.key)
      .maybeSingle();

    if (existingSession) {
      const baseUrl = getRequestBaseUrl(request);
      const paymentMethods = getCheckoutPaymentOptions(
        merchant,
        existingSession.amount_credit
      );

      return NextResponse.json({
        id: existingSession.id,
        url: `${baseUrl}/checkout/${existingSession.id}`,
        amount_credit: existingSession.amount_credit,
        description: existingSession.description,
        status: existingSession.status,
        expires_at: existingSession.expires_at,
        payment_methods: paymentMethods,
        fiat_amount_usd: creditAmountToUsd(existingSession.amount_credit),
        mock_fiat_amount_usd: creditAmountToUsd(existingSession.amount_credit),
        idempotent_replay: true,
        payment_protocol: buildCheckoutProtocol({
          baseUrl,
          session: existingSession,
          paymentMethods,
        }),
      });
    }
  }

  // Create checkout session
  const { data: session, error } = await admin
    .from("checkout_sessions")
    .insert({
      merchant_id: merchant.id,
      external_id: externalId.value,
      amount_credit: Math.floor(amount),
      description,
      metadata: checkoutMetadata.metadata,
      return_url: safeReturnUrl,
      cancel_url: safeCancelUrl,
      idempotency_key: idempotency.key,
    })
    .select()
    .single();

  if (error || !session) {
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }

  const baseUrl = getRequestBaseUrl(request);
  const paymentMethods = getCheckoutPaymentOptions(merchant, session.amount_credit);

  return NextResponse.json({
    id: session.id,
    url: `${baseUrl}/checkout/${session.id}`,
    amount_credit: session.amount_credit,
    description: session.description,
    status: session.status,
    expires_at: session.expires_at,
    payment_methods: paymentMethods,
    fiat_amount_usd: creditAmountToUsd(session.amount_credit),
    mock_fiat_amount_usd: creditAmountToUsd(session.amount_credit),
    payment_protocol: buildCheckoutProtocol({
      baseUrl,
      session,
      paymentMethods,
    }),
  });
}
