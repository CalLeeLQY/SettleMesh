export type MerchantCheckoutSettings = {
  allow_guest_checkout?: boolean | null;
  guest_checkout_min_credit?: number | null;
  mock_fiat_enabled?: boolean | null;
} | null;

export function isMockFiatCheckoutEnabled() {
  if (process.env.ENABLE_MOCK_FIAT_CHECKOUT === "true") {
    return true;
  }

  if (process.env.ENABLE_MOCK_FIAT_CHECKOUT === "false") {
    return false;
  }

  return process.env.NODE_ENV === "development" && !process.env.VERCEL_ENV;
}

export function canUseGuestFiatCheckout(
  merchant: MerchantCheckoutSettings,
  amountCredit: number
) {
  return (
    Boolean(merchant) &&
    merchant?.allow_guest_checkout !== false &&
    amountCredit >= (merchant?.guest_checkout_min_credit ?? 0)
  );
}

export function canUseMockFiatCheckout(
  merchant: MerchantCheckoutSettings,
  amountCredit: number
) {
  return (
    canUseGuestFiatCheckout(merchant, amountCredit) &&
    merchant?.mock_fiat_enabled !== false &&
    isMockFiatCheckoutEnabled()
  );
}

export function getCheckoutPaymentOptions(
  merchant: MerchantCheckoutSettings,
  amountCredit: number
) {
  return {
    credit: true,
    fiat: canUseGuestFiatCheckout(merchant, amountCredit),
    mock_fiat: canUseMockFiatCheckout(merchant, amountCredit),
  };
}
