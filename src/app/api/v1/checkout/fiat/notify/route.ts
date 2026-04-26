import { finalizeFiatCheckoutSession } from "@/lib/checkout";
import { getAdminClient } from "@/lib/merchant-auth";
import { formDataToObject, verifyXunhuPayload } from "@/lib/xunhupay";

export async function POST(request: Request) {
  const payload = formDataToObject(await request.formData());

  if (!verifyXunhuPayload(payload)) {
    return new Response("invalid hash", { status: 400 });
  }

  const sessionId = payload.trade_order_id;
  if (!sessionId) {
    return new Response("missing trade_order_id", { status: 400 });
  }

  const admin = getAdminClient();
  const providerId = payload.open_order_id ?? payload.transaction_id ?? null;
  const providerSession = JSON.stringify(payload);

  if (payload.status === "OD") {
    await admin
      .from("checkout_sessions")
      .update({
        payment_provider_id: providerId,
        payment_provider_session: providerSession,
        payment_provider_status: "paid",
      })
      .eq("id", sessionId);

    const result = await finalizeFiatCheckoutSession(sessionId);
    if (!result.ok) {
      return new Response(result.error ?? "failed", { status: Number(result.status ?? 500) });
    }

    return new Response("success");
  }

  if (payload.status === "CD") {
    await admin
      .from("checkout_sessions")
      .update({
        payment_provider_id: providerId,
        payment_provider_session: providerSession,
        payment_provider_status: "failed",
      })
      .eq("id", sessionId)
      .eq("status", "pending");

    return new Response("success");
  }

  await admin
    .from("checkout_sessions")
    .update({
      payment_provider_id: providerId,
      payment_provider_session: providerSession,
      payment_provider_status: payload.status ?? "awaiting_payment",
    })
    .eq("id", sessionId)
    .eq("status", "pending");

  return new Response("success");
}
