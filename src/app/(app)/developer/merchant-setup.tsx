"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function MerchantSetup() {
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const { error: insertErr } = await supabase.from("merchants").insert({
      user_id: user.id,
      name,
      website_url: websiteUrl || null,
      webhook_url: webhookUrl || null,
    });

    if (insertErr) {
      setError(insertErr.message);
      setLoading(false);
    } else {
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">App / Business Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="My App"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Website URL (optional)</label>
        <input
          type="url"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="https://myapp.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Webhook URL (optional)</label>
        <input
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="https://myapp.com/api/webhook"
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-accent text-white rounded-xl font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {loading ? "Registering..." : "Register as Merchant"}
      </button>
    </form>
  );
}
