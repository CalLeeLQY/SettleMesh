import crypto from "crypto";
import http from "http";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(repoRoot, ".env.local");

function loadEnv(filePath) {
  const env = {};
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    env[key] = value;
  }

  return env;
}

const env = {
  ...loadEnv(envPath),
  ...process.env,
};

const BASE_URL = env.ANYPAY_BASE_URL || "http://localhost:3000";
const WEBHOOK_PORT = Number(env.WEBHOOK_PORT || 4010);
const REPORT_DIR = path.resolve(__dirname, env.REPORT_DIR || "reports");

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

function makeResultRecorder() {
  const results = [];

  function record(name, ok, details = "", extra = {}) {
    results.push({
      name,
      ok,
      details,
      ...extra,
    });

    const prefix = ok ? "PASS" : "FAIL";
    const suffix = details ? ` :: ${details}` : "";
    console.log(`${prefix} ${name}${suffix}`);
  }

  return { results, record };
}

function createSession(email, password) {
  const jar = [];
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return jar;
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            const entry = { name: cookie.name, value: cookie.value };
            const existing = jar.findIndex((item) => item.name === cookie.name);
            if (existing >= 0) {
              jar[existing] = entry;
            } else {
              jar.push(entry);
            }
          }
        },
      },
    }
  );

  return {
    async signIn() {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    cookieHeader() {
      return jar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    },
    async fetch(appPath, options = {}) {
      const headers = new Headers(options.headers || {});
      const cookie = this.cookieHeader();

      if (cookie) headers.set("cookie", cookie);

      return fetch(`${BASE_URL}${appPath}`, {
        ...options,
        headers,
        redirect: options.redirect || "manual",
      });
    },
  };
}

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

async function createUser(label) {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `codex_${label}_${stamp}@example.com`;
  const password = "Test123456!";
  const username = `${label}_${stamp.slice(-6)}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });

  if (error) throw error;

  return {
    id: data.user.id,
    email,
    password,
    username,
  };
}

async function getWallet(userId) {
  const { data, error } = await admin
    .from("wallets")
    .select("id, available_credit, purchased_credit, earned_credit, total_spent, total_earned")
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data;
}

async function createAuthedBrowserClient(email, password) {
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  return client;
}

function startWebhookServer(port) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      hits.push({
        url: req.url,
        headers: req.headers,
        body,
      });

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  return {
    hits,
    async listen() {
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    },
    close() {
      server.close();
    },
  };
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  const { results, record } = makeResultRecorder();
  const webhook = startWebhookServer(WEBHOOK_PORT);
  const artifacts = {
    baseUrl: BASE_URL,
    createdUsers: [],
    checkoutIds: [],
    merchantId: null,
  };

  await webhook.listen();

  try {
    const userA = await createUser("buyer");
    const userB = await createUser("seller");
    artifacts.createdUsers.push(userA.id, userB.id);

    const walletA0 = await getWallet(userA.id);
    const walletB0 = await getWallet(userB.id);
    record("T01 register creates wallet for user A", !!walletA0, `wallet=${walletA0.available_credit}`);
    record("T01 register creates wallet for user B", !!walletB0, `wallet=${walletB0.available_credit}`);

    const sessionA = createSession(userA.email, userA.password);
    const sessionB = createSession(userB.email, userB.password);
    await sessionA.signIn();
    await sessionB.signIn();

    const anonDashboard = await fetch(`${BASE_URL}/dashboard`, { redirect: "manual" });
    record(
      "T02 protected dashboard redirects when logged out",
      anonDashboard.status >= 300 && anonDashboard.status < 400,
      `status=${anonDashboard.status} location=${anonDashboard.headers.get("location")}`
    );

    const authedDashboard = await sessionA.fetch("/dashboard");
    record("T02 protected dashboard loads when logged in", authedDashboard.status === 200, `status=${authedDashboard.status}`);

    const { data: topupPackages, error: topupPackagesError } = await admin
      .from("topup_packages")
      .select("id, label, credit_amount, bonus_credit")
      .eq("is_active", true)
      .order("sort_order");

    if (topupPackagesError) throw topupPackagesError;
    if (!topupPackages?.length) throw new Error("No active topup_packages found");

    const starterPackage = topupPackages[0];
    const largePackage = topupPackages[2] || topupPackages[topupPackages.length - 1];

    const beforeTopup = await getWallet(userA.id);
    const topupResponse = await sessionA.fetch("/api/topup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package_id: starterPackage.id }),
    });
    const topupPayload = await parseJsonSafe(topupResponse);
    const afterTopup = await getWallet(userA.id);
    const starterCredits = starterPackage.credit_amount + starterPackage.bonus_credit;

    const { data: topupOrder } = await admin
      .from("topup_orders")
      .select("status, payment_method, credit_amount")
      .eq("user_id", userA.id)
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    record("T03 mock topup endpoint succeeds", topupResponse.status === 200 && topupPayload.json?.success === true, `status=${topupResponse.status}`);
    record("T03 topup increases available credits", afterTopup.available_credit - beforeTopup.available_credit === starterCredits, `delta=${afterTopup.available_credit - beforeTopup.available_credit}`);
    record("T03 topup order is created", !!topupOrder && topupOrder.status === "completed", `payment_method=${topupOrder?.payment_method}`);

    const browserA = await createAuthedBrowserClient(userA.email, userA.password);
    const browserB = await createAuthedBrowserClient(userB.email, userB.password);

    const { data: productB, error: productBError } = await browserB
      .from("products")
      .insert({
        seller_id: userB.id,
        title: `Smoke Product ${Date.now()}`,
        description: "Product used by the payment smoke tests",
        price_credit: 50,
        product_type: "downloadable",
        delivery_method: "instant_download",
        status: "active",
      })
      .select()
      .single();

    record("T04 seller can publish a product", !!productB && !productBError, productBError ? productBError.message : `product=${productB.id}`);

    const buyerBeforePurchase = await getWallet(userA.id);
    const sellerBeforeSale = await getWallet(userB.id);

    const purchaseResponse = await sessionA.fetch("/api/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: productB.id }),
    });
    const purchasePayload = await parseJsonSafe(purchaseResponse);
    const buyerAfterPurchase = await getWallet(userA.id);
    const sellerAfterSale = await getWallet(userB.id);

    const { data: orderRow } = await admin
      .from("orders")
      .select("id, seller_earning_credit")
      .eq("id", purchasePayload.json?.order_id || "")
      .maybeSingle();

    const { data: productBAfter } = await admin
      .from("products")
      .select("sales_count")
      .eq("id", productB.id)
      .single();

    record("T05 buyer can purchase a listed product", purchaseResponse.status === 200 && purchasePayload.json?.success === true, `status=${purchaseResponse.status}`);
    record("T05 buyer balance decreases", buyerBeforePurchase.available_credit - buyerAfterPurchase.available_credit === 50, `delta=${buyerBeforePurchase.available_credit - buyerAfterPurchase.available_credit}`);
    record("T05 seller balance increases", !!orderRow && sellerAfterSale.available_credit - sellerBeforeSale.available_credit === orderRow.seller_earning_credit, `delta=${sellerAfterSale.available_credit - sellerBeforeSale.available_credit}`);
    record("T05 sales count increments", (productBAfter.sales_count || 0) >= 1, `sales=${productBAfter.sales_count}`);

    const { data: merchant, error: merchantError } = await browserB
      .from("merchants")
      .insert({
        user_id: userB.id,
        name: `Smoke Merchant ${Date.now()}`,
        website_url: BASE_URL,
        webhook_url: `http://127.0.0.1:${WEBHOOK_PORT}/webhook`,
      })
      .select()
      .single();

    artifacts.merchantId = merchant?.id || null;
    record("T06 user can register as merchant", !!merchant && !merchantError, merchantError ? merchantError.message : `merchant=${merchant.id}`);

    const keyResponse = await sessionB.fetch("/api/v1/merchant/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merchant_id: merchant.id }),
    });
    const keyPayload = await parseJsonSafe(keyResponse);
    const apiKey = keyPayload.json?.api_key;

    record("T07 merchant can create API key", keyResponse.status === 200 && typeof apiKey === "string" && apiKey.startsWith("sk_live_"), `status=${keyResponse.status}`);

    const settingsUpdate = await browserB
      .from("merchants")
      .update({
        allow_guest_checkout: true,
        mock_fiat_enabled: true,
        guest_checkout_min_credit: 100,
      })
      .eq("id", merchant.id)
      .select()
      .single();

    record(
      "T08 merchant guest checkout settings persist",
      !settingsUpdate.error && settingsUpdate.data.guest_checkout_min_credit === 100,
      settingsUpdate.error ? settingsUpdate.error.message : `min=${settingsUpdate.data.guest_checkout_min_credit}`
    );

    const walletBeforeCreditCheckout = await getWallet(userA.id);
    if (walletBeforeCreditCheckout.available_credit < 100) {
      const topupForCreditCheckout = await sessionA.fetch("/api/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ package_id: starterPackage.id }),
      });
      const topupForCreditPayload = await parseJsonSafe(topupForCreditCheckout);
      record(
        "T10 setup ensures buyer has enough balance",
        topupForCreditCheckout.status === 200 && topupForCreditPayload.json?.success === true,
        `status=${topupForCreditCheckout.status}`
      );
    }

    const checkoutResponse = await fetch(`${BASE_URL}/api/v1/checkout/create`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: 100,
        description: "Smoke Checkout",
        return_url: `${BASE_URL}/test-success`,
        cancel_url: `${BASE_URL}/test-cancel`,
        external_id: "smoke_credit_001",
        metadata: { source: "payment-smoke" },
      }),
    });
    const checkoutPayload = await parseJsonSafe(checkoutResponse);
    const creditCheckoutId = checkoutPayload.json?.id;
    artifacts.checkoutIds.push(creditCheckoutId);

    record(
      "T09 merchant can create checkout session",
      checkoutResponse.status === 200 && !!creditCheckoutId && checkoutPayload.json?.payment_methods?.mock_fiat === true,
      `status=${checkoutResponse.status}`
    );

    const buyerBeforeHosted = await getWallet(userA.id);
    const sellerBeforeHosted = await getWallet(userB.id);
    const hostedConfirm = await sessionA.fetch("/api/v1/checkout/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: creditCheckoutId }),
    });
    const hostedConfirmPayload = await parseJsonSafe(hostedConfirm);
    const buyerAfterHosted = await getWallet(userA.id);
    const sellerAfterHosted = await getWallet(userB.id);

    const { data: creditSession } = await admin
      .from("checkout_sessions")
      .select("status, payment_method, payer_id")
      .eq("id", creditCheckoutId)
      .single();

    record("T10 logged-in user can complete credit checkout", hostedConfirm.status === 200 && hostedConfirmPayload.json?.success === true, `status=${hostedConfirm.status}`);
    record("T10 checkout is marked completed", creditSession.status === "completed" && creditSession.payment_method === "credit" && creditSession.payer_id === userA.id, `method=${creditSession.payment_method}`);
    record("T10 buyer wallet is debited", buyerBeforeHosted.available_credit - buyerAfterHosted.available_credit === 100, `delta=${buyerBeforeHosted.available_credit - buyerAfterHosted.available_credit}`);
    record("T10 merchant wallet is credited", sellerAfterHosted.available_credit - sellerBeforeHosted.available_credit === 95, `delta=${sellerAfterHosted.available_credit - sellerBeforeHosted.available_credit}`);

    const bigCheckoutResponse = await fetch(`${BASE_URL}/api/v1/checkout/create`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: 1000,
        description: "Large Smoke Checkout",
        return_url: `${BASE_URL}/test-success`,
        cancel_url: `${BASE_URL}/test-cancel`,
      }),
    });
    const bigCheckoutPayload = await parseJsonSafe(bigCheckoutResponse);
    const bigCheckoutId = bigCheckoutPayload.json?.id;
    artifacts.checkoutIds.push(bigCheckoutId);

    const bigCheckoutPage = await sessionA.fetch(`/checkout/${bigCheckoutId}`);
    const bigCheckoutHtml = await bigCheckoutPage.text();
    record("T11 insufficient-balance checkout shows top-up path", bigCheckoutPage.status === 200 && bigCheckoutHtml.includes("Top up credits"), `status=${bigCheckoutPage.status}`);

    const topupAgainResponse = await sessionA.fetch("/api/topup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package_id: largePackage.id }),
    });
    const topupAgainPayload = await parseJsonSafe(topupAgainResponse);

    const confirmAfterTopup = await sessionA.fetch("/api/v1/checkout/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: bigCheckoutId }),
    });
    const confirmAfterTopupPayload = await parseJsonSafe(confirmAfterTopup);

    record(
      "T11 user can top up and then complete checkout",
      topupAgainResponse.status === 200 &&
        topupAgainPayload.json?.success === true &&
        confirmAfterTopup.status === 200 &&
        confirmAfterTopupPayload.json?.success === true,
      `topup=${topupAgainResponse.status} confirm=${confirmAfterTopup.status}`
    );

    const guestCheckoutResponse = await fetch(`${BASE_URL}/api/v1/checkout/create`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: 120,
        description: "Guest Smoke Checkout",
        return_url: `${BASE_URL}/test-success`,
        cancel_url: `${BASE_URL}/test-cancel`,
        external_id: "smoke_guest_001",
        metadata: { source: "payment-smoke-guest" },
      }),
    });
    const guestCheckoutPayload = await parseJsonSafe(guestCheckoutResponse);
    const guestCheckoutId = guestCheckoutPayload.json?.id;
    artifacts.checkoutIds.push(guestCheckoutId);

    const guestCheckoutPage = await fetch(`${BASE_URL}/checkout/${guestCheckoutId}`);
    const guestCheckoutHtml = await guestCheckoutPage.text();
    record("T12 guest checkout page is available", guestCheckoutPage.status === 200 && guestCheckoutHtml.includes("Guest checkout"), `status=${guestCheckoutPage.status}`);

    const sellerBeforeGuest = await getWallet(userB.id);
    const guestPayResponse = await fetch(`${BASE_URL}/api/v1/checkout/mock-fiat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: guestCheckoutId,
        payer_email: "guest@example.com",
        payer_name: "Smoke Guest",
      }),
    });
    const guestPayPayload = await parseJsonSafe(guestPayResponse);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sellerAfterGuest = await getWallet(userB.id);

    const { data: guestSession } = await admin
      .from("checkout_sessions")
      .select("status, payment_method, payer_email")
      .eq("id", guestCheckoutId)
      .single();

    record("T12 guest mock-fiat payment succeeds", guestPayResponse.status === 200 && guestPayPayload.json?.success === true, `status=${guestPayResponse.status}`);
    record("T12 guest payer info is stored", guestSession.status === "completed" && guestSession.payment_method === "mock_fiat" && guestSession.payer_email === "guest@example.com", `method=${guestSession.payment_method}`);
    record("T12 merchant receives guest payment earnings", sellerAfterGuest.available_credit - sellerBeforeGuest.available_credit === 114, `delta=${sellerAfterGuest.available_credit - sellerBeforeGuest.available_credit}`);

    const queryResponse = await fetch(`${BASE_URL}/api/v1/checkout/${guestCheckoutId}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    const queryPayload = await parseJsonSafe(queryResponse);

    record("T13 merchant can query checkout status", queryResponse.status === 200 && queryPayload.json?.status === "completed" && queryPayload.json?.payment_method === "mock_fiat", `status=${queryPayload.json?.status}`);

    const { data: merchantRow } = await admin
      .from("merchants")
      .select("webhook_secret")
      .eq("id", merchant.id)
      .single();

    const webhookHit = webhook.hits.find((hit) => hit.body.includes(guestCheckoutId));
    const expectedSignature = webhookHit
      ? crypto.createHmac("sha256", merchantRow.webhook_secret).update(webhookHit.body).digest("hex")
      : null;

    record("T14 webhook is delivered", !!webhookHit, webhookHit ? "received" : "missing");
    record(
      "T14 webhook signature is valid",
      !!webhookHit && webhookHit.headers["x-anypay-signature"] === expectedSignature,
      webhookHit ? "validated" : "no webhook"
    );

    const sellerAfterIncome = await getWallet(userB.id);
    record("T15 merchant earned_credit increases", sellerAfterIncome.earned_credit > walletB0.earned_credit, `earned=${sellerAfterIncome.earned_credit}`);

    const { data: productA, error: productAError } = await browserA
      .from("products")
      .insert({
        seller_id: userA.id,
        title: `Earned Credit Target ${Date.now()}`,
        description: "Product used to verify earned-credit reuse",
        price_credit: 40,
        product_type: "downloadable",
        delivery_method: "instant_download",
        status: "active",
      })
      .select()
      .single();

    record("T16 setup seller A product for earned-credit reuse", !!productA && !productAError, productAError ? productAError.message : `product=${productA.id}`);

    const sellerBeforeReuse = await getWallet(userB.id);
    const reuseResponse = await sessionB.fetch("/api/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: productA.id }),
    });
    const reusePayload = await parseJsonSafe(reuseResponse);
    const sellerAfterReuse = await getWallet(userB.id);

    record(
      "T16 merchant can spend earned credits",
      reuseResponse.status === 200 &&
        reusePayload.json?.success === true &&
        sellerBeforeReuse.available_credit - sellerAfterReuse.available_credit === 40,
      `status=${reuseResponse.status}`
    );

    const invalidSessionPage = await fetch(`${BASE_URL}/checkout/does-not-exist`);
    const invalidSessionHtml = await invalidSessionPage.text();
    record("T17 invalid session page is handled", invalidSessionPage.status === 200 && invalidSessionHtml.includes("Checkout session not found"), `status=${invalidSessionPage.status}`);

    const expiredCheckoutResponse = await fetch(`${BASE_URL}/api/v1/checkout/create`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: 80,
        description: "Expired Smoke Checkout",
        return_url: `${BASE_URL}/test-success`,
        cancel_url: `${BASE_URL}/test-cancel`,
      }),
    });
    const expiredCheckoutPayload = await parseJsonSafe(expiredCheckoutResponse);
    const expiredCheckoutId = expiredCheckoutPayload.json?.id;
    artifacts.checkoutIds.push(expiredCheckoutId);

    await admin
      .from("checkout_sessions")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", expiredCheckoutId);

    const expiredPage = await fetch(`${BASE_URL}/checkout/${expiredCheckoutId}`);
    const expiredPageHtml = await expiredPage.text();
    const expiredConfirm = await sessionA.fetch("/api/v1/checkout/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: expiredCheckoutId }),
    });
    const expiredConfirmPayload = await parseJsonSafe(expiredConfirm);

    record("T17 expired session page is handled", expiredPage.status === 200 && expiredPageHtml.includes("Session Expired"), `status=${expiredPage.status}`);
    record("T17 expired session cannot be paid", expiredConfirm.status === 410 && /expired/i.test(expiredConfirmPayload.json?.error || expiredConfirmPayload.text), `status=${expiredConfirm.status}`);

    const badCreate = await fetch(`${BASE_URL}/api/v1/checkout/create`, {
      method: "POST",
      headers: {
        authorization: "Bearer sk_live_invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: 10, description: "bad key test" }),
    });
    const badQuery = await fetch(`${BASE_URL}/api/v1/checkout/${guestCheckoutId}`, {
      headers: {
        authorization: "Bearer sk_live_invalid",
      },
    });
    const missingAuth = await fetch(`${BASE_URL}/api/v1/checkout/${guestCheckoutId}`);

    record("T18 invalid API key is rejected on create", badCreate.status === 401, `status=${badCreate.status}`);
    record("T18 invalid API key is rejected on query", badQuery.status === 401, `status=${badQuery.status}`);
    record("T18 missing Authorization header is rejected", missingAuth.status === 401, `status=${missingAuth.status}`);
  } finally {
    webhook.close();
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      passed,
      failed,
      total: results.length,
    },
    artifacts,
    results,
  };

  const reportName = `payment-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const reportPath = path.join(REPORT_DIR, reportName);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log("");
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  console.log(`REPORT ${reportPath}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
