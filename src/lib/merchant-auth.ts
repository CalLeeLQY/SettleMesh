import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const key = `sk_live_${raw}`;
  const prefix = key.slice(0, 12);
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}

export async function verifyApiKey(apiKey: string) {
  if (!apiKey || !apiKey.startsWith("sk_live_")) {
    return null;
  }

  const prefix = apiKey.slice(0, 12);
  const hash = hashApiKey(apiKey);

  const { data: keyRecord } = await admin
    .from("merchant_api_keys")
    .select("id, merchant_id, is_active")
    .eq("key_prefix", prefix)
    .eq("key_hash", hash)
    .eq("is_active", true)
    .single();

  if (!keyRecord) return null;

  const { data: merchant } = await admin
    .from("merchants")
    .select("id, user_id, name, webhook_url, webhook_secret, is_active, allow_guest_checkout, guest_checkout_min_credit, mock_fiat_enabled")
    .eq("id", keyRecord.merchant_id)
    .eq("is_active", true)
    .single();

  if (!merchant) return null;

  // Update last_used_at
  await admin
    .from("merchant_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRecord.id);

  return merchant;
}

export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp?: string
): string {
  const signedPayload = timestamp ? `${timestamp}.${payload}` : payload;

  return crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
}

export function getAdminClient() {
  return admin;
}
