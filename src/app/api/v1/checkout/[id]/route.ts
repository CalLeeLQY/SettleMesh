import { NextResponse } from "next/server";
import { verifyApiKey, getAdminClient } from "@/lib/merchant-auth";
import { getCheckoutPaymentOptions } from "@/lib/payment-options";
import {
  buildCheckoutProtocol,
  creditAmountToUsd,
  getRequestBaseUrl,
} from "@/lib/protocol";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

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
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const admin = getAdminClient();

  const { data: session } = await admin
    .from("checkout_sessions")
    .select("id, external_id, amount_credit, description, metadata, status, payer_id, payer_email, payer_name, payment_method, completed_at, expires_at, created_at")
    .eq("id", id)
    .eq("merchant_id", merchant.id)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const paymentMethods = getCheckoutPaymentOptions(merchant, session.amount_credit);
  const baseUrl = getRequestBaseUrl(request);

  return NextResponse.json({
    ...session,
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
