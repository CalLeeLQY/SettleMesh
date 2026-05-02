import { getAdminClient, signWebhookPayload } from "@/lib/merchant-auth";

type CheckoutWebhookInput = {
  checkoutSessionId: string;
  merchantId?: string | null;
  webhookUrl: string;
  webhookSecret: string;
  payload: string;
};

async function createDeliveryRecord(input: CheckoutWebhookInput) {
  const admin = getAdminClient();
  const timestamp = Date.now().toString();
  const signature = signWebhookPayload(input.payload, input.webhookSecret, timestamp);

  const { data, error } = await admin
    .from("webhook_deliveries")
    .insert({
      checkout_session_id: input.checkoutSessionId,
      merchant_id: input.merchantId ?? null,
      event_type: "checkout.completed",
      target_url: input.webhookUrl,
      payload: JSON.parse(input.payload),
      signature,
      signature_version: "v1",
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, timestamp, signature };
  }

  return { id: data.id as string, timestamp, signature };
}

async function updateDeliveryRecord(
  id: string | null,
  patch: Record<string, unknown>
) {
  if (!id) return;

  const admin = getAdminClient();
  await admin.from("webhook_deliveries").update(patch).eq("id", id);
}

export async function deliverCheckoutWebhook(input: CheckoutWebhookInput) {
  const delivery = await createDeliveryRecord(input);

  try {
    const response = await fetch(input.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AnyPay-Signature": delivery.signature,
        "X-AnyPay-Signature-Version": "v1",
        "X-AnyPay-Timestamp": delivery.timestamp,
      },
      body: input.payload,
      signal: AbortSignal.timeout(5000),
    });

    const responseBody = await response.text().catch(() => "");

    await updateDeliveryRecord(delivery.id, {
      status: response.ok ? "delivered" : "failed",
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
      response_status: response.status,
      response_body: responseBody.slice(0, 4096),
      next_attempt_at: response.ok
        ? null
        : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    return { ok: response.ok, status: response.status };
  } catch (error) {
    await updateDeliveryRecord(delivery.id, {
      status: "failed",
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
      response_body: error instanceof Error ? error.message : "Webhook delivery failed",
      next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Webhook delivery failed",
    };
  }
}
