import { getAdminClient } from "@/lib/merchant-auth";
import { finalizeStripeFiatCheckoutSession, finalizeStripeTopupSession } from "@/lib/stripe-finalizers";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("missing stripe signature", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      payload,
      signature,
      getStripeWebhookSecret()
    );
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "invalid stripe signature",
      { status: 400 }
    );
  }

  const stripeSession = event.data.object as Stripe.Checkout.Session;

  if (event.type === "checkout.session.completed" && stripeSession.payment_status !== "paid") {
    return new Response("success");
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    if (stripeSession.metadata?.kind === "topup") {
      const result = await finalizeStripeTopupSession(stripeSession);
      if (!result.ok) {
        return new Response(result.error ?? "failed", {
          status: Number(result.status ?? 500),
        });
      }
    }

    if (stripeSession.metadata?.kind === "checkout_fiat") {
      const result = await finalizeStripeFiatCheckoutSession(stripeSession);
      if (!result.ok) {
        return new Response(result.error ?? "failed", {
          status: Number(result.status ?? 500),
        });
      }
    }
  }

  if (
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const admin = getAdminClient();

    if (stripeSession.metadata?.kind === "topup") {
      const orderId = stripeSession.metadata.order_id ?? stripeSession.client_reference_id;
      if (orderId) {
        await admin
          .from("topup_orders")
          .update({
            status: event.type === "checkout.session.expired" ? "expired" : "failed",
            payment_provider_id: stripeSession.id,
            payment_provider_session: JSON.stringify(stripeSession),
            payment_method: "stripe",
          })
          .eq("id", orderId)
          .eq("status", "awaiting_payment");
      }
    }

    if (stripeSession.metadata?.kind === "checkout_fiat") {
      const checkoutSessionId =
        stripeSession.metadata.checkout_session_id ?? stripeSession.client_reference_id;
      if (checkoutSessionId) {
        await admin
          .from("checkout_sessions")
          .update({
            payment_provider_id: stripeSession.id,
            payment_provider_session: JSON.stringify(stripeSession),
            payment_provider_status:
              event.type === "checkout.session.expired" ? "expired" : "failed",
          })
          .eq("id", checkoutSessionId)
          .eq("status", "pending");
      }
    }
  }

  return new Response("success");
}
