import { createClient } from "@/lib/supabase/server";
import { getSafeRedirectPath } from "@/lib/redirect";
import { createStripeCheckoutSession, dollarsToCents } from "@/lib/stripe";
import { NextResponse } from "next/server";

type StripeTopupOrder = {
  id: string;
  package_id: string;
  credit_amount: number;
  bonus_credit: number;
  price_usd: number;
  status: string;
  expires_at: string;
  label: string;
};

function getCheckoutSessionIdFromRedirectPath(path: string) {
  const match = path.match(/^\/checkout\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?#]|$)/i);
  return match?.[1] ?? null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { package_id?: string; next?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { package_id, next } = body;
  if (!package_id) {
    return NextResponse.json({ error: "Missing package_id" }, { status: 400 });
  }

  const safeNextPath = getSafeRedirectPath(next, "/dashboard");
  const linkedCheckoutSessionId = getCheckoutSessionIdFromRedirectPath(safeNextPath);

  const { data: order, error: orderErr } = await supabase
    .rpc("create_stripe_topup_order", {
      p_package_id: package_id,
      p_checkout_session_id: linkedCheckoutSessionId,
    })
    .single();

  if (orderErr) {
    return NextResponse.json({ error: orderErr.message || "Failed to create order" }, { status: 400 });
  }

  const topupOrder = order as StripeTopupOrder;
  const totalCredit = Number(topupOrder.credit_amount);
  const totalFee = Number(topupOrder.price_usd);

  if (!Number.isFinite(totalFee) || totalFee <= 0) {
    await supabase.rpc("mark_stripe_topup_order_failed", { p_order_id: topupOrder.id });
    return NextResponse.json({ error: "Invalid package price" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const returnUrl = new URL("/topup", baseUrl);

  returnUrl.searchParams.set("order_id", topupOrder.id);
  returnUrl.searchParams.set("stripe_session_id", "{CHECKOUT_SESSION_ID}");
  if (next) {
    returnUrl.searchParams.set("next", safeNextPath);
  }

  const cancelUrl = new URL("/topup", baseUrl);
  if (next) {
    cancelUrl.searchParams.set("next", safeNextPath);
  }

  try {
    const checkoutSession = await createStripeCheckoutSession({
      mode: "payment",
      client_reference_id: topupOrder.id,
      success_url: returnUrl.toString(),
      cancel_url: cancelUrl.toString(),
      metadata: {
        kind: "topup",
        order_id: topupOrder.id,
        user_id: user.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: dollarsToCents(totalFee),
            product_data: {
              name: topupOrder.label,
              description: `${totalCredit.toLocaleString()} AnyPay credits`,
            },
          },
        },
      ],
    });

    const { error: attachErr } = await supabase.rpc("attach_stripe_topup_provider", {
      p_order_id: topupOrder.id,
      p_provider_id: checkoutSession.id,
      p_provider_session: JSON.stringify(checkoutSession),
    });

    if (attachErr) {
      throw new Error(attachErr.message || "Failed to attach Stripe session");
    }

    return NextResponse.json({
      success: true,
      order_id: topupOrder.id,
      payment_url: checkoutSession.url,
      expires_at: topupOrder.expires_at,
    });
  } catch (error) {
    await supabase.rpc("mark_stripe_topup_order_failed", { p_order_id: topupOrder.id });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 502 }
    );
  }
}
