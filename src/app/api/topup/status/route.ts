import { finalizeStripeTopupSession } from "@/lib/stripe-finalizers";
import { getAdminClient } from "@/lib/merchant-auth";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe";
import { NextResponse } from "next/server";

type TopupOrderRow = {
  id: string;
  user_id: string;
  credit_amount: number;
  bonus_credit: number;
  price_usd: number;
  status: string;
  payment_method: string;
  payment_provider_id: string | null;
  paid_at: string | null;
  expires_at: string | null;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id");

  if (!orderId) {
    return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
  }

  const admin = getAdminClient();

  const readOrder = async () => {
    const { data, error } = await admin
      .from("topup_orders")
      .select("id, user_id, credit_amount, bonus_credit, price_usd, status, payment_method, payment_provider_id, paid_at, expires_at")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .single();

    if (error || !data) {
      return null;
    }

    return data as TopupOrderRow;
  };

  let order = await readOrder();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "awaiting_payment" && order.payment_method === "stripe") {
    try {
      if (order.payment_provider_id) {
        const stripe = getStripeClient();
        const stripeSession = await stripe.checkout.sessions.retrieve(order.payment_provider_id);

        if (stripeSession.payment_status === "paid") {
          const result = await finalizeStripeTopupSession(stripeSession);
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error ?? "Failed to finalize payment" },
              { status: Number(result.status ?? 500) }
            );
          }
        }

        if (stripeSession.status === "expired") {
          await admin
            .from("topup_orders")
            .update({
              status: "expired",
              payment_provider_session: JSON.stringify(stripeSession),
              payment_method: "stripe",
            })
            .eq("id", order.id)
            .eq("status", "awaiting_payment");
        }
      } else if (order.expires_at && new Date(order.expires_at) < new Date()) {
        await admin
          .from("topup_orders")
          .update({
            status: "expired",
            payment_method: "stripe",
          })
          .eq("id", order.id)
          .eq("status", "awaiting_payment");
      }

      order = (await readOrder()) ?? order;
    } catch (err) {
      console.error("[topup/status] Stripe query failed:", err);
    }
  }

  return NextResponse.json({
    id: order.id,
    status: order.status,
    credit_amount: order.credit_amount,
    bonus_credit: order.bonus_credit,
    paid_at: order.paid_at,
    expires_at: order.expires_at,
  });
}
