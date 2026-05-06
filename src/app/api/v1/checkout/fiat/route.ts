import { createStripeCheckoutSession, dollarsToCents } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { after, NextResponse } from "next/server";

type StripeFiatCheckout = {
  id: string;
  amount_credit: number;
  description: string;
  merchant_name: string;
};

type TimingMark = {
  name: string;
  start: number;
  duration?: number;
};

function finishTiming(mark: TimingMark) {
  mark.duration = performance.now() - mark.start;
}

function serverTimingHeader(marks: TimingMark[]) {
  return marks
    .filter((mark) => typeof mark.duration === "number")
    .map((mark) => `${mark.name};dur=${mark.duration!.toFixed(1)}`)
    .join(", ");
}

function jsonWithTiming(
  body: Parameters<typeof NextResponse.json>[0],
  init: ResponseInit | undefined,
  timings: TimingMark[]
) {
  const response = NextResponse.json(body, init);
  const header = serverTimingHeader(timings);
  if (header) {
    response.headers.set("Server-Timing", header);
    response.headers.set("X-SettleMesh-Timing", header);
  }
  return response;
}

function serializeInitialStripeSession(session: {
  id: string;
  object: string;
  amount_total: number | null;
  currency: string | null;
  created: number;
  expires_at: number | null;
  mode: string | null;
  payment_status: string;
  status: string | null;
  url: string | null;
}) {
  return JSON.stringify({
    id: session.id,
    object: session.object,
    amount_total: session.amount_total,
    currency: session.currency,
    created: session.created,
    expires_at: session.expires_at,
    mode: session.mode,
    payment_status: session.payment_status,
    status: session.status,
    url: session.url,
  });
}

export async function POST(request: Request) {
  const timings: TimingMark[] = [];
  const mark = (name: string) => {
    const timing = { name, start: performance.now() };
    timings.push(timing);
    return timing;
  };

  let body: { session_id?: string; payer_email?: string; payer_name?: string };

  const parseTiming = mark("parse");
  try {
    body = await request.json();
    finishTiming(parseTiming);
  } catch {
    finishTiming(parseTiming);
    return jsonWithTiming({ error: "Invalid JSON body" }, { status: 400 }, timings);
  }

  const { session_id, payer_email, payer_name } = body;

  if (!session_id) {
    return jsonWithTiming({ error: "Missing session_id" }, { status: 400 }, timings);
  }

  const prepareTiming = mark("supabase_prepare");
  const supabase = await createClient();
  const { data: session, error: sessionErr } = await supabase
    .rpc("prepare_stripe_fiat_checkout", {
      p_session_id: session_id,
      p_payer_email: typeof payer_email === "string" ? payer_email : null,
      p_payer_name: typeof payer_name === "string" ? payer_name : null,
    })
    .single();
  finishTiming(prepareTiming);

  if (sessionErr) {
    return jsonWithTiming(
      { error: sessionErr.message || "Checkout session not found" },
      { status: 400 },
      timings
    );
  }

  const checkoutSessionRow = session as StripeFiatCheckout;
  const creditAmount = checkoutSessionRow.amount_credit;
  const fiatAmount = Number((creditAmount / 100).toFixed(2));

  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    const failTiming = mark("supabase_mark_failed");
    await supabase.rpc("mark_stripe_fiat_checkout_failed", {
      p_session_id: session_id,
      p_payer_email: typeof payer_email === "string" ? payer_email : null,
      p_payer_name: typeof payer_name === "string" ? payer_name : null,
    });
    finishTiming(failTiming);
    return jsonWithTiming({ error: "Invalid checkout amount" }, { status: 400 }, timings);
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const returnUrl = new URL(`/checkout/${session_id}`, baseUrl);
  returnUrl.searchParams.set("fiat_return", "1");

  try {
    const stripeTiming = mark("stripe_create");
    const checkoutSession = await createStripeCheckoutSession({
      mode: "payment",
      client_reference_id: checkoutSessionRow.id,
      customer_email: typeof payer_email === "string" && payer_email.trim() ? payer_email.trim() : undefined,
      success_url: returnUrl.toString(),
      cancel_url: new URL(`/checkout/${session_id}`, baseUrl).toString(),
      metadata: {
        kind: "checkout_fiat",
        checkout_session_id: checkoutSessionRow.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: dollarsToCents(fiatAmount),
            product_data: {
              name: `${checkoutSessionRow.merchant_name}: ${checkoutSessionRow.description}`,
              description: `${creditAmount.toLocaleString()} AnyPay credits`,
            },
          },
        },
      ],
    });
    finishTiming(stripeTiming);

    after(async () => {
      const { error: attachErr } = await supabase.rpc("attach_stripe_fiat_checkout_provider", {
        p_session_id: checkoutSessionRow.id,
        p_provider_id: checkoutSession.id,
        p_provider_session: serializeInitialStripeSession(checkoutSession),
        p_payer_email: typeof payer_email === "string" ? payer_email : null,
        p_payer_name: typeof payer_name === "string" ? payer_name : null,
      });

      if (attachErr) {
        console.error("[checkout/fiat] Failed to attach Stripe session:", attachErr.message);
      }
    });

    return jsonWithTiming(
      {
        success: true,
        session_id: checkoutSessionRow.id,
        payment_url: checkoutSession.url,
        fiat_amount: fiatAmount,
      },
      undefined,
      timings
    );
  } catch (error) {
    const failTiming = mark("supabase_mark_failed");
    await supabase.rpc("mark_stripe_fiat_checkout_failed", {
      p_session_id: checkoutSessionRow.id,
      p_payer_email: typeof payer_email === "string" ? payer_email : null,
      p_payer_name: typeof payer_name === "string" ? payer_name : null,
    });
    finishTiming(failTiming);

    return jsonWithTiming(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 502 },
      timings
    );
  }
}
