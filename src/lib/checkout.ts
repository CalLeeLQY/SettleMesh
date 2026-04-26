import { getAdminClient, signWebhookPayload } from "@/lib/merchant-auth";

interface CompleteCheckoutInput {
  sessionId: string;
  paymentMethod: "credit" | "mock_fiat" | "fiat";
  payerId?: string | null;
  payerEmail?: string | null;
  payerName?: string | null;
  allowExpired?: boolean;
}

export async function completeCheckoutSession({
  sessionId,
  paymentMethod,
  payerId = null,
  payerEmail = null,
  payerName = null,
  allowExpired = false,
}: CompleteCheckoutInput) {
  const admin = getAdminClient();

  const { data: session } = await admin
    .from("checkout_sessions")
    .select(
      "*, merchants(id, user_id, name, webhook_url, webhook_secret, allow_guest_checkout, guest_checkout_min_credit, mock_fiat_enabled)"
    )
    .eq("id", sessionId)
    .in("status", allowExpired ? ["pending", "expired"] : ["pending"])
    .single();

  if (!session) {
    return { ok: false as const, status: 404, error: "Session not found or already completed" };
  }

  if (session.status === "expired" && !allowExpired) {
    return { ok: false as const, status: 410, error: "Session expired" };
  }

  if (new Date(session.expires_at) < new Date() && !allowExpired) {
    await admin
      .from("checkout_sessions")
      .update({ status: "expired" })
      .eq("id", session.id);

    return { ok: false as const, status: 410, error: "Session expired" };
  }

  const merchant = session.merchants as {
    id: string;
    user_id: string;
    name: string;
    webhook_url: string | null;
    webhook_secret: string;
    allow_guest_checkout?: boolean;
    guest_checkout_min_credit?: number;
    mock_fiat_enabled?: boolean;
  };

  const amount = session.amount_credit;

  const usesWalletBalance = paymentMethod === "credit";

  if (paymentMethod === "mock_fiat" || paymentMethod === "fiat") {
    const guestAllowed =
      merchant.allow_guest_checkout !== false &&
      merchant.mock_fiat_enabled !== false &&
      amount >= (merchant.guest_checkout_min_credit ?? 0);

    if (!guestAllowed) {
      return { ok: false as const, status: 400, error: "Guest checkout is not available for this payment" };
    }
  }

  let creditsRemaining: number | null = null;

  if (usesWalletBalance) {
    if (!payerId) {
      return { ok: false as const, status: 401, error: "Unauthorized" };
    }

    const { data: payerWallet } = await admin
      .from("wallets")
      .select("id, available_credit, total_spent")
      .eq("user_id", payerId)
      .single();

    if (!payerWallet) {
      return { ok: false as const, status: 500, error: "Wallet not found" };
    }

    if (payerWallet.available_credit < amount) {
      return { ok: false as const, status: 400, error: "Insufficient credits" };
    }

    const newPayerBalance = payerWallet.available_credit - amount;
    creditsRemaining = newPayerBalance;

    await admin
      .from("wallets")
      .update({
        available_credit: newPayerBalance,
        total_spent: payerWallet.total_spent + amount,
      })
      .eq("id", payerWallet.id);

    const { data: debitTxn } = await admin
      .from("ledger_transactions")
      .insert({
        type: "purchase",
        reference_type: "checkout_session",
        reference_id: session.id,
        description: `Checkout: ${session.description}`,
        idempotency_key: `checkout_${session.id}_${paymentMethod}`,
      })
      .select()
      .single();

    if (debitTxn) {
      await admin.from("ledger_entries").insert({
        transaction_id: debitTxn.id,
        wallet_id: payerWallet.id,
        entry_type: "debit",
        amount,
        balance_after: newPayerBalance,
        credit_source: "purchased",
      });
    }
  }

  const { data: merchantWallet } = await admin
    .from("wallets")
    .select("id, available_credit, earned_credit, total_earned")
    .eq("user_id", merchant.user_id)
    .single();

  if (!merchantWallet) {
    return { ok: false as const, status: 500, error: "Merchant wallet not found" };
  }

  const newMerchantBalance = merchantWallet.available_credit + amount;

  await admin
    .from("wallets")
    .update({
      available_credit: newMerchantBalance,
      earned_credit: merchantWallet.earned_credit + amount,
      total_earned: merchantWallet.total_earned + amount,
    })
    .eq("id", merchantWallet.id);

  const { data: creditTxn } = await admin
    .from("ledger_transactions")
    .insert({
      type: "earning",
      reference_type: "checkout_session",
      reference_id: session.id,
      description: `Earning from checkout: ${session.description}`,
      idempotency_key: `checkout_${session.id}_${paymentMethod}_earning`,
    })
    .select()
    .single();

  if (creditTxn) {
    await admin.from("ledger_entries").insert({
      transaction_id: creditTxn.id,
      wallet_id: merchantWallet.id,
      entry_type: "credit",
      amount,
      balance_after: newMerchantBalance,
      credit_source: "earned",
    });
  }

  const completedAt = new Date().toISOString();

  await admin
    .from("checkout_sessions")
    .update({
      status: "completed",
      payer_id: payerId,
      payer_email: payerEmail,
      payer_name: payerName,
      payment_method: paymentMethod,
      completed_at: completedAt,
    })
    .eq("id", session.id);

  if (merchant.webhook_url) {
    const webhookPayload = JSON.stringify({
      event: "checkout.completed",
      data: {
        id: session.id,
        external_id: session.external_id,
        amount_credit: amount,
        description: session.description,
        metadata: session.metadata,
        payer_id: payerId,
        payer_email: payerEmail,
        payer_name: payerName,
        payment_method: paymentMethod,
        completed_at: completedAt,
      },
    });

    const signature = signWebhookPayload(webhookPayload, merchant.webhook_secret);

    fetch(merchant.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AnyPay-Signature": signature,
        "X-AnyPay-Timestamp": Date.now().toString(),
      },
      body: webhookPayload,
    }).catch(() => {});
  }

  return {
    ok: true as const,
    session,
    paymentMethod,
    merchantName: merchant.name,
    creditsRemaining,
  };
}

export async function finalizeLinkedCheckoutForTopup(orderId: string) {
  const admin = getAdminClient();

  const { data: order } = await admin
    .from("topup_orders")
    .select("id, user_id, checkout_session_id")
    .eq("id", orderId)
    .single();

  if (!order?.checkout_session_id) {
    return { ok: true as const, skipped: true as const };
  }

  const { data: session } = await admin
    .from("checkout_sessions")
    .select("id, status, payer_email, payer_name")
    .eq("id", order.checkout_session_id)
    .single();

  if (!session) {
    return { ok: false as const, status: 404, error: "Linked checkout session not found" };
  }

  if (session.status === "completed") {
    return { ok: true as const, skipped: true as const, alreadyCompleted: true as const };
  }

  return completeCheckoutSession({
    sessionId: order.checkout_session_id,
    paymentMethod: "credit",
    payerId: order.user_id,
    payerEmail: session.payer_email,
    payerName: session.payer_name,
  });
}

export async function finalizeFiatCheckoutSession(sessionId: string) {
  const admin = getAdminClient();

  const { data: session } = await admin
    .from("checkout_sessions")
    .select("id, status, payer_email, payer_name")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return { ok: false as const, status: 404, error: "Checkout session not found" };
  }

  if (session.status === "completed") {
    return { ok: true as const, skipped: true as const, alreadyCompleted: true as const };
  }

  return completeCheckoutSession({
    sessionId,
    paymentMethod: "fiat",
    payerEmail: session.payer_email,
    payerName: session.payer_name,
    allowExpired: true,
  });
}
