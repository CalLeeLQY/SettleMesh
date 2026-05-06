import { getAdminClient } from "@/lib/merchant-auth";
import { deliverCheckoutWebhook } from "@/lib/webhook-delivery";
import { after } from "next/server";

interface CompleteCheckoutInput {
  sessionId: string;
  paymentMethod: "credit" | "mock_fiat" | "fiat";
  payerId?: string | null;
  payerEmail?: string | null;
  payerName?: string | null;
  allowExpired?: boolean;
}

type CompleteCheckoutRpcResult = {
  ok: boolean;
  status?: number;
  error?: string;
  already_processed?: boolean;
  session_id?: string;
  payment_method?: CompleteCheckoutInput["paymentMethod"];
  merchant_name?: string;
  credits_remaining?: number | null;
  completed_at?: string;
  amount_credit?: number;
  external_id?: string | null;
  description?: string;
  metadata?: unknown;
  payer_id?: string | null;
  payer_email?: string | null;
  payer_name?: string | null;
  webhook_url?: string | null;
  webhook_secret?: string | null;
  merchant_id?: string | null;
  merchant_user_id?: string | null;
};

export async function completeCheckoutSession({
  sessionId,
  paymentMethod,
  payerId = null,
  payerEmail = null,
  payerName = null,
  allowExpired = false,
}: CompleteCheckoutInput) {
  const admin = getAdminClient();

  const { data, error } = await admin.rpc("complete_checkout_session", {
    p_session_id: sessionId,
    p_payment_method: paymentMethod,
    p_payer_id: payerId,
    p_payer_email: payerEmail,
    p_payer_name: payerName,
    p_allow_expired: allowExpired,
  });

  const result = data as CompleteCheckoutRpcResult | null;
  if (error || !result) {
    return {
      ok: false as const,
      status: 500,
      error: error?.message ?? "Failed to complete checkout",
    };
  }

  if (!result.ok) {
    return {
      ok: false as const,
      status: Number(result.status ?? 500),
      error: result.error ?? "Failed to complete checkout",
    };
  }

  const resolvedSessionId = result.session_id ?? sessionId;
  const resolvedPaymentMethod = result.payment_method ?? paymentMethod;
  const completedAt = result.completed_at ?? new Date().toISOString();

  if (!result.already_processed && result.webhook_url && result.webhook_secret) {
    const webhookPayload = JSON.stringify({
      event: "checkout.completed",
      data: {
        id: resolvedSessionId,
        external_id: result.external_id ?? null,
        amount_credit: result.amount_credit,
        description: result.description,
        metadata: result.metadata ?? {},
        payer_id: result.payer_id ?? payerId,
        payer_email: result.payer_email ?? payerEmail,
        payer_name: result.payer_name ?? payerName,
        payment_method: resolvedPaymentMethod,
        completed_at: completedAt,
      },
    });

    after(async () => {
      let merchantId = result.merchant_id ?? null;
      if (!merchantId) {
        const { data: session } = await admin
          .from("checkout_sessions")
          .select("merchant_id")
          .eq("id", resolvedSessionId)
          .single();

        merchantId = session?.merchant_id ?? null;
      }

      await deliverCheckoutWebhook({
        checkoutSessionId: resolvedSessionId,
        merchantId,
        webhookUrl: result.webhook_url!,
        webhookSecret: result.webhook_secret!,
        payload: webhookPayload,
      });
    });
  }

  return {
    ok: true as const,
    alreadyProcessed: Boolean(result.already_processed),
    session: { id: resolvedSessionId },
    paymentMethod: resolvedPaymentMethod,
    merchantName: result.merchant_name,
    creditsRemaining: result.credits_remaining ?? null,
  };
}

export async function finalizeLinkedCheckoutForTopup(orderId: string) {
  const admin = getAdminClient();

  const { data: order } = await admin
    .from("topup_orders")
    .select("id, user_id, checkout_session_id")
    .eq("id", orderId)
    .single();

  if (!order?.checkout_session_id) {
    return { ok: true as const, skipped: true as const };
  }

  const { data: session } = await admin
    .from("checkout_sessions")
    .select("id, status, payer_email, payer_name")
    .eq("id", order.checkout_session_id)
    .single();

  if (!session) {
    return { ok: false as const, status: 404, error: "Linked checkout session not found" };
  }

  if (session.status === "completed") {
    return { ok: true as const, skipped: true as const, alreadyCompleted: true as const };
  }

  return completeCheckoutSession({
    sessionId: order.checkout_session_id,
    paymentMethod: "credit",
    payerId: order.user_id,
    payerEmail: session.payer_email,
    payerName: session.payer_name,
  });
}

export async function finalizeFiatCheckoutSession(sessionId: string) {
  const admin = getAdminClient();

  const { data: session } = await admin
    .from("checkout_sessions")
    .select("id, status, payer_email, payer_name")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return { ok: false as const, status: 404, error: "Checkout session not found" };
  }

  if (session.status === "completed") {
    return { ok: true as const, skipped: true as const, alreadyCompleted: true as const };
  }

  return completeCheckoutSession({
    sessionId,
    paymentMethod: "fiat",
    payerEmail: session.payer_email,
    payerName: session.payer_name,
    allowExpired: true,
  });
}
