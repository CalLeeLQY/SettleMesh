"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Coins } from "lucide-react";

export function CheckoutForm({
  sessionId,
  amount,
  balance,
  isLoggedIn,
  allowFiatCheckout,
  fiatAmountUsd,
  returnUrl,
  cancelUrl,
  merchantName,
}: {
  sessionId: string;
  amount: number;
  balance: number;
  isLoggedIn: boolean;
  allowFiatCheckout: boolean;
  fiatAmountUsd: number;
  returnUrl: string | null;
  cancelUrl: string | null;
  merchantName: string;
}) {
  const searchParams = useSearchParams();
  const isFiatReturn = searchParams.get("fiat_return") === "1";
  const [loading, setLoading] = useState<"credit" | "fiat" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const canAfford = balance >= amount;

  useEffect(() => {
    if (!isFiatReturn) return;

    let cancelled = false;

    async function pollStatus() {
      setLoading("fiat");
      setError("");

      const delays = [0, 1000, 1000, 2000, 2000, 2000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000];

      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        if (delays[attempt] > 0) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }

        if (cancelled) return;

        const res = await fetch(`/api/v1/checkout/fiat/status?session_id=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);

        if (cancelled) return;

        if (!res.ok) {
          setError(data?.error ?? "Failed to confirm fiat payment");
          setLoading(null);
          return;
        }

        if (data?.status === "completed") {
          setSuccess(true);
          if (returnUrl) {
            setTimeout(() => {
              window.location.href = returnUrl;
            }, 1500);
          }
          return;
        }

        if (data?.status === "failed") {
          setError("Fiat payment failed");
          setLoading(null);
          return;
        }
      }

      if (!cancelled) {
        setError("Payment confirmation is taking longer than expected. Your payment may still be processing — you can refresh this page to check again.");
        setLoading(null);
      }
    }

    void pollStatus();

    return () => {
      cancelled = true;
    };
  }, [isFiatReturn, returnUrl, sessionId]);

  async function finishCheckout(path: "credit" | "fiat") {
    setLoading(path);
    setError("");

    const res = await fetch(
      path === "credit" ? "/api/v1/checkout/confirm" : "/api/v1/checkout/fiat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          path === "credit"
            ? JSON.stringify({ session_id: sessionId })
            : JSON.stringify({ session_id: sessionId }),
      }
    );

    const data = await res.json().catch(() => null);

    if (res.ok) {
      if (path === "fiat") {
        if (typeof data?.payment_url === "string") {
          window.location.href = data.payment_url;
          return;
        }

        setError("Missing payment URL");
        setLoading(null);
        return;
      }

      setSuccess(true);
      if (returnUrl) {
        setTimeout(() => {
          window.location.href = returnUrl;
        }, 1500);
      }
      return;
    }

    setError(data?.error ?? "Payment failed");
    setLoading(null);
  }

  if (success) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-3">✅</div>
        <h2 className="text-lg font-bold mb-1">Payment Successful!</h2>
        <p className="text-sm text-gray-500">
          {returnUrl ? `Redirecting to ${merchantName}...` : "You can close this page."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <h2 className="font-medium">Pay with Credit</h2>
            <p className="text-sm text-gray-500">Instant checkout using your AnyPay balance.</p>
          </div>
          {isLoggedIn ? (
            <span className="text-xs text-gray-400">Balance: {balance.toLocaleString()}</span>
          ) : (
            <span className="text-xs text-gray-400">Login required</span>
          )}
        </div>

        {isLoggedIn ? (
          canAfford ? (
            <button
              onClick={() => finishCheckout("credit")}
              disabled={loading !== null}
              className="w-full py-3 bg-accent text-white rounded-xl font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <Coins size={16} />
              {loading === "credit" ? "Processing..." : `Pay ${amount.toLocaleString()} credits`}
            </button>
          ) : (
            <div className="space-y-3">
              <button
                disabled
                className="w-full py-3 bg-gray-200 text-gray-400 rounded-xl font-medium cursor-not-allowed"
              >
                Insufficient credits ({balance.toLocaleString()} / {amount.toLocaleString()})
              </button>
              <Link
                href={`/topup?next=/checkout/${sessionId}`}
                className="block text-center text-sm text-accent hover:underline"
              >
                Top up credits
              </Link>
            </div>
          )
        ) : (
          <Link
            href={`/login?next=/checkout/${sessionId}`}
            className="block w-full py-3 border border-border rounded-xl text-center text-sm font-medium hover:bg-muted transition-colors"
          >
            Sign in to pay with Credit
          </Link>
        )}
      </div>

      <div className="border border-border rounded-xl p-4">
        <div className="mb-3">
          <h2 className="font-medium">Pay with Fiat</h2>
          <p className="text-sm text-gray-500">Pay directly with XunhuPay. The merchant receives credits automatically after payment.</p>
        </div>

        {allowFiatCheckout ? (
          <div className="space-y-3">
            <div className="text-sm text-gray-500">Charge amount: ${fiatAmountUsd.toFixed(2)}</div>
            <button
              onClick={() => finishCheckout("fiat")}
              disabled={loading !== null}
              className="w-full py-3 bg-foreground text-background rounded-xl font-medium disabled:opacity-50 transition-colors"
            >
              {loading === "fiat" ? "Processing payment..." : `Pay ${fiatAmountUsd.toFixed(2)} with XunhuPay`}
            </button>
          </div>
        ) : (
          <div className="text-sm text-gray-500">
            Fiat checkout is unavailable for this payment.
          </div>
        )}
      </div>

      {error && <p className="text-sm text-danger text-center">{error}</p>}
      {cancelUrl && (
        <a href={cancelUrl} className="block text-center text-sm text-gray-400 hover:underline">
          Cancel and return to {merchantName}
        </a>
      )}
    </div>
  );
}
