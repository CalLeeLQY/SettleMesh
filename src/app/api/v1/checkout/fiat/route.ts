import { dollarsToCents, getStripeCheckoutPaymentMethodConfig, getStripeClient } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type StripeFiatCheckout = {
  id: string;
  amount_credit: number;
  description: string;
  merchant_name: string;
};

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

  const supabase = await createClient();
  const { data: session, error: sessionErr } = await supabase
    .rpc("prepare_stripe_fiat_checkout", {
      p_session_id: session_id,
      p_payer_email: typeof payer_email === "string" ? payer_email : null,
      p_payer_name: typeof payer_name === "string" ? payer_name : null,
    })
    .single();

  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message || "Checkout session not found" }, { status: 400 });
  }

  const checkoutSessionRow = session as StripeFiatCheckout;
  const creditAmount = checkoutSessionRow.amount_credit;
  const fiatAmount = Number((creditAmount / 100).toFixed(2));

  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    await supabase.rpc("mark_stripe_fiat_checkout_failed", {
      p_session_id: session_id,
      p_payer_email: typeof payer_email === "string" ? payer_email : null,
      p_payer_name: typeof payer_name === "string" ? payer_name : null,
    });
    return NextResponse.json({ error: "Invalid checkout amount" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const returnUrl = new URL(`/checkout/${session_id}`, baseUrl);
  returnUrl.searchParams.set("fiat_return", "1");

  try {
    const stripe = getStripeClient();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      ...getStripeCheckoutPaymentMethodConfig(),
      client_reference_id: checkoutSessionRow.id,
      customer_email: typeof payer_email === "string" && payer_email.trim() ? payer_email.trim() : undefined,
      success_url: returnUrl.toString(),
      cancel_url: new URL(`/checkout/${session_id}`, baseUrl).toString(),
      metadata: {
        kind: "checkout_fiat",
        checkout_session_id: checkoutSessionRow.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: dollarsToCents(fiatAmount),
            product_data: {
              name: `${checkoutSessionRow.merchant_name}: ${checkoutSessionRow.description}`,
              description: `${creditAmount.toLocaleString()} AnyPay credits`,
            },
          },
        },
      ],
    });

    const { error: attachErr } = await supabase.rpc("attach_stripe_fiat_checkout_provider", {
      p_session_id: checkoutSessionRow.id,
      p_provider_id: checkoutSession.id,
      p_provider_session: JSON.stringify(checkoutSession),
      p_payer_email: typeof payer_email === "string" ? payer_email : null,
      p_payer_name: typeof payer_name === "string" ? payer_name : null,
    });

    if (attachErr) {
      throw new Error(attachErr.message || "Failed to attach Stripe session");
    }

    return NextResponse.json({
      success: true,
      session_id: checkoutSessionRow.id,
      payment_url: checkoutSession.url,
      fiat_amount: fiatAmount,
    });
  } catch (error) {
    await supabase.rpc("mark_stripe_fiat_checkout_failed", {
      p_session_id: checkoutSessionRow.id,
      p_payer_email: typeof payer_email === "string" ? payer_email : null,
      p_payer_name: typeof payer_name === "string" ? payer_name : null,
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 502 }
    );
  }
}
