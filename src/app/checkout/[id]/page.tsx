import { getServerViewer } from "@/lib/supabase/viewer";
import { canUseGuestFiatCheckout } from "@/lib/payment-options";
import { Coins } from "lucide-react";
import { CheckoutForm } from "./checkout-form";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await getServerViewer();

  const { createClient: createServiceClient } = await import("@supabase/supabase-js");
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: session } = await admin
    .from("checkout_sessions")
    .select("*, merchants(name, website_url, allow_guest_checkout, guest_checkout_min_credit, mock_fiat_enabled)")
    .eq("id", id)
    .single();

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-gray-500">Checkout session not found.</p>
      </div>
    );
  }

  if (session.status === "completed") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">✅</div>
          <h1 className="text-xl font-bold mb-2">Payment Complete</h1>
          <p className="text-gray-500 text-sm">This session has already been paid.</p>
          {session.return_url && (
            <a href={session.return_url} className="mt-4 inline-block text-accent hover:underline text-sm">
              Return to {(session.merchants as { name: string })?.name ?? "merchant"}
            </a>
          )}
        </div>
      </div>
    );
  }

  if (session.status === "expired" || new Date(session.expires_at) < new Date()) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">⏰</div>
          <h1 className="text-xl font-bold mb-2">Session Expired</h1>
          <p className="text-gray-500 text-sm">This checkout session has expired.</p>
          {session.cancel_url && (
            <a href={session.cancel_url} className="mt-4 inline-block text-accent hover:underline text-sm">
              Return to {(session.merchants as { name: string })?.name ?? "merchant"}
            </a>
          )}
        </div>
      </div>
    );
  }

  const wallet = user
    ? (
        await supabase
          .from("wallets")
          .select("available_credit")
          .eq("user_id", user.id)
          .single()
      ).data
    : null;

  const merchant = session.merchants as {
    name: string;
    website_url: string | null;
    allow_guest_checkout?: boolean;
    guest_checkout_min_credit?: number;
    mock_fiat_enabled?: boolean;
  } | null;
  const fiatAmountUsd = Number((session.amount_credit / 100).toFixed(2));
  const allowFiatCheckout = canUseGuestFiatCheckout(merchant, session.amount_credit);

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Coins size={32} className="text-accent mx-auto mb-2" />
          <h1 className="text-xl font-bold">AnyPay Checkout</h1>
          {merchant && (
            <p className="text-sm text-gray-400 mt-1">Payment to {merchant.name}</p>
          )}
        </div>

        <div className="border border-border rounded-xl p-5 mb-4">
          <p className="text-sm text-gray-500 mb-1">Amount</p>
          <div className="flex items-center gap-1.5 text-2xl font-bold text-accent">
            <Coins size={20} />
            {session.amount_credit.toLocaleString()}
            <span className="text-sm font-normal text-gray-400">credits</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">Fiat amount: ${fiatAmountUsd.toFixed(2)}</p>
          <p className="text-sm text-gray-600 mt-3">{session.description}</p>
        </div>

        {user ? (
          <div className="text-sm text-gray-500 mb-4">
            Your balance: <span className="font-medium text-foreground">{(wallet?.available_credit ?? 0).toLocaleString()}</span> credits
          </div>
        ) : (
          <div className="text-sm text-gray-500 mb-4">
            Sign in to pay with Credit, or continue with direct fiat payment.
          </div>
        )}

        <CheckoutForm
          sessionId={session.id}
          amount={session.amount_credit}
          balance={wallet?.available_credit ?? 0}
          isLoggedIn={Boolean(user)}
          allowFiatCheckout={allowFiatCheckout}
          fiatAmountUsd={fiatAmountUsd}
          returnUrl={session.return_url}
          cancelUrl={session.cancel_url}
          merchantName={merchant?.name ?? "merchant"}
        />
      </div>
    </div>
  );
}
