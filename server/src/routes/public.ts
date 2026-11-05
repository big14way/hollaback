import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { payLaterEligibleFor } from "../agent/guardrails.js";
import type { AppDeps } from "../app.js";
import { createOrderForCart, itemsTotal } from "../orders.js";
import { PayPalApiError } from "../paypal/client.js";
import type { Cart } from "../store/types.js";
import { cleanItems, contactPatch, EventSchema, OrderBodySchema } from "./schemas.js";

const REUSABLE: ReadonlySet<Cart["status"]> = new Set(["active", "pending", "abandoned", "expired"]);

export function registerPublicRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config, store, paypal, monitor, recovery, log } = deps;

  app.get("/health", async () => ({
    ok: true,
    mockPaypal: config.mockPaypal,
    store: store.kind,
    channel: deps.channel.name,
    agent: deps.agent.name,
    toolkit: deps.toolkit?.names ?? [],
    watching: monitor.watching,
  }));

  /** Public, non-secret config for the demo store and dashboard. */
  app.get("/config", async () => ({
    mock: config.mockPaypal,
    paypalClientId: config.mockPaypal ? null : config.paypal.clientId,
    environment: config.paypal.environment,
    sdkUrl:
      config.paypal.environment === "live" ? "https://www.paypal.com/web-sdk/v6/core" : "https://www.sandbox.paypal.com/web-sdk/v6/core",
    merchant: { id: config.merchant.id, name: config.merchant.name, currency: config.merchant.currency },
    channel: deps.channel.name,
    agent: deps.agent.name,
    graceMs: config.graceMs,
    // The recovery policy the dashboard's Playbook page shows (all non-secret).
    policy: {
      discountCapPct: config.discountCapPct,
      followUpMs: config.followUpMs,
      maxWaitMs: config.maxWaitMs,
      webhookVerified: Boolean(config.paypal.webhookId) && !config.mockPaypal,
      toolkit: deps.toolkit?.names ?? [],
    },
  }));

  /** The drop-in snippet. */
  app.get("/hb.js", async (_req, reply) => {
    try {
      const js = await readFile(deps.snippetPath, "utf8");
      return reply
        .header("content-type", "application/javascript; charset=utf-8")
        .header("cache-control", "public, max-age=60")
        .header("cross-origin-resource-policy", "cross-origin")
        .send(js);
    } catch {
      return reply.code(404).type("text/plain").send("hb.js not built. Run: pnpm --filter @hollaback/snippet build");
    }
  });

  /** Create the PayPal order for the checkout (Orders v2, PAY_NOW, payer-action link). */
  app.post("/orders", async (req, reply) => {
    const parsed = OrderBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues });
    const body = parsed.data;
    const items = cleanItems(body.items);
    const total = itemsTotal(items);

    let cart: Cart | null = null;
    if (body.cartId) cart = await store.getCart(body.cartId);
    if (!cart && body.sessionId) cart = await store.findCart({ sessionId: body.sessionId });
    if (cart && !REUSABLE.has(cart.status)) cart = null;

    const base = {
      items,
      total,
      currency: body.currency.toUpperCase(),
      discountPct: 0,
      status: "active" as const,
      payLaterEligible: payLaterEligibleFor(total, body.currency.toUpperCase(), body.payLaterEligible),
      ...contactPatch(body.contact),
      ...(body.consent !== undefined ? { consent: body.consent } : {}),
    };
    cart = cart
      ? await store.updateCart(cart.id, base)
      : await store.createCart({ merchantId: body.merchantId ?? config.merchant.id, sessionId: body.sessionId ?? null, ...base });

    try {
      cart = await createOrderForCart(deps, cart);
    } catch (err) {
      log.error({ err, cartId: cart.id }, "PayPal order create failed");
      const status = err instanceof PayPalApiError && err.status < 500 ? 422 : 502;
      return reply.code(status).send({ ok: false, error: (err as Error).message });
    }
    cart = await store.updateCart(cart.id, { status: "pending" });
    monitor.orderCreated(cart);
    await store.addCheckoutEvent({ cartId: cart.id, type: "order_created", detail: { orderId: cart.paypalOrderId, source: "server" } });
    log.info({ cartId: cart.id, orderId: cart.paypalOrderId, total: cart.total }, "PayPal order created");
    return { orderId: cart.paypalOrderId, payerActionUrl: cart.payerActionUrl, cartId: cart.id, status: cart.orderStatus };
  });

  /** Capture after approval (called from the checkout page's onApprove and the return page). */
  app.post<{ Params: { id: string } }>("/orders/:id/capture", async (req, reply) => {
    const id = req.params.id;
    let status: string;
    try {
      status = (await paypal.captureOrder(id, `hb-capture-${id}`)).status;
    } catch (err) {
      if (err instanceof PayPalApiError && err.issue === "ORDER_ALREADY_CAPTURED") {
        status = (await paypal.getOrder(id)).status;
      } else {
        log.warn({ err, orderId: id }, "capture failed");
        const code = err instanceof PayPalApiError && err.status < 500 ? 422 : 502;
        return reply.code(code).send({ ok: false, error: (err as Error).message, issue: err instanceof PayPalApiError ? err.issue : undefined });
      }
    }
    let cart = await store.findCart({ paypalOrderId: id });
    if (cart) {
      cart = await store.updateCart(cart.id, { orderStatus: status });
      if (status === "COMPLETED") cart = await recovery.onPayment(cart, "capture");
    }
    return { ok: true, orderId: id, status, cartId: cart?.id ?? null, cartStatus: cart?.status ?? null };
  });

  /** Browser events from the snippet: checkout_started, order_created, abandoned. */
  app.post("/events", async (req, reply) => {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues });
    const e = parsed.data;

    let cart: Cart | null = null;
    if (e.orderId) cart = await store.findCart({ paypalOrderId: e.orderId });
    if (!cart) cart = await store.findCart({ sessionId: e.sessionId });
    const fresh = e.type === "checkout_started" && !e.update && cart && !REUSABLE.has(cart.status);
    if (!cart || fresh) {
      const items = e.cart ? cleanItems(e.cart.items) : [];
      cart = await store.createCart({
        merchantId: e.merchantId ?? config.merchant.id,
        sessionId: e.sessionId,
        items,
        total: e.cart?.total ?? itemsTotal(items),
        currency: (e.cart?.currency ?? config.merchant.currency).toUpperCase(),
      });
    }

    const patch: Partial<Cart> = { ...contactPatch(e.contact) };
    if (e.consent !== undefined) patch.consent = e.consent;
    if (e.cart && (cart.status === "active" || cart.status === "pending") && !cart.paypalOrderId) {
      patch.items = cleanItems(e.cart.items);
      patch.total = e.cart.total ?? itemsTotal(patch.items);
      patch.currency = e.cart.currency.toUpperCase();
    }
    if (Object.keys(patch).length) cart = await store.updateCart(cart.id, patch);

    let duplicate = false;
    if (e.type === "order_created") {
      if (!e.orderId) return reply.code(400).send({ ok: false, error: "orderId required" });
      duplicate = cart.paypalOrderId === e.orderId;
      if (cart.paypalOrderId !== e.orderId) {
        // Order created by the merchant's own backend: start tracking it.
        let orderStatus: string | null = null;
        try {
          orderStatus = (await paypal.getOrder(e.orderId)).status;
        } catch (err) {
          log.warn({ err, orderId: e.orderId }, "could not read order reported by snippet");
        }
        cart = await store.updateCart(cart.id, {
          paypalOrderId: e.orderId,
          orderStatus,
          orderCreatedAt: new Date().toISOString(),
          status: "pending",
        });
      } else if (cart.status === "active") {
        cart = await store.updateCart(cart.id, { status: "pending" });
      }
      if (cart.status === "pending") monitor.orderCreated(cart);
    }

    if (e.type === "abandoned" && cart.status === "pending") {
      monitor.signal(cart, e.reason ?? "unknown");
    }

    if (!(e.type === "checkout_started" && e.update) && !duplicate) {
      await store.addCheckoutEvent({
        cartId: cart.id,
        type: e.type,
        detail: { ...(e.orderId ? { orderId: e.orderId } : {}), ...(e.reason ? { reason: e.reason } : {}), ...(e.url ? { url: e.url } : {}) },
      });
    }
    return { ok: true, cartId: cart.id, status: cart.status };
  });
}
