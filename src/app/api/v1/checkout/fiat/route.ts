import { getAdminClient } from "@/lib/merchant-auth";
import { createXunhuPayment } from "@/lib/xunhupay";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let body: { session_id?: string; payer_email?: string; payer_name?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { session_id, payer_email, payer_name } = body;

  if (!session_id) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: session } = await admin
    .from("checkout_sessions")
    .select("*, merchants(id, user_id, name, allow_guest_checkout, guest_checkout_min_credit, mock_fiat_enabled)")
    .eq("id", session_id)
    .eq("status", "pending")
    .single();

  if (!session) {
    return NextResponse.json(
      { error: "Checkout session not found or already completed" },
      { status: 404 }
    );
  }

  if (new Date(session.expires_at) < new Date()) {
    await admin.from("checkout_sessions").update({ status: "expired" }).eq("id", session.id);
    return NextResponse.json({ error: "Checkout session expired" }, { status: 410 });
  }

  const creditAmount = session.amount_credit;
  const fiatAmount = Number((creditAmount / 100).toFixed(2));

  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return NextResponse.json({ error: "Invalid checkout amount" }, { status: 400 });
  }

  const merchant = session.merchants as {
    id: string;
    name: string;
    allow_guest_checkout?: boolean;
    guest_checkout_min_credit?: number;
    mock_fiat_enabled?: boolean;
  } | null;
  const merchantName = merchant?.name ?? "Merchant";
  const fiatCheckoutAvailable =
    merchant?.allow_guest_checkout !== false &&
    merchant?.mock_fiat_enabled !== false &&
    creditAmount >= (merchant?.guest_checkout_min_credit ?? 0);

  if (!fiatCheckoutAvailable) {
    return NextResponse.json({ error: "Fiat checkout is unavailable for this payment" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const returnUrl = new URL(`/checkout/${session_id}`, baseUrl);
  returnUrl.searchParams.set("fiat_return", "1");

  const notifyUrl =
    process.env.XUNHUPAY_CHECKOUT_NOTIFY_URL ||
    new URL("/api/v1/checkout/fiat/notify", baseUrl).toString();

  try {
    const payment = await createXunhuPayment({
      tradeOrderId: session.id,
      totalFee: fiatAmount,
      title: `${merchantName}: ${session.description}`,
      notifyUrl,
      returnUrl: returnUrl.toString(),
    });

    await admin
      .from("checkout_sessions")
      .update({
        payer_id: null,
        payer_email: typeof payer_email === "string" && payer_email.trim() ? payer_email.trim() : null,
        payer_name: typeof payer_name === "string" ? payer_name : null,
        payment_provider_id: payment.providerOrderId,
        payment_provider_session: JSON.stringify(payment.raw),
        payment_provider_status: "awaiting_payment",
        payment_started_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    return NextResponse.json({
      success: true,
      session_id: session.id,
      payment_url: payment.paymentUrl,
      fiat_amount: fiatAmount,
    });
  } catch (error) {
    await admin
      .from("checkout_sessions")
      .update({
        payer_id: null,
        payer_email: typeof payer_email === "string" && payer_email.trim() ? payer_email.trim() : null,
        payer_name: typeof payer_name === "string" ? payer_name : null,
        payment_provider_status: "failed",
        payment_started_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .eq("status", "pending");

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 502 }
    );
  }
}
