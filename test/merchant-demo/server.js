import { createServer } from "http";
import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "public", "index.html");
const envPath = path.join(__dirname, ".env");

function loadEnv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, "utf8");
  const env = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

const env = {
  ...loadEnv(envPath),
  ...process.env,
};

const port = Number(env.PORT || 4020);
const appUrl = env.MERCHANT_APP_URL || `http://127.0.0.1:${port}`;
const anypayBaseUrl =
  env.SETTLEMESH_BASE_URL || env.ANYPAY_BASE_URL || "https://www.settlemesh.io";
const merchantApiKey = env.SETTLEMESH_API_KEY || env.ANYPAY_API_KEY || "";
const webhookSecret =
  env.SETTLEMESH_WEBHOOK_SECRET || env.ANYPAY_WEBHOOK_SECRET || "";
const defaultAmountCredit = Number(env.DEFAULT_CHECKOUT_AMOUNT_CREDIT || 50);

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function getSignaturePayload(rawBody, timestamp) {
  return timestamp ? `${timestamp}.${rawBody}` : rawBody;
}

function verifyWebhookSignature(rawBody, headers) {
  if (!webhookSecret) {
    return { configured: false, valid: true };
  }

  const timestamp = headers["x-anypay-timestamp"];
  const signature = headers["x-anypay-signature"];
  if (!timestamp || !signature) {
    return { configured: true, valid: false };
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(getSignaturePayload(rawBody, String(timestamp)))
    .digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(signature));
  const valid =
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

  return { configured: true, valid };
}

function getCheckoutPayload(body) {
  const amount = Number(body.amount ?? defaultAmountCredit);
  const description = typeof body.description === "string" && body.description.trim()
    ? body.description.trim()
    : "Starter Pack";
  const externalId = `demo_${Date.now()}`;

  return {
    amount,
    description,
    external_id: externalId,
    return_url: `${appUrl}/success?external_id=${encodeURIComponent(externalId)}`,
    cancel_url: `${appUrl}/cancel?external_id=${encodeURIComponent(externalId)}`,
    metadata: {
      source: "merchant-demo",
      product: body.product_id ?? "starter-pack",
      demo_order_id: externalId,
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", appUrl);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/success" || url.pathname === "/cancel")) {
    try {
      const html = await readFile(indexPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Failed to load page");
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "merchant-demo",
      configured: Boolean(anypayBaseUrl && merchantApiKey),
      settlemesh_base_url: anypayBaseUrl,
      webhook_signature_verification: Boolean(webhookSecret),
      default_amount_credit: defaultAmountCredit,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/checkout/status") {
    const checkoutId = url.searchParams.get("id");
    if (!checkoutId) {
      sendJson(res, 400, { error: "Missing checkout id" });
      return;
    }

    if (!merchantApiKey) {
      sendJson(res, 500, { error: "Missing SETTLEMESH_API_KEY in merchant-demo .env" });
      return;
    }

    try {
      const response = await fetch(`${anypayBaseUrl}/api/v1/checkout/${checkoutId}`, {
        headers: {
          authorization: `Bearer ${merchantApiKey}`,
        },
      });
      const text = await response.text();
      sendJson(res, response.status, text ? JSON.parse(text) : null);
      return;
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error",
      });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/checkout") {
    if (!merchantApiKey) {
      sendJson(res, 500, { error: "Missing SETTLEMESH_API_KEY in merchant-demo .env" });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const payload = getCheckoutPayload(body);
      const response = await fetch(`${anypayBaseUrl}/api/v1/checkout/create`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${merchantApiKey}`,
          "content-type": "application/json",
          "idempotency-key": payload.external_id,
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      const responsePayload = text ? JSON.parse(text) : null;

      if (!response.ok || !responsePayload?.url) {
        sendJson(res, response.status || 502, {
          error: responsePayload?.error || "Failed to create checkout session",
        });
        return;
      }

      sendJson(res, 200, {
        success: true,
        checkout_id: responsePayload.id,
        checkout_url: responsePayload.url,
        external_id: payload.external_id,
        payment_methods: responsePayload.payment_methods,
      });
      return;
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error",
      });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    const verification = verifyWebhookSignature(rawBody, req.headers);
    if (!verification.valid) {
      sendJson(res, 401, { error: "Invalid webhook signature" });
      return;
    }

    let event = null;
    try {
      event = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      sendJson(res, 400, { error: "Invalid webhook JSON" });
      return;
    }

    console.log("received SettleMesh webhook", {
      signatureVerified: verification.configured,
      event: event?.event,
      checkoutId: event?.data?.id,
      externalId: event?.data?.external_id,
      amountCredit: event?.data?.amount_credit,
      paymentMethod: event?.data?.payment_method,
    });

    sendJson(res, 200, { received: true });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`merchant-demo running at http://127.0.0.1:${port}`);
});
