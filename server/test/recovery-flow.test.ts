import { afterEach, describe, expect, it } from "vitest";
import type { Cart, Conversation, Message } from "../src/store/types.js";
import { makeApp, PHONE, startCheckout, waitFor, type TestApp } from "./helpers.js";

type CartView = { cart: Cart & { effectiveTotal: number }; conversations: Array<Conversation & { messages: Message[] }>; webhooks: Array<{ eventType: string }> };

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

async function cartView(id: string) {
  return (await t.get<CartView>(`/api/carts/${id}`)).body;
}

async function abandon(sessionId: string, opts: { consent?: boolean; email?: string | null } = {}) {
  const order = await startCheckout(t, { sessionId, ...opts });
  await t.post("/events", { type: "abandoned", sessionId, orderId: order.orderId, reason: "cancel" });
  return order;
}

describe("recovery loop (mock PayPal, console channel, scripted agent)", () => {
  it("creates a PAY_NOW order with a payer-action link", async () => {
    t = await makeApp();
    const order = await startCheckout(t, { sessionId: "s-order" });
    expect(order.orderId).toMatch(/^[A-Z0-9]{17}$/);
    expect(order.status).toBe("PAYER_ACTION_REQUIRED");
    expect(order.payerActionUrl).toContain(`/mock/paypal/checkoutnow?token=${order.orderId}`);
  });

  it("walks created -> abandoned -> agent message -> Pay Later -> recovered", async () => {
    t = await makeApp();
    const order = await abandon("s-link");
    await waitFor(async () => (await cartView(order.cartId)).cart.status === "contacted");

    expect(t.outbox).toHaveLength(1);
    expect(t.outbox[0]!.to).toBe(PHONE);
    expect(t.outbox[0]!.body).toMatch(/^Hi Ada, this is Kicks Lagos\. Saw you were about to grab the Air Runners \(\$89\.00\)/);

    const reply = await t.post<{ handled: boolean }>("/channels/console/inbound", { from: PHONE, body: "bit pricey rn" });
    expect(reply.body.handled).toBe(true);
    expect(t.outbox[1]!.body).toContain("Pay Later");
    expect(t.outbox[1]!.body).toContain("$22.25");
    expect(t.outbox[1]!.body).toContain(order.payerActionUrl);

    await t.post(`/mock/paypal/orders/${order.orderId}/approve`);
    const view = await cartView(order.cartId);
    expect(view.cart.status).toBe("recovered");
    expect(view.cart.recoveredAmount).toBe(89);
    expect(view.cart.orderStatus).toBe("COMPLETED");
    expect(view.conversations[0]!.outcome).toBe("recovered");
    expect(view.webhooks.map((w) => w.eventType)).toEqual(
      expect.arrayContaining(["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"]),
    );
    expect(t.outbox.at(-1)!.body).toMatch(/Payment received, Ada/);

    const tools = view.conversations[0]!.messages.filter((m) => m.toolCall).map((m) => m.toolCall!.name);
    expect(tools).toEqual(["get_order", "offer_pay_later"]);

    const stats = (await t.get<{ recovered: number; recoveredRevenue: number }>("/api/stats")).body;
    expect(stats.recovered).toBe(1);
    expect(stats.recoveredRevenue).toBe(89);
  });

  it("sends a PayPal invoice when the shopper asks to be emailed, and recovers when it is paid", async () => {
    t = await makeApp();
    const order = await abandon("s-invoice");
    await waitFor(async () => (await cartView(order.cartId)).cart.status === "contacted");

    await t.post("/channels/console/inbound", { from: PHONE, body: "just email me the invoice" });
    const view = await cartView(order.cartId);
    expect(view.cart.invoiceId).toMatch(/^INV2-/);
    const created = t.deps.mock!.requests.find((r) => r.method === "POST" && r.path === "/v2/invoicing/invoices");
    expect((created!.body as { invoicer?: { business_name?: string } }).invoicer?.business_name).toBe("Kicks Lagos");
    expect(view.conversations[0]!.outcome).toBe("invoice_sent");
    expect(t.outbox[1]!.body).toContain("sent a PayPal invoice to ada@example.com");
    expect(t.outbox[1]!.body).toContain(`/mock/paypal/invoice?id=${view.cart.invoiceId}`);
    const call = view.conversations[0]!.messages.find((m) => m.toolCall?.name === "create_and_send_invoice")!.toolCall!;
    expect(call.ok).toBe(true);

    const paths = t.deps.mock!.requests.map((r) => `${r.method} ${r.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        "POST /v2/invoicing/invoices",
        `POST /v2/invoicing/invoices/${view.cart.invoiceId}/send`,
        `GET /v2/invoicing/invoices/${view.cart.invoiceId}`,
      ]),
    );

    await t.post(`/mock/paypal/invoices/${view.cart.invoiceId}/pay`);
    const after = await cartView(order.cartId);
    expect(after.cart.status).toBe("recovered");
    expect(after.webhooks.map((w) => w.eventType)).toContain("INVOICING.INVOICE.PAID");
  });

  it("offers Pay Later first, then a capped discount that PATCHes the order", async () => {
    t = await makeApp();
    const order = await abandon("s-discount");
    await waitFor(async () => (await cartView(order.cartId)).cart.status === "contacted");
    await t.post("/channels/console/inbound", { from: PHONE, body: "too expensive" });
    await t.post("/channels/console/inbound", { from: PHONE, body: "still too much money for me" });

    expect(t.outbox[2]!.body).toContain("10% off");
    expect(t.outbox[2]!.body).toContain("$80.10");
    expect(t.deps.mock!.orders.get(order.orderId)!.purchase_units![0]!.amount.value).toBe("80.10");
    expect(t.deps.mock!.requests.some((r) => r.method === "PATCH")).toBe(true);

    await t.post(`/mock/paypal/orders/${order.orderId}/approve`);
    const view = await cartView(order.cartId);
    expect(view.cart.status).toBe("recovered");
    expect(view.cart.recoveredAmount).toBe(80.1);
  });

  it("ends the conversation and marks declined on STOP", async () => {
    t = await makeApp();
    const order = await abandon("s-stop");
    await waitFor(async () => (await cartView(order.cartId)).cart.status === "contacted");
    await t.post("/channels/console/inbound", { from: PHONE, body: "STOP" });
    const view = await cartView(order.cartId);
    expect(view.cart.status).toBe("declined");
    expect(view.conversations[0]!.status).toBe("closed");
    expect(view.conversations[0]!.outcome).toBe("declined");
    const after = await t.post<{ handled: boolean }>("/channels/console/inbound", { from: PHONE, body: "hello?" });
    expect(after.body.handled).toBe(false);
  });

  it("does not contact shoppers who did not consent", async () => {
    t = await makeApp();
    const order = await abandon("s-noconsent", { consent: false });
    await waitFor(async () => (await cartView(order.cartId)).cart.status === "abandoned");
    await new Promise((r) => setTimeout(r, 30));
    expect(t.outbox).toHaveLength(0);
  });

  it("does not flag a checkout that was paid", async () => {
    t = await makeApp();
    const order = await startCheckout(t, { sessionId: "s-paid" });
    await t.post(`/mock/paypal/orders/${order.orderId}/approve`);
    const cap = await t.post<{ status: string; cartStatus: string }>(`/orders/${order.orderId}/capture`);
    expect(cap.body.status).toBe("COMPLETED");
    expect(cap.body.cartStatus).toBe("paid");
    await t.post("/events", { type: "abandoned", sessionId: "s-paid", orderId: order.orderId, reason: "pagehide" });
    await new Promise((r) => setTimeout(r, 150));
    const view = await cartView(order.cartId);
    expect(view.cart.status).toBe("paid");
    expect(view.cart.abandonedAt).toBeNull();
    expect(t.outbox).toHaveLength(0);
  });

  it("accepts snippet beacons sent as text/plain", async () => {
    t = await makeApp();
    const res = await t.post<{ ok: boolean; cartId: string }>(
      "/events",
      JSON.stringify({ type: "checkout_started", sessionId: "s-beacon", cart: { items: [{ name: "Cap", quantity: 2, unitPrice: 15 }], currency: "USD" } }),
      "text/plain",
    );
    expect(res.status).toBe(200);
    const view = await cartView(res.body.cartId);
    expect(view.cart.total).toBe(30);
  });

  it("guards apply_discount outside the model: a 25% request never reaches PayPal", async () => {
    t = await makeApp();
    const order = await abandon("s-guard");
    await waitFor(async () => (await cartView(order.cartId)).cart.status === "contacted");
    const { store, paypal, config } = t.deps;
    const cart = (await store.getCart(order.cartId))!;
    const conversation = (await store.listConversations(cart.id))[0]!;
    const { createTools } = await import("../src/agent/tools.js");
    const logs: unknown[] = [];
    const tools = createTools({
      cart,
      conversation: { ...conversation, payLaterOffered: true },
      config,
      store,
      paypal,
      toolkit: null,
      links: [],
      ended: null,
      logTool: async (c) => {
        logs.push(c);
      },
    });
    const res = await tools.apply_discount({ percent: 25, reason: "shopper asked nicely" });
    expect(res.ok).toBe(false);
    expect(String(res.reason)).toMatch(/cap/);
    expect(t.deps.mock!.requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(logs).toHaveLength(1);
  });
});
