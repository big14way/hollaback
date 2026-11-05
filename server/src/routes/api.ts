import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import { effectiveTotal } from "../orders.js";

const HEARTBEAT_MS = 20_000;

/** Read API for the merchant dashboard. */
export function registerApiRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { store, bus } = deps;
  const streams = new Set<ServerResponse>();

  /**
   * Server-sent events: one `change` event per store write (optionally only for one cart).
   * The dashboard refetches on each event, so the grid flips the moment a webhook lands.
   */
  app.get<{ Querystring: { cartId?: string } }>("/api/stream", (req, reply) => {
    const only = req.query.cartId || null;
    reply.hijack();
    const res = reply.raw;
    // hijack() skips Fastify's reply pipeline, so carry over headers set by hooks (CORS).
    const inherited = Object.fromEntries(Object.entries(reply.getHeaders()).filter(([, v]) => v !== undefined)) as OutgoingHttpHeaders;
    res.writeHead(200, {
      ...inherited,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ store: store.kind })}\n\n`);
    streams.add(res);

    const unsubscribe = bus.subscribe((e) => {
      if (only && e.cartId !== only) return;
      res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    heartbeat.unref();
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    };
    req.raw.on("close", cleanup);
    res.on("close", cleanup);
  });

  app.addHook("preClose", async () => {
    for (const res of streams) res.end();
    streams.clear();
  });

  app.get("/api/carts", async () => {
    const [carts, convs] = await Promise.all([store.listCarts(), store.listConversations()]);
    const latest = new Map<string, (typeof convs)[number]>();
    for (const c of convs) latest.set(c.cartId, c);
    return {
      carts: carts.map((cart) => {
        const conv = latest.get(cart.id);
        return {
          ...cart,
          effectiveTotal: effectiveTotal(cart),
          channel: conv?.channel ?? cart.recoveryChannel,
          outcome: conv?.outcome ?? (cart.status === "paid" ? "paid" : null),
          conversationStatus: conv?.status ?? null,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/api/carts/:id", async (req, reply) => {
    const cart = await store.getCart(req.params.id);
    if (!cart) return reply.code(404).send({ ok: false, error: "cart not found" });
    const convs = await store.listConversations(cart.id);
    const conversations = await Promise.all(convs.map(async (c) => ({ ...c, messages: await store.listMessages(c.id) })));
    const [events, webhooks] = await Promise.all([store.listCheckoutEvents(cart.id), store.listWebhookEvents(cart.id)]);
    return { cart: { ...cart, effectiveTotal: effectiveTotal(cart) }, conversations, events, webhooks, channel: deps.channel.name };
  });

  app.get("/api/stats", async () => {
    const carts = await store.listCarts();
    const abandoned = carts.filter((c) => c.abandonedAt);
    const recovered = carts.filter((c) => c.status === "recovered");
    const recoveredRevenue = recovered.reduce((s, c) => s + (c.recoveredAmount ?? 0), 0);
    return {
      carts: carts.length,
      abandoned: abandoned.length,
      contacted: carts.filter((c) => c.recoveryChannel).length,
      recovered: recovered.length,
      recoveredRevenue: Math.round(recoveredRevenue * 100) / 100,
      recoveryRate: abandoned.length ? recovered.length / abandoned.length : 0,
      currency: deps.config.merchant.currency,
    };
  });
}
