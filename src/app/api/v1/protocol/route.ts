import { NextResponse } from "next/server";
import {
  CREDIT_ASSET,
  CREDIT_TO_USD_RATE,
  PAYMENT_PROTOCOL_VERSION,
  getRequestBaseUrl,
} from "@/lib/protocol";

export async function GET(request: Request) {
  const baseUrl = getRequestBaseUrl(request);

  return NextResponse.json({
    version: PAYMENT_PROTOCOL_VERSION,
    name: "SettleMesh Credit Payment Protocol",
    asset: CREDIT_ASSET,
    settlement_asset: CREDIT_ASSET,
    credit_to_usd_rate: CREDIT_TO_USD_RATE,
    capabilities: {
      hosted_checkout: true,
      credit_balance_payment: true,
      guest_fiat_payment: true,
      stripe_checkout: true,
      mock_fiat_checkout: true,
      merchant_webhooks: true,
      idempotent_checkout_create: true,
    },
    endpoints: {
      create_checkout: new URL("/api/v1/checkout/create", baseUrl).toString(),
      query_checkout: new URL("/api/v1/checkout/{id}", baseUrl).toString(),
      hosted_checkout: new URL("/checkout/{id}", baseUrl).toString(),
      credit_confirm: new URL("/api/v1/checkout/confirm", baseUrl).toString(),
      fiat_start: new URL("/api/v1/checkout/fiat", baseUrl).toString(),
      fiat_status: new URL("/api/v1/checkout/fiat/status", baseUrl).toString(),
      mock_fiat: new URL("/api/v1/checkout/mock-fiat", baseUrl).toString(),
    },
    webhook_signature: {
      version: "v1",
      algorithm: "hmac-sha256",
      signed_payload: "{X-AnyPay-Timestamp}.{raw_body}",
      headers: [
        "X-AnyPay-Signature",
        "X-AnyPay-Signature-Version",
        "X-AnyPay-Timestamp",
      ],
    },
  });
}
