import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { effectiveTotal } from "../orders.js";

/** Read API for the merchant dashboard. */
export function registerApiRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { store } = deps;

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
