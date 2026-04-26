"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Key, Trash2, Copy, Check } from "lucide-react";

interface ApiKey {
  id: string;
  key_prefix: string;
  label: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export function ApiKeyManager({
  merchantId,
  existingKeys,
}: {
  merchantId: string;
  existingKeys: ApiKey[];
}) {
  const [keys, setKeys] = useState<ApiKey[]>(existingKeys);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    setLoading(true);
    const res = await fetch("/api/v1/merchant/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant_id: merchantId }),
    });

    const data = await res.json();
    if (res.ok) {
      setNewKey(data.api_key);
      router.refresh();
    }
    setLoading(false);
  }

  async function handleRevoke(keyId: string) {
    const res = await fetch("/api/v1/merchant/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key_id: keyId }),
    });

    if (res.ok) {
      setKeys(keys.filter((k) => k.id !== keyId));
      router.refresh();
    }
  }

  function handleCopy() {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium">API Keys</h2>
        <button
          onClick={handleCreate}
          disabled={loading}
          className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {loading ? "Creating..." : "+ New Key"}
        </button>
      </div>

      {newKey && (
        <div className="bg-success/10 border border-success/30 rounded-xl p-4 mb-4">
          <p className="text-sm font-medium text-success mb-2">
            API key created! Copy it now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white p-2 rounded border break-all">
              {newKey}
            </code>
            <button
              onClick={handleCopy}
              className="p-2 text-gray-500 hover:text-foreground transition-colors"
            >
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-border rounded-xl">
          No API keys yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between p-3 border border-border rounded-xl"
            >
              <div className="flex items-center gap-3">
                <Key size={14} className="text-gray-400" />
                <div>
                  <div className="text-sm font-mono">{key.key_prefix}...****</div>
                  <div className="text-xs text-gray-400">
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at &&
                      ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleRevoke(key.id)}
                className="p-1.5 text-gray-400 hover:text-danger transition-colors"
                title="Revoke key"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
