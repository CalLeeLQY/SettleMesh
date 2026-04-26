import { finalizeFiatCheckoutSession } from "@/lib/checkout";
import { getAdminClient } from "@/lib/merchant-auth";
import { queryXunhuPayment } from "@/lib/xunhupay";
import { NextResponse } from "next/server";

type CheckoutSessionRow = {
  id: string;
  status: string;
  expires_at: string;
  completed_at: string | null;
  payment_method: string | null;
  payment_provider_id: string | null;
  payment_provider_status: string | null;
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
      .select("id, status, expires_at, completed_at, payment_method, payment_provider_id, payment_provider_status")
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
      const currentSession = session;
      const queryWithTimeout = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          return await queryXunhuPayment({
            tradeOrderId: currentSession.id,
            openOrderId: currentSession.payment_provider_id ?? undefined,
          });
        } finally {
          clearTimeout(timer);
        }
      };

      const query = await queryWithTimeout();

      if (query.status === "OD") {
        await admin
          .from("checkout_sessions")
          .update({
            payment_provider_id: query.providerOrderId,
            payment_provider_session: JSON.stringify(query.raw),
            payment_provider_status: "paid",
          })
          .eq("id", session.id);

        const result = await finalizeFiatCheckoutSession(session.id);
        if (!result.ok) {
          return NextResponse.json({ error: result.error ?? "Failed to finalize payment" }, { status: Number(result.status ?? 500) });
        }
      }

      if (query.status === "CD") {
        await admin
          .from("checkout_sessions")
          .update({
            payment_provider_id: query.providerOrderId,
            payment_provider_session: JSON.stringify(query.raw),
            payment_provider_status: "failed",
          })
          .eq("id", session.id)
          .eq("status", "pending");
      }

      session = (await readSession()) ?? session;
    } catch (error) {
      console.error("[checkout/fiat/status] XunhuPay query failed:", error);
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
