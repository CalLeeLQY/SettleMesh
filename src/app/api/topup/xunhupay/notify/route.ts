import { finalizeLinkedCheckoutForTopup } from "@/lib/checkout";
import { getAdminClient } from "@/lib/merchant-auth";
import { formDataToObject, verifyXunhuPayload } from "@/lib/xunhupay";

type CompleteTopupRpcResult = {
  ok: boolean;
  status: number;
  error?: string;
};

export async function POST(request: Request) {
  const payload = formDataToObject(await request.formData());

  if (!verifyXunhuPayload(payload)) {
    return new Response("invalid hash", { status: 400 });
  }

  const orderId = payload.trade_order_id;
  if (!orderId) {
    return new Response("missing trade_order_id", { status: 400 });
  }

  const admin = getAdminClient();
  const providerId = payload.open_order_id ?? payload.transaction_id ?? null;
  const providerSession = JSON.stringify(payload);

  if (payload.status === "OD") {
    const { data, error } = await admin.rpc("complete_topup_order", {
      p_order_id: orderId,
      p_provider_id: providerId,
      p_provider_session: providerSession,
      p_paid_at: new Date().toISOString(),
    });

    const result = data as CompleteTopupRpcResult | null;
    if (error || !result?.ok) {
      return new Response(result?.error ?? error?.message ?? "failed", {
        status: Number(result?.status ?? 500),
      });
    }

    const checkoutResult = await finalizeLinkedCheckoutForTopup(orderId);
    if (!checkoutResult.ok) {
      console.error("[topup/xunhupay/notify] Failed to finalize linked checkout:", checkoutResult.error);
    }

    return new Response("success");
  }

  if (payload.status === "CD") {
    await admin
      .from("topup_orders")
      .update({
        status: "failed",
        payment_provider_id: providerId,
        payment_provider_session: providerSession,
        payment_method: "xunhupay",
      })
      .eq("id", orderId)
      .eq("status", "awaiting_payment");

    return new Response("success");
  }

  await admin
    .from("topup_orders")
    .update({
      payment_provider_id: providerId,
      payment_provider_session: providerSession,
      payment_method: "xunhupay",
    })
    .eq("id", orderId)
    .eq("status", "awaiting_payment");

  return new Response("success");
}
