import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/merchant-auth";
import { getSafeRedirectPath } from "@/lib/redirect";
import { dollarsToCents, getStripeClient } from "@/lib/stripe";
import { NextResponse } from "next/server";

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

  // Use service role for privileged operations
  const admin = getAdminClient();

  // Get package
  const { data: pkg, error: pkgErr } = await admin
    .from("topup_packages")
    .select("*")
    .eq("id", package_id)
    .eq("is_active", true)
    .single();

  if (pkgErr || !pkg) {
    return NextResponse.json({ error: "Invalid package" }, { status: 400 });
  }

  const totalCredit = Number(pkg.credit_amount) + Number(pkg.bonus_credit);
  const totalFee = Number(pkg.price_usd);

  if (!Number.isFinite(totalFee) || totalFee <= 0) {
    return NextResponse.json({ error: "Invalid package price" }, { status: 400 });
  }

  const safeNextPath = getSafeRedirectPath(next, "/dashboard");
  const linkedCheckoutSessionId = getCheckoutSessionIdFromRedirectPath(safeNextPath);
  if (linkedCheckoutSessionId) {
    const { data: linkedSession } = await admin
      .from("checkout_sessions")
      .select("id, status, expires_at")
      .eq("id", linkedCheckoutSessionId)
      .eq("status", "pending")
      .single();

    if (!linkedSession || new Date(linkedSession.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "Linked checkout session is not payable" },
        { status: 400 }
      );
    }
  }

  const idempotencyKey = `topup_${user.id}_${package_id}_${Date.now()}`;

  // Create topup order
  const { data: order, error: orderErr } = await admin
    .from("topup_orders")
    .insert({
      user_id: user.id,
      package_id: pkg.id,
      credit_amount: totalCredit,
      bonus_credit: pkg.bonus_credit,
      price_usd: pkg.price_usd,
      status: "awaiting_payment",
      payment_method: "stripe",
      idempotency_key: idempotencyKey,
      checkout_session_id: linkedCheckoutSessionId,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (orderErr) {
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const returnUrl = new URL("/topup", baseUrl);

  returnUrl.searchParams.set("order_id", order.id);
  returnUrl.searchParams.set("stripe_session_id", "{CHECKOUT_SESSION_ID}");
  if (next) {
    returnUrl.searchParams.set("next", safeNextPath);
  }

  const cancelUrl = new URL("/topup", baseUrl);
  if (next) {
    cancelUrl.searchParams.set("next", safeNextPath);
  }

  try {
    const stripe = getStripeClient();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: order.id,
      success_url: returnUrl.toString(),
      cancel_url: cancelUrl.toString(),
      metadata: {
        kind: "topup",
        order_id: order.id,
        user_id: user.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: dollarsToCents(totalFee),
            product_data: {
              name: pkg.label,
              description: `${totalCredit.toLocaleString()} AnyPay credits`,
            },
          },
        },
      ],
    });

    await admin
      .from("topup_orders")
      .update({
        payment_provider_id: checkoutSession.id,
        payment_provider_session: JSON.stringify(checkoutSession),
        payment_method: "stripe",
      })
      .eq("id", order.id);

    return NextResponse.json({
      success: true,
      order_id: order.id,
      payment_url: checkoutSession.url,
      expires_at: order.expires_at,
    });
  } catch (error) {
    await admin
      .from("topup_orders")
      .update({
        status: "failed",
        payment_method: "stripe",
      })
      .eq("id", order.id)
      .eq("status", "awaiting_payment");

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 502 }
    );
  }
}
