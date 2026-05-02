"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function MerchantSettingsForm({
  merchant,
}: {
  merchant: {
    id: string;
    name: string;
    website_url: string | null;
    webhook_url: string | null;
    allow_guest_checkout: boolean;
    guest_checkout_min_credit: number;
    mock_fiat_enabled: boolean;
  };
}) {
  const [name, setName] = useState(merchant.name);
  const [websiteUrl, setWebsiteUrl] = useState(merchant.website_url ?? "");
  const [webhookUrl, setWebhookUrl] = useState(merchant.webhook_url ?? "");
  const [allowGuestCheckout, setAllowGuestCheckout] = useState(merchant.allow_guest_checkout);
  const [guestCheckoutMinCredit, setGuestCheckoutMinCredit] = useState(String(merchant.guest_checkout_min_credit ?? 0));
  const [mockFiatEnabled, setMockFiatEnabled] = useState(merchant.mock_fiat_enabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const supabase = createClient();
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("merchants")
      .update({
        name,
        website_url: websiteUrl || null,
        webhook_url: webhookUrl || null,
        allow_guest_checkout: allowGuestCheckout,
        guest_checkout_min_credit: Number(guestCheckoutMinCredit) || 0,
        mock_fiat_enabled: mockFiatEnabled,
      })
      .eq("id", merchant.id);

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    setMessage("Saved");
    setSaving(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="border border-border rounded-xl p-5 mb-6 space-y-4">
      <h2 className="font-medium">Checkout Settings</h2>
      <div>
        <label className="block text-sm font-medium mb-1">Merchant Name</label>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Website URL</label>
        <input
          type="url"
          value={websiteUrl}
          onChange={(event) => setWebsiteUrl(event.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="https://myapp.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Webhook URL</label>
        <input
          type="url"
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="https://myapp.com/api/webhook"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowGuestCheckout}
          onChange={(event) => setAllowGuestCheckout(event.target.checked)}
        />
        Enable guest checkout
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mockFiatEnabled}
          onChange={(event) => setMockFiatEnabled(event.target.checked)}
        />
        Enable mock fiat checkout for tests
      </label>
      <p className="text-xs text-gray-500">
        Real Stripe fiat checkout is controlled by guest checkout settings. Mock fiat also requires the server runtime switch.
      </p>
      <div>
        <label className="block text-sm font-medium mb-1">Guest checkout minimum (credits)</label>
        <input
          type="number"
          min="0"
          value={guestCheckoutMinCredit}
          onChange={(event) => setGuestCheckoutMinCredit(event.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      {message && <p className="text-sm text-gray-500">{message}</p>}
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
