import crypto from "crypto";

const DEFAULT_GATEWAY_URL = "https://api.xunhupay.com/payment/do.html";
const DEFAULT_QUERY_URL = "https://api.xunhupay.com/payment/query.html";

type CreatePaymentInput = {
  tradeOrderId: string;
  totalFee: number | string;
  title: string;
  notifyUrl: string;
  returnUrl: string;
};

type QueryPaymentInput = {
  tradeOrderId?: string;
  openOrderId?: string;
};

function getFirstEnvValue(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  return null;
}

function getRequiredEnvValue(names: string[]): string {
  const value = getFirstEnvValue(names);
  if (!value) {
    throw new Error(`Missing environment variable: ${names.join(" or ")}`);
  }

  return value;
}

function buildHashSource(payload: Record<string, unknown>): string {
  return Object.keys(payload)
    .sort((a, b) => a.localeCompare(b))
    .filter((key) => {
      const value = payload[key];
      if (key === "hash" || key === "sign") return false;
      if (value === null || value === undefined || value === "") return false;
      // Skip non-scalar values (objects, arrays) — they don't participate in XunhuPay signatures
      if (typeof value === "object") return false;
      return true;
    })
    .map((key) => `${key}=${String(payload[key])}`)
    .join("&");
}

function parseJsonResponse(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function hasXunhuSignature(payload: Record<string, unknown>): boolean {
  return typeof payload.hash === "string" || typeof payload.sign === "string";
}

function createNonce(): string {
  return String(crypto.randomInt(1000000000, 9999999999));
}

function formatTotalFee(value: number | string): string {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid total fee");
  }

  return amount.toFixed(2);
}

export function getXunhuConfig() {
  return {
    appId: getRequiredEnvValue(["XUNHUPAY_APP_ID", "HPP_APP_ID"]),
    secret: getRequiredEnvValue(["XUNHUPAY_APP_SECRET", "HPP_SECRET"]),
    gatewayUrl: getFirstEnvValue(["XUNHUPAY_GATEWAY_URL", "HPP_CALLBACK_URL"]) ?? DEFAULT_GATEWAY_URL,
    queryUrl: getFirstEnvValue(["XUNHUPAY_QUERY_URL"]) ?? DEFAULT_QUERY_URL,
    wapName: getFirstEnvValue(["XUNHUPAY_WAP_NAME"]) ?? "AnyPay",
    callbackUrl: getFirstEnvValue(["XUNHUPAY_CALLBACK_URL"]) ?? "",
  };
}

export function signXunhuPayload(payload: Record<string, unknown>, secret?: string): string {
  const resolvedSecret = secret ?? getXunhuConfig().secret;
  const source = buildHashSource(payload);
  return crypto.createHash("md5").update(source + resolvedSecret).digest("hex");
}

export function verifyXunhuPayload(payload: Record<string, unknown>, secret?: string): boolean {
  const signature = payload.hash ?? payload.sign;
  if (typeof signature !== "string" || !signature) {
    return false;
  }

  return signXunhuPayload(payload, secret) === signature;
}

export async function createXunhuPayment(input: CreatePaymentInput) {
  const config = getXunhuConfig();

  const payload: Record<string, string> = {
    version: "1.1",
    trade_order_id: input.tradeOrderId,
    total_fee: formatTotalFee(input.totalFee),
    title: input.title,
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
    wap_name: config.wapName,
    callback_url: config.callbackUrl,
    time: String(Math.floor(Date.now() / 1000)),
    nonce_str: createNonce(),
    appid: config.appId,
  };

  payload.hash = signXunhuPayload(payload, config.secret);

  const response = await fetch(config.gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  const data = parseJsonResponse(responseText);

  if (!verifyXunhuPayload(data, config.secret)) {
    throw new Error("Invalid XunhuPay response signature");
  }

  if (!response.ok || Number(data.errcode ?? 500) !== 0) {
    throw new Error(String(data.errmsg ?? "Failed to create XunhuPay payment"));
  }

  const paymentUrl = typeof data.url === "string" ? data.url : typeof data.pay_url === "string" ? data.pay_url : null;
  if (!paymentUrl) {
    throw new Error("Missing XunhuPay payment URL");
  }

  const providerOrderId =
    data.open_order_id != null
      ? String(data.open_order_id)
      : data.openid != null
        ? String(data.openid)
        : null;

  return {
    paymentUrl,
    providerOrderId,
    raw: data,
  };
}

export async function queryXunhuPayment(input: QueryPaymentInput) {
  const config = getXunhuConfig();

  const payload: Record<string, string> = {
    time: String(Math.floor(Date.now() / 1000)),
    nonce_str: createNonce(),
    appid: config.appId,
  };

  if (input.tradeOrderId) {
    payload.out_trade_order = input.tradeOrderId;
  }

  if (input.openOrderId) {
    payload.open_order_id = input.openOrderId;
  }

  if (!payload.out_trade_order && !payload.open_order_id) {
    throw new Error("Missing XunhuPay query identifier");
  }

  payload.hash = signXunhuPayload(payload, config.secret);

  const response = await fetch(config.queryUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  const data = parseJsonResponse(responseText);

  if (hasXunhuSignature(data) && !verifyXunhuPayload(data, config.secret)) {
    throw new Error("Invalid XunhuPay query signature");
  }

  if (!response.ok || Number(data.errcode ?? 500) !== 0) {
    throw new Error(String(data.errmsg ?? "Failed to query XunhuPay payment"));
  }

  const rawData = (data.data ?? {}) as Record<string, unknown>;

  return {
    status: typeof rawData.status === "string" ? rawData.status : null,
    providerOrderId:
      rawData.open_order_id != null
        ? String(rawData.open_order_id)
        : rawData.transaction_id != null
          ? String(rawData.transaction_id)
          : null,
    raw: data,
  };
}

export function formDataToObject(formData: FormData): Record<string, string> {
  return Array.from(formData.entries()).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string") {
      acc[key] = value;
    }
    return acc;
  }, {});
}
