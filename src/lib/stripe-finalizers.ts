import type Stripe from "stripe";
import { finalizeFiatCheckoutSession, finalizeLinkedCheckoutForTopup } from "@/lib/checkout";
import { getAdminClient } from "@/lib/merchant-auth";
import { stripeAmountMatches } from "@/lib/stripe";

type CompleteTopupRpcResult = {
  ok: boolean;
  status: number;
  error?: string;
  already_processed?: boolean;
};

function serializeStripeObject(value: unknown) {
  return JSON.stringify(value);
}

export async function finalizeStripeTopupSession(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.order_id ?? session.client_reference_id;
  if (!orderId) {
    return { ok: false as const, status: 400, error: "Missing top-up order reference" };
  }

  if (session.payment_status !== "paid") {
    return { ok: false as const, status: 400, error: "Stripe session is not paid" };
  }

  const admin = getAdminClient();
  const { data: order } = await admin
    .from("topup_orders")
    .select("id, price_usd, status")
    .eq("id", orderId)
    .single();

  if (!order) {
    return { ok: false as const, status: 404, error: "Top-up order not found" };
  }

  if (!stripeAmountMatches(session.amount_total, order.price_usd)) {
    return { ok: false as const, status: 400, error: "Payment amount mismatch" };
  }

  const { data, error } = await admin.rpc("complete_topup_order", {
    p_order_id: orderId,
    p_provider_id: session.id,
    p_provider_session: serializeStripeObject(session),
    p_paid_at: new Date((session.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  });

  const result = data as CompleteTopupRpcResult | null;
  if (error || !result?.ok) {
    return {
      ok: false as const,
      status: Number(result?.status ?? 500),
      error: result?.error ?? error?.message ?? "Failed to finalize payment",
    };
  }

  const checkoutResult = await finalizeLinkedCheckoutForTopup(orderId);
  if (!checkoutResult.ok) {
    console.error("[stripe] Failed to finalize linked checkout:", checkoutResult.error);
  }

  return { ok: true as const, orderId, alreadyProcessed: Boolean(result.already_processed) };
}

export async function finalizeStripeFiatCheckoutSession(session: Stripe.Checkout.Session) {
  const checkoutSessionId = session.metadata?.checkout_session_id ?? session.client_reference_id;
  if (!checkoutSessionId) {
    return { ok: false as const, status: 400, error: "Missing checkout session reference" };
  }

  if (session.payment_status !== "paid") {
    return { ok: false as const, status: 400, error: "Stripe session is not paid" };
  }

  const admin = getAdminClient();
  const { data: checkoutSession } = await admin
    .from("checkout_sessions")
    .select("id, amount_credit, status")
    .eq("id", checkoutSessionId)
    .single();

  if (!checkoutSession) {
    return { ok: false as const, status: 404, error: "Checkout session not found" };
  }

  const expectedFiatAmount = Number((checkoutSession.amount_credit / 100).toFixed(2));
  if (!stripeAmountMatches(session.amount_total, expectedFiatAmount)) {
    return { ok: false as const, status: 400, error: "Payment amount mismatch" };
  }

  await admin
    .from("checkout_sessions")
    .update({
      payment_provider_id: session.id,
      payment_provider_session: serializeStripeObject(session),
      payment_provider_status: "paid",
    })
    .eq("id", checkoutSessionId);

  const result = await finalizeFiatCheckoutSession(checkoutSessionId);
  if (!result.ok) {
    return {
      ok: false as const,
      status: Number(result.status ?? 500),
      error: result.error ?? "Failed to finalize payment",
    };
  }

  return { ok: true as const, checkoutSessionId };
}
