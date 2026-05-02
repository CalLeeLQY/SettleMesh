import { getAdminClient } from "@/lib/merchant-auth";
import { canUseGuestFiatCheckout } from "@/lib/payment-options";
import { dollarsToCents, getStripeClient } from "@/lib/stripe";
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
  const fiatCheckoutAvailable = canUseGuestFiatCheckout(merchant, creditAmount);

  if (!fiatCheckoutAvailable) {
    return NextResponse.json({ error: "Fiat checkout is unavailable for this payment" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const returnUrl = new URL(`/checkout/${session_id}`, baseUrl);
  returnUrl.searchParams.set("fiat_return", "1");

  try {
    const stripe = getStripeClient();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: session.id,
      customer_email: typeof payer_email === "string" && payer_email.trim() ? payer_email.trim() : undefined,
      success_url: returnUrl.toString(),
      cancel_url: new URL(`/checkout/${session_id}`, baseUrl).toString(),
      metadata: {
        kind: "checkout_fiat",
        checkout_session_id: session.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: dollarsToCents(fiatAmount),
            product_data: {
              name: `${merchantName}: ${session.description}`,
              description: `${creditAmount.toLocaleString()} AnyPay credits`,
            },
          },
        },
      ],
    });

    await admin
      .from("checkout_sessions")
      .update({
        payer_id: null,
        payer_email: typeof payer_email === "string" && payer_email.trim() ? payer_email.trim() : null,
        payer_name: typeof payer_name === "string" ? payer_name : null,
        payment_provider_id: checkoutSession.id,
        payment_provider_session: JSON.stringify(checkoutSession),
        payment_provider_status: "awaiting_payment",
        payment_started_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    return NextResponse.json({
      success: true,
      session_id: session.id,
      payment_url: checkoutSession.url,
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
