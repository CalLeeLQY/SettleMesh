import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/merchant-auth";
import { createXunhuPayment } from "@/lib/xunhupay";
import { NextResponse } from "next/server";

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
      payment_method: "xunhupay",
      idempotency_key: idempotencyKey,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (orderErr) {
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const returnUrl = process.env.XUNHUPAY_RETURN_URL
    ? new URL(process.env.XUNHUPAY_RETURN_URL)
    : new URL("/topup", baseUrl);

  returnUrl.searchParams.set("order_id", order.id);
  if (next) {
    returnUrl.searchParams.set("next", next);
  }

  const notifyUrl = process.env.XUNHUPAY_NOTIFY_URL || new URL("/api/topup/xunhupay/notify", baseUrl).toString();

  try {
    const payment = await createXunhuPayment({
      tradeOrderId: order.id,
      totalFee,
      title: pkg.label,
      notifyUrl,
      returnUrl: returnUrl.toString(),
    });

    await admin
      .from("topup_orders")
      .update({
        payment_provider_id: payment.providerOrderId,
        payment_provider_session: JSON.stringify(payment.raw),
        payment_method: "xunhupay",
      })
      .eq("id", order.id);

    return NextResponse.json({
      success: true,
      order_id: order.id,
      payment_url: payment.paymentUrl,
      expires_at: order.expires_at,
    });
  } catch (error) {
    await admin
      .from("topup_orders")
      .update({
        status: "failed",
        payment_method: "xunhupay",
      })
      .eq("id", order.id)
      .eq("status", "awaiting_payment");

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 502 }
    );
  }
}
