import type { FastifyInstance } from "fastify";
import { buildApp, type AppDeps } from "../src/app.js";
import { ConsoleChannel } from "../src/channels/console.js";
import { loadConfig } from "../src/config.js";
import { silentLogger } from "../src/log.js";

export const PHONE = "+2348031234567";
export const ITEMS = [{ name: "Air Runners", quantity: 1, unitPrice: 89 }];

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  outbox: ConsoleChannel["outbox"];
  post: <T = Record<string, unknown>>(url: string, payload?: unknown, contentType?: string) => Promise<{ status: number; body: T }>;
  get: <T = Record<string, unknown>>(url: string) => Promise<{ status: number; body: T }>;
}

export async function makeApp(env: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({ MOCK_PAYPAL: "1", GRACE_MS: "60", ABANDON_SETTLE_MS: "10", FOLLOW_UP_MS: "0", ...env });
  const channel = new ConsoleChannel({ quiet: true });
  const { app, deps } = await buildApp(config, { channel, log: silentLogger });
  await app.ready();
  const post = async <T>(url: string, payload?: unknown, contentType = "application/json") => {
    const res = await app.inject({
      method: "POST",
      url,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}),
      headers: { "content-type": contentType },
    });
    return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : {}) as T };
  };
  const get = async <T>(url: string) => {
    const res = await app.inject({ method: "GET", url });
    return { status: res.statusCode, body: JSON.parse(res.body) as T };
  };
  return { app, deps, outbox: channel.outbox, post, get };
}

export async function waitFor(fn: () => Promise<boolean> | boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

/** Snippet + checkout page: start checkout, create the PayPal order, report it. */
export async function startCheckout(t: TestApp, opts: { sessionId: string; consent?: boolean; email?: string | null }) {
  await t.post("/events", {
    type: "checkout_started",
    sessionId: opts.sessionId,
    cart: { items: ITEMS, currency: "USD" },
    contact: { phone: PHONE, email: opts.email === undefined ? "ada@example.com" : opts.email, name: "Ada Obi" },
    consent: opts.consent ?? true,
  });
  const order = await t.post<{ orderId: string; payerActionUrl: string; cartId: string; status: string }>("/orders", {
    sessionId: opts.sessionId,
    items: ITEMS,
    currency: "USD",
  });
  await t.post("/events", { type: "order_created", sessionId: opts.sessionId, orderId: order.body.orderId });
  return order.body;
}
