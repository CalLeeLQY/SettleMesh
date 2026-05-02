import { getAdminClient } from "@/lib/merchant-auth";
import { finalizeStripeFiatCheckoutSession } from "@/lib/stripe-finalizers";
import { getStripeClient } from "@/lib/stripe";
import { NextResponse } from "next/server";

type CheckoutSessionRow = {
  id: string;
  status: string;
  expires_at: string;
  completed_at: string | null;
  payment_method: string | null;
  payment_provider_id: string | null;
  payment_provider_status: string | null;
  amount_credit: number;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const admin = getAdminClient();

  const readSession = async () => {
    const { data, error } = await admin
      .from("checkout_sessions")
      .select("id, status, expires_at, completed_at, payment_method, payment_provider_id, payment_provider_status, amount_credit")
      .eq("id", sessionId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as CheckoutSessionRow;
  };

  let session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status === "completed") {
    return NextResponse.json(session);
  }

  if (session.payment_provider_status === "awaiting_payment" || session.payment_provider_id) {
    try {
      if (session.payment_provider_id) {
        const stripe = getStripeClient();
        const stripeSession = await stripe.checkout.sessions.retrieve(session.payment_provider_id);

        if (stripeSession.payment_status === "paid") {
          const result = await finalizeStripeFiatCheckoutSession(stripeSession);
          if (!result.ok) {
            return NextResponse.json({ error: result.error ?? "Failed to finalize payment" }, { status: Number(result.status ?? 500) });
          }
        }

        if (stripeSession.status === "expired") {
          await admin
            .from("checkout_sessions")
            .update({
              payment_provider_session: JSON.stringify(stripeSession),
              payment_provider_status: "expired",
            })
            .eq("id", session.id)
            .eq("status", "pending");
        }
      }

      session = (await readSession()) ?? session;
    } catch (error) {
      console.error("[checkout/fiat/status] Stripe query failed:", error);
    }
  }

  if (session.status === "completed") {
    return NextResponse.json(session);
  }

  if (new Date(session.expires_at) < new Date() && session.status === "pending") {
    await admin.from("checkout_sessions").update({ status: "expired" }).eq("id", session.id);
    session = (await readSession()) ?? session;
  }

  return NextResponse.json(session);
}
