import type { FastifyInstance } from "fastify";
import { buildApp, type AppDeps, type BuildOverrides } from "../src/app.js";
import { ConsoleChannel } from "../src/channels/console.js";
import type { ChannelAdapter } from "../src/channels/types.js";
import { loadConfig } from "../src/config.js";
import { silentLogger } from "../src/log.js";

/** The demo store's shopper number, which CONSOLE_NUMBERS keeps on the console channel by default. */
export const PHONE = "+2348031234567";
export const ITEMS = [{ name: "Air Runners", quantity: 1, unitPrice: 89 }];

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  /** Messages sent on the console channel. */
  outbox: ConsoleChannel["outbox"];
  post: <T = Record<string, unknown>>(url: string, payload?: unknown, contentType?: string) => Promise<{ status: number; body: T }>;
  get: <T = Record<string, unknown>>(url: string) => Promise<{ status: number; body: T }>;
}

/** Records sends instead of calling Twilio. */
export class FakeWhatsAppChannel implements ChannelAdapter {
  readonly name = "whatsapp" as const;
  readonly outbox: Array<{ to: string; body: string }> = [];

  async send(to: string, body: string): Promise<{ id: string }> {
    this.outbox.push({ to, body });
    return { id: `SM${this.outbox.length}` };
  }
}

/** `overrides.channel` replaces the main channel (the console channel by default). */
export async function makeApp(env: Record<string, string> = {}, overrides: Omit<BuildOverrides, "consoleChannel"> = {}): Promise<TestApp> {
  const config = loadConfig({ MOCK_PAYPAL: "1", GRACE_MS: "60", ABANDON_SETTLE_MS: "10", FOLLOW_UP_MS: "0", ...env });
  const consoleChannel = new ConsoleChannel({ quiet: true });
  const { app, deps } = await buildApp(config, { channel: consoleChannel, log: silentLogger, ...overrides, consoleChannel });
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
  return { app, deps, outbox: consoleChannel.outbox, post, get };
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
export async function startCheckout(t: TestApp, opts: { sessionId: string; consent?: boolean; email?: string | null; phone?: string }) {
  await t.post("/events", {
    type: "checkout_started",
    sessionId: opts.sessionId,
    cart: { items: ITEMS, currency: "USD" },
    contact: { phone: opts.phone ?? PHONE, email: opts.email === undefined ? "ada@example.com" : opts.email, name: "Ada Obi" },
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
