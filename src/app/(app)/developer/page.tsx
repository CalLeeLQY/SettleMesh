import { getServerViewer } from "@/lib/supabase/viewer";
import { redirect } from "next/navigation";
import { MerchantSetup } from "./merchant-setup";
import { ApiKeyManager } from "./api-key-manager";
import { MerchantSettingsForm } from "./merchant-settings-form";

export default async function DeveloperPage() {
  const { supabase, user } = await getServerViewer();

  if (!user) redirect("/login");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!merchant) {
    return (
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-bold mb-2">Developer</h1>
        <p className="text-sm text-gray-500 mb-6">
          Register as a merchant to let external websites accept AnyPay credit payments.
        </p>
        <MerchantSetup />
      </div>
    );
  }

  const { data: apiKeys } = await supabase
    .from("merchant_api_keys")
    .select("id, key_prefix, label, is_active, last_used_at, created_at")
    .eq("merchant_id", merchant.id)
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-6">Developer</h1>

      <div className="border border-border rounded-xl p-5 mb-6">
        <h2 className="font-medium mb-3">Merchant Info</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-gray-500">Name</div>
          <div>{merchant.name}</div>
          <div className="text-gray-500">Merchant ID</div>
          <div className="font-mono text-xs">{merchant.id}</div>
          <div className="text-gray-500">Webhook URL</div>
          <div className="text-xs break-all">{merchant.webhook_url || "Not set"}</div>
          <div className="text-gray-500">Webhook Secret</div>
          <div className="font-mono text-xs">
            {merchant.webhook_secret
              ? `${merchant.webhook_secret.slice(0, 8)}...${merchant.webhook_secret.slice(-4)}`
              : "Generated when migrations are applied"}
          </div>
        </div>
      </div>

      <MerchantSettingsForm
        merchant={{
          id: merchant.id,
          name: merchant.name,
          website_url: merchant.website_url,
          webhook_url: merchant.webhook_url,
          allow_guest_checkout: merchant.allow_guest_checkout ?? true,
          guest_checkout_min_credit: merchant.guest_checkout_min_credit ?? 0,
          mock_fiat_enabled: merchant.mock_fiat_enabled ?? true,
        }}
      />

      <ApiKeyManager merchantId={merchant.id} existingKeys={apiKeys ?? []} />

      <div className="mt-8 border border-border rounded-xl p-5">
        <h2 className="font-medium mb-3">Integration Guide</h2>
        <div className="text-sm text-gray-600 space-y-3">
          <p><strong>1. Create a checkout session:</strong></p>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">{`POST /api/v1/checkout/create
Authorization: Bearer sk_live_xxx
Content-Type: application/json

{
  "amount": 100,
  "description": "Premium Plan",
  "return_url": "https://yoursite.com/success",
  "cancel_url": "https://yoursite.com/cancel",
  "external_id": "order_123",
  "metadata": { "plan": "premium" }
}`}</pre>

          <p><strong>2. Redirect user to the returned URL</strong></p>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">{`// Response:
{
  "id": "session_uuid",
  "url": "https://anypay.com/checkout/session_uuid",
  "amount_credit": 100,
  "status": "pending",
  "expires_at": "...",
  "payment_methods": {
    "credit": true,
    "fiat": true,
    "mock_fiat": false
  }
}`}</pre>

          <p><strong>3. Receive webhook on completion:</strong></p>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">{`POST your_webhook_url
X-AnyPay-Signature: hmac_sha256_hex
X-AnyPay-Signature-Version: v1
X-AnyPay-Timestamp: 1234567890

{
  "event": "checkout.completed",
  "data": {
    "id": "session_uuid",
    "external_id": "order_123",
    "amount_credit": 100,
    "metadata": { "plan": "premium" },
    "payer_id": "user_uuid",
    "payer_email": "payer@example.com",
    "payment_method": "credit",
    "completed_at": "..."
  }
}`}</pre>

          <p><strong>4. Verify webhook signature:</strong></p>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">{`const crypto = require('crypto');
const expected = crypto
  .createHmac('sha256', webhook_secret)
  .update(\`\${request.headers['x-anypay-timestamp']}.\${request_body}\`)
  .digest('hex');
const valid = expected === request.headers['x-anypay-signature'];`}</pre>
        </div>
      </div>
    </div>
  );
}
