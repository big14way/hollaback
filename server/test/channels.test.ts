import { afterEach, describe, expect, it } from "vitest";
import type { Cart, Conversation, Message } from "../src/store/types.js";
import { FakeWhatsAppChannel, makeApp, PHONE, startCheckout, waitFor, type TestApp } from "./helpers.js";

type CartView = { cart: Cart; conversations: Array<Conversation & { messages: Message[] }> };

/** A number from the UK range reserved for fiction, standing in for a shopper who joined the sandbox. */
const REAL_PHONE = "+447700900123";

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

async function cartView(id: string) {
  return (await t.get<CartView>(`/api/carts/${id}`)).body;
}

async function abandon(sessionId: string, phone?: string) {
  const order = await startCheckout(t, { sessionId, phone });
  await t.post("/events", { type: "abandoned", sessionId, orderId: order.orderId, reason: "cancel" });
  await waitFor(async () => (await cartView(order.cartId)).cart.status === "contacted");
  return order;
}

describe("channel routing by shopper number (main channel WhatsApp)", () => {
  it("keeps the demo shopper's number on the console channel", async () => {
    const whatsapp = new FakeWhatsAppChannel();
    t = await makeApp({}, { channel: whatsapp });
    const order = await abandon("s-demo");

    const view = await cartView(order.cartId);
    expect(view.conversations[0]!.channel).toBe("console");
    expect(view.cart.recoveryChannel).toBe("console");
    expect(t.outbox).toHaveLength(1);
    expect(t.outbox[0]!.to).toBe(PHONE);
    expect(whatsapp.outbox).toHaveLength(0);

    const list = (await t.get<{ carts: Array<{ id: string; channel: string }> }>("/api/carts")).body.carts;
    expect(list.find((c) => c.id === order.cartId)!.channel).toBe("console");
    expect((await t.get<{ channel: string }>("/health")).body.channel).toBe("whatsapp");
    expect((await t.get<{ channel: string }>("/config")).body.channel).toBe("whatsapp");
  });

  it("sends every other number over WhatsApp, and the console routes can't reply for it", async () => {
    const whatsapp = new FakeWhatsAppChannel();
    t = await makeApp({}, { channel: whatsapp });
    const order = await abandon("s-real", REAL_PHONE);

    const view = await cartView(order.cartId);
    expect(view.conversations[0]!.channel).toBe("whatsapp");
    expect(whatsapp.outbox).toHaveLength(1);
    expect(whatsapp.outbox[0]!.to).toBe(REAL_PHONE);
    expect(t.outbox).toHaveLength(0);

    const fromDashboard = await t.post(`/api/carts/${order.cartId}/reply`, { body: "bit pricey rn" });
    expect(fromDashboard.status).toBe(409);
    const fromConsole = await t.post("/channels/console/inbound", { from: REAL_PHONE, body: "bit pricey rn" });
    expect(fromConsole.status).toBe(409);
    expect((await cartView(order.cartId)).conversations[0]!.messages.some((m) => m.role === "shopper")).toBe(false);
  });

  it("drives the agent from the dashboard's reply box for a console conversation", async () => {
    const whatsapp = new FakeWhatsAppChannel();
    t = await makeApp({}, { channel: whatsapp });
    const order = await abandon("s-reply");

    const res = await t.post<{ handled: boolean }>(`/api/carts/${order.cartId}/reply`, { body: "bit pricey rn" });
    expect(res.status).toBe(200);
    expect(res.body.handled).toBe(true);
    expect(t.outbox[1]!.body).toContain("Pay Later");
    expect(t.outbox[1]!.body).toContain(order.payerActionUrl);
    expect(whatsapp.outbox).toHaveLength(0);

    const tools = (await cartView(order.cartId)).conversations[0]!.messages.filter((m) => m.toolCall).map((m) => m.toolCall!.name);
    expect(tools).toContain("offer_pay_later");

    const viaConsole = await t.post<{ handled: boolean }>("/channels/console/inbound", { from: PHONE, body: "is this legit?" });
    expect(viaConsole.body.handled).toBe(true);
    expect(t.outbox[2]!.body).toContain("Purchase Protection");
  });

  it("replies into the cart's own conversation when several carts share the demo number", async () => {
    t = await makeApp({}, { channel: new FakeWhatsAppChannel() });
    const first = await abandon("s-first");
    const second = await abandon("s-second");

    await t.post(`/api/carts/${first.cartId}/reply`, { body: "just email me the invoice" });
    const a = await cartView(first.cartId);
    const b = await cartView(second.cartId);
    expect(a.conversations[0]!.messages.some((m) => m.role === "shopper")).toBe(true);
    expect(a.cart.invoiceId).toMatch(/^INV2-/);
    expect(b.conversations[0]!.messages.some((m) => m.role === "shopper")).toBe(false);
    expect(b.cart.invoiceId).toBeNull();
  });

  it("routes nothing to the console when CONSOLE_NUMBERS lists other numbers", async () => {
    const whatsapp = new FakeWhatsAppChannel();
    t = await makeApp({ CONSOLE_NUMBERS: "+15005550006" }, { channel: whatsapp });
    const order = await abandon("s-listed");
    expect((await cartView(order.cartId)).conversations[0]!.channel).toBe("whatsapp");
    expect(whatsapp.outbox[0]!.to).toBe(PHONE);
  });
});
