import { createServer } from "http";
import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
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
const anypayBaseUrl = env.ANYPAY_BASE_URL || "http://127.0.0.1:3000";
const merchantApiKey = env.ANYPAY_API_KEY || "";

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

function getCheckoutPayload(body) {
  const amount = Number(body.amount ?? 10);
  const description = typeof body.description === "string" && body.description.trim()
    ? body.description.trim()
    : "Starter Pack";
  const externalId = `demo_${Date.now()}`;

  return {
    amount,
    description,
    external_id: externalId,
    return_url: `${appUrl}/success`,
    cancel_url: `${appUrl}/cancel`,
    metadata: {
      source: "merchant-demo",
      product: body.product_id ?? "starter-pack",
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
      anypay_base_url: anypayBaseUrl,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/checkout") {
    if (!merchantApiKey) {
      sendJson(res, 500, { error: "Missing ANYPAY_API_KEY in merchant-demo .env" });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const response = await fetch(`${anypayBaseUrl}/api/v1/checkout/create`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${merchantApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(getCheckoutPayload(body)),
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;

      if (!response.ok || !payload?.url) {
        sendJson(res, response.status || 502, {
          error: payload?.error || "Failed to create checkout session",
        });
        return;
      }

      sendJson(res, 200, {
        success: true,
        checkout_id: payload.id,
        checkout_url: payload.url,
      });
      return;
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error",
      });
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`merchant-demo running at http://127.0.0.1:${port}`);
});
