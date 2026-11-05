/**
 * Scripted end-to-end run in mock mode:
 *   checkout started -> PayPal order created -> popup closed -> abandonment confirmed
 *   -> agent WhatsApp message (console channel) -> shopper objects -> Pay Later offer
 *   -> shopper approves on PayPal -> webhook -> cart recovered.
 *
 * Uses the running server (pnpm dev:mock) at HOLLABACK_API_URL (default http://localhost:4000).
 * If none is running it boots one in-process with MOCK_PAYPAL=1.
 */

const API = (process.env.HOLLABACK_API_URL || "http://localhost:4000").replace(/\/$/, "");
const DASHBOARD = (process.env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, "");

const ESC = String.fromCharCode(27);
const paint = (code: string) => (s: string) => (process.stdout.isTTY ? `${ESC}[${code}m${s}${ESC}[0m` : s);
const c = {
  dim: paint("2"),
  bold: paint("1"),
  green: paint("32"),
  cyan: paint("36"),
  yellow: paint("33"),
  red: paint("31"),
};

let step = 0;
const say = (title: string, detail?: string) => {
  step += 1;
  console.log(`\n${c.bold(`${step}.`)} ${c.bold(title)}${detail ? `\n   ${c.dim(detail)}` : ""}`);
};
const bubble = (who: "agent" | "shopper", text: string) => {
  const tag = who === "agent" ? c.cyan("Agent  >") : c.yellow("Shopper>");
  text.split("\n").forEach((line, i) => console.log(`   ${i === 0 ? tag : "        "} ${line}`));
};

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data.error ?? data)}`);
  return data;
}

interface Detail {
  cart: { status: string; recoveredAmount: number | null; orderStatus: string | null; abandonReason: string | null };
  conversations: Array<{
    outcome: string | null;
    messages: Array<{ role: string; body: string; toolCall: { name: string; source: string; ok: boolean } | null }>;
  }>;
  webhooks: Array<{ eventType: string; verified: boolean }>;
}

async function waitFor(cartId: string, label: string, pred: (d: Detail) => boolean, timeoutMs: number): Promise<Detail> {
  const start = Date.now();
  let progress = false;
  while (Date.now() - start < timeoutMs) {
    const d = await call<Detail>("GET", `/api/carts/${cartId}`);
    if (pred(d)) {
      if (progress) process.stdout.write("\n");
      return d;
    }
    if (process.stdout.isTTY) {
      process.stdout.write(`\r   ${c.dim(`${label} ${Math.round((Date.now() - start) / 1000)}s`)}`);
      progress = true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const agentMessages = (d: Detail) => d.conversations.flatMap((cv) => cv.messages).filter((m) => m.role === "agent");

function isConnectionError(err: unknown): boolean {
  const text = `${(err as Error)?.message ?? ""} ${String((err as { cause?: unknown })?.cause ?? "")}`;
  return /fetch failed|ECONNREFUSED|ECONNRESET/i.test(text);
}

async function ensureServer(): Promise<{ app?: { close(): Promise<unknown> }; graceMs: number }> {
  try {
    const health = await call<{ mockPaypal: boolean; channel: string }>("GET", "/health");
    if (!health.mockPaypal) {
      throw new Error(`The server at ${API} is using the real PayPal sandbox. demo:mock needs MOCK_PAYPAL=1 (run pnpm dev:mock).`);
    }
    if (health.channel !== "console") {
      throw new Error(`The server at ${API} uses the ${health.channel} channel; demo:mock needs the console channel.`);
    }
    const cfg = await call<{ graceMs: number }>("GET", "/config");
    console.log(c.dim(`Using the running server at ${API}`));
    return { graceMs: cfg.graceMs };
  } catch (err) {
    if (!isConnectionError(err)) throw err;
  }
  console.log(c.dim(`No server at ${API}; starting one in-process (MOCK_PAYPAL=1).`));
  const { buildApp } = await import("../server/src/app.js");
  const { loadConfig } = await import("../server/src/config.js");
  const port = Number(new URL(API).port || 4000);
  const config = loadConfig({
    ...process.env,
    MOCK_PAYPAL: "1",
    PORT: String(port),
    SERVER_PUBLIC_URL: API,
    TWILIO_ACCOUNT_SID: "",
    SUPABASE_URL: "",
  });
  const { app } = await buildApp(config);
  await app.listen({ port, host: "127.0.0.1" });
  return { app, graceMs: config.graceMs };
}

async function main() {
  console.log(c.bold("\nHollaback: scripted recovery run (mock PayPal, console WhatsApp)\n"));
  const { app, graceMs } = await ensureServer();
  const sessionId = `demo-${Date.now().toString(36)}`;
  const phone = `+2348031${String(Math.floor(10000 + Math.random() * 89999))}`;
  const items = [{ sku: "AR-01", name: "Air Runners", quantity: 1, unitPrice: 89 }];

  say("Shopper opens the Kicks Lagos checkout", "snippet -> POST /events checkout_started (cart, phone, email, consent)");
  await call("POST", "/events", {
    type: "checkout_started",
    sessionId,
    merchantId: "demo",
    cart: { items, currency: "USD" },
    contact: { name: "Ada Obi", phone, email: "ada@example.com" },
    consent: true,
  });

  say("Shopper clicks the PayPal button", "checkout page -> POST /orders -> Orders v2 create (PAY_NOW, payer-action link)");
  const order = await call<{ orderId: string; payerActionUrl: string; cartId: string; status: string }>("POST", "/orders", {
    sessionId,
    items,
    currency: "USD",
  });
  console.log(`   PayPal order ${c.bold(order.orderId)} ${c.dim(`(${order.status})`)}`);
  await call("POST", "/events", { type: "order_created", sessionId, orderId: order.orderId });

  say("Shopper closes the PayPal popup without paying", "SDK onCancel -> snippet -> POST /events abandoned (reason: cancel)");
  await call("POST", "/events", { type: "abandoned", sessionId, orderId: order.orderId, reason: "cancel" });

  say(
    `Server confirms abandonment after the ${Math.round(graceMs / 1000)}s grace period`,
    "polls GET /v2/checkout/orders/{id}; fires only if still CREATED / PAYER_ACTION_REQUIRED",
  );
  let d = await waitFor(order.cartId, "waiting for grace timer", (x) => agentMessages(x).length >= 1, graceMs + 20_000);
  console.log(`   Cart ${c.bold(d.cart.status)}, order still ${d.cart.orderStatus}, signal ${d.cart.abandonReason}`);

  say("Recovery agent messages the shopper on WhatsApp (console channel)");
  bubble("agent", agentMessages(d)[0]!.body);

  say("Shopper replies with a price objection");
  bubble("shopper", "bit pricey rn");
  await call("POST", "/channels/console/inbound", { from: phone, body: "bit pricey rn" });
  d = await waitFor(order.cartId, "waiting for agent", (x) => agentMessages(x).length >= 2, 60_000);
  bubble("agent", agentMessages(d)[1]!.body);

  say(
    "Shopper taps the link and approves on PayPal",
    "mock PayPal approval -> CHECKOUT.ORDER.APPROVED webhook -> capture -> PAYMENT.CAPTURE.COMPLETED",
  );
  await call("POST", `/mock/paypal/orders/${order.orderId}/approve`);
  d = await waitFor(order.cartId, "waiting for webhook", (x) => x.cart.status === "recovered", 20_000);
  bubble("agent", agentMessages(d).at(-1)!.body);

  say("Recovered");
  const tools = d.conversations.flatMap((cv) => cv.messages).filter((m) => m.toolCall);
  console.log(`   Status:      ${c.green(d.cart.status)} (order ${d.cart.orderStatus})`);
  console.log(`   Recovered:   ${c.green(`$${d.cart.recoveredAmount?.toFixed(2)}`)}`);
  console.log(`   Tool calls:  ${tools.map((m) => `${m.toolCall!.name}${m.toolCall!.ok ? "" : " (refused)"}`).join(", ")}`);
  console.log(`   Webhooks:    ${d.webhooks.map((w) => `${w.eventType}${w.verified ? "" : " (unverified)"}`).join(", ")}`);
  console.log(`   Outcome:     ${d.conversations[0]?.outcome}`);
  console.log(`\n   Transcript:  ${DASHBOARD}/carts/${order.cartId}`);
  console.log(`   Dashboard:   ${DASHBOARD}\n`);

  if (app) await app.close();
  console.log(c.green("PASS: created -> abandoned -> agent message -> recovered\n"));
}

main().catch((err) => {
  console.error(c.red(`\nFAIL: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
