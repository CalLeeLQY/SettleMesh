import { completeCheckoutSession } from "@/lib/checkout";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { session_id } = await request.json();
  if (!session_id) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const result = await completeCheckoutSession({
    sessionId: session_id,
    paymentMethod: "credit",
    payerId: user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    session_id: result.session.id,
    credits_remaining: result.creditsRemaining,
  });
 }
