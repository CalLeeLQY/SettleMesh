"use client";

import { useState, useEffect, Suspense, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/redirect";
import { useRouter, useSearchParams } from "next/navigation";
import { Coins, Check } from "lucide-react";

interface TopupPackage {
  id: string;
  slug: string;
  credit_amount: number;
  bonus_credit: number;
  price_usd: number;
  label: string;
}

export default function TopupPage() {
  return (
    <Suspense>
      <TopupContent />
    </Suspense>
  );
}

function TopupContent() {
  const [packages, setPackages] = useState<TopupPackage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeRedirectPath(searchParams.get("next"), "/dashboard");
  const orderId = searchParams.get("order_id") as string | null;
  const supabase = useMemo(() => createClient(), []);

  function isStripeCheckoutUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;

    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.endsWith("stripe.com");
    } catch {
      return false;
    }
  }

  useEffect(() => {
    supabase
      .from("topup_packages")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        if (data) setPackages(data);
        if (data && data.length > 0) setSelected(data[1]?.id ?? data[0].id);
      });
  }, [supabase]);

  useEffect(() => {
    const currentOrderId = orderId ?? "";
    if (!currentOrderId) return;

    let cancelled = false;

    async function pollStatus() {
      setLoading(true);
      setStatusMessage("Waiting for payment confirmation...");
      setErrorMessage(null);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const res = await fetch(`/api/topup/status?order_id=${encodeURIComponent(currentOrderId)}`, {
          cache: "no-store",
        });
        const payload = await res.json().catch(() => null);

        if (cancelled) return;

        if (!res.ok) {
          setErrorMessage(payload?.error || "Failed to check payment status");
          setStatusMessage(null);
          setLoading(false);
          return;
        }

        if (payload?.status === "completed") {
          setSuccess(true);
          setStatusMessage(null);
          setLoading(false);
          setTimeout(() => {
            router.push(next);
            router.refresh();
          }, 1500);
          return;
        }

        if (payload?.status === "failed" || payload?.status === "expired") {
          setErrorMessage("Payment was not completed.");
          setStatusMessage(null);
          setLoading(false);
          return;
        }

        if (attempt < 9) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!cancelled) {
        setStatusMessage("Payment is still processing. Please refresh in a moment.");
        setLoading(false);
      }
    }

    pollStatus();

    return () => {
      cancelled = true;
    };
  }, [next, orderId, router]);

  async function handleTopup() {
    if (!selected) return;
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const pkg = packages.find((p) => p.id === selected);
    if (!pkg) {
      setLoading(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const res = await fetch("/api/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package_id: pkg.id, next }),
    });
    const payload = await res.json().catch(() => null);

    if (res.ok) {
      if (isStripeCheckoutUrl(payload?.payment_url)) {
        window.location.assign(payload.payment_url);
        return;
      }

      if (payload?.payment_url) {
        setErrorMessage("Payment provider returned a non-Stripe checkout URL.");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push(next);
        router.refresh();
      }, 1500);
    } else {
      setErrorMessage(payload?.error || "Failed to create payment");
      setLoading(false);
    }
  }

  if (orderId && !success) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center mb-4">
          <Coins size={24} className="text-accent" />
        </div>
        <h2 className="text-lg font-bold">
          {errorMessage ? "Payment update" : "Confirming payment..."}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {errorMessage || statusMessage || "Checking order status..."}
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mb-4">
          <Check size={24} className="text-success" />
        </div>
        <h2 className="text-lg font-bold">Credits added!</h2>
        <p className="text-sm text-gray-500 mt-1">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-6">Top Up Credits</h1>

      <div className="space-y-3">
        {packages.map((pkg) => (
          <button
            key={pkg.id}
            onClick={() => setSelected(pkg.id)}
            className={`w-full flex items-center justify-between p-4 border rounded-xl transition-colors ${
              selected === pkg.id
                ? "border-accent bg-accent/5"
                : "border-border hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <Coins
                size={20}
                className={
                  selected === pkg.id ? "text-accent" : "text-gray-400"
                }
              />
              <div className="text-left">
                <div className="font-medium">{pkg.label}</div>
                {pkg.bonus_credit > 0 && (
                  <div className="text-xs text-success">
                    +{pkg.bonus_credit} bonus
                  </div>
                )}
              </div>
            </div>
            <div className="text-sm font-bold">
              ${pkg.price_usd.toFixed(2)}
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={handleTopup}
        disabled={!selected || loading}
        className="w-full mt-6 py-3 bg-accent text-white rounded-xl font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {loading ? "Opening Stripe..." : "Purchase with Stripe"}
      </button>

      {errorMessage && (
        <p className="text-sm text-red-500 text-center mt-4">{errorMessage}</p>
      )}

      <p className="text-xs text-gray-400 text-center mt-4">
        Credits are non-refundable and can only be used within the platform.
      </p>
    </div>
  );
}
