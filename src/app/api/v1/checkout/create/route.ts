import { NextResponse } from "next/server";
import { verifyApiKey, getAdminClient } from "@/lib/merchant-auth";

export async function POST(request: Request) {
  // Authenticate merchant via API key
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 }
    );
  }

  const apiKey = authHeader.slice(7);
  const merchant = await verifyApiKey(apiKey);
  if (!merchant) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401 }
    );
  }

  // Parse request body
  let body: {
    amount: number;
    description: string;
    external_id?: string;
    metadata?: Record<string, unknown>;
    return_url?: string;
    cancel_url?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { amount, description, external_id, metadata, return_url, cancel_url } = body;

  if (!amount || typeof amount !== "number" || amount < 1) {
    return NextResponse.json(
      { error: "amount must be a positive integer (credits)" },
      { status: 400 }
    );
  }

  if (!description || typeof description !== "string") {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  // Create checkout session
  const { data: session, error } = await admin
    .from("checkout_sessions")
    .insert({
      merchant_id: merchant.id,
      external_id: external_id || null,
      amount_credit: Math.floor(amount),
      description,
      metadata: metadata || {},
      return_url: return_url || null,
      cancel_url: cancel_url || null,
    })
    .select()
    .single();

  if (error || !session) {
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "http://localhost:3000";
  const guestCheckoutAvailable =
    merchant.allow_guest_checkout !== false &&
    merchant.mock_fiat_enabled !== false &&
    session.amount_credit >= (merchant.guest_checkout_min_credit ?? 0);

  return NextResponse.json({
    id: session.id,
    url: `${baseUrl}/checkout/${session.id}`,
    amount_credit: session.amount_credit,
    description: session.description,
    status: session.status,
    expires_at: session.expires_at,
    payment_methods: {
      credit: true,
      fiat: guestCheckoutAvailable,
      mock_fiat: guestCheckoutAvailable,
    },
    fiat_amount_usd: Number((session.amount_credit / 100).toFixed(2)),
    mock_fiat_amount_usd: Number((session.amount_credit / 100).toFixed(2)),
  });
}
