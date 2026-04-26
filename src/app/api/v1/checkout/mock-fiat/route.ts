import { completeCheckoutSession } from "@/lib/checkout";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { session_id, payer_email, payer_name } = await request.json();

  if (!session_id) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  if (!payer_email || typeof payer_email !== "string") {
    return NextResponse.json({ error: "payer_email is required" }, { status: 400 });
  }

  const result = await completeCheckoutSession({
    sessionId: session_id,
    paymentMethod: "mock_fiat",
    payerEmail: payer_email,
    payerName: typeof payer_name === "string" ? payer_name : null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    session_id: result.session.id,
    payment_method: "mock_fiat",
  });
}
