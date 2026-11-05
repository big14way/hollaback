import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbandonmentMonitor, classifyOrderStatus } from "../src/abandonment.js";
import { PayPalClient } from "../src/paypal/client.js";
import { MockPayPal } from "../src/paypal/mock.js";
import { MemoryStore } from "../src/store/memory.js";
import type { Cart } from "../src/store/types.js";

const GRACE = 30_000;
const MAX_WAIT = 600_000;

async function setup() {
  const mock = new MockPayPal("http://localhost:4000");
  const paypal = new PayPalClient({ clientId: "id", clientSecret: "secret", apiBase: "https://api-m.sandbox.paypal.com", fetch: mock.fetch });
  const store = new MemoryStore();
  const abandoned: Cart[] = [];
  const monitor = new AbandonmentMonitor({
    store,
    paypal,
    graceMs: GRACE,
    maxWaitMs: MAX_WAIT,
    settleMs: 3_000,
    onAbandoned: (c) => {
      abandoned.push(c);
    },
  });
  const order = await paypal.createOrder({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: "89.00" } }],
    payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", return_url: "http://x/r", cancel_url: "http://x/c" } } },
  });
  let cart = await store.createCart({ merchantId: "demo", items: [{ name: "Air Runners", quantity: 1, unitPrice: 89 }], total: 89, currency: "USD" });
  cart = await store.updateCart(cart.id, { paypalOrderId: order.id, status: "pending", orderStatus: order.status });
  return { mock, paypal, store, monitor, abandoned, cart, orderId: order.id };
}

describe("order status classification", () => {
  it("treats CREATED and PAYER_ACTION_REQUIRED as still pending", () => {
    expect(classifyOrderStatus("CREATED")).toBe("pending");
    expect(classifyOrderStatus("PAYER_ACTION_REQUIRED")).toBe("pending");
    expect(classifyOrderStatus("APPROVED")).toBe("paid");
    expect(classifyOrderStatus("COMPLETED")).toBe("paid");
    expect(classifyOrderStatus("VOIDED")).toBe("voided");
  });
});

describe("grace timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires abandoned at the end of the grace period when the popup was closed", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    await vi.advanceTimersByTimeAsync(10_000);
    t.monitor.signal(t.cart, "cancel");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(t.abandoned).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.abandoned).toHaveLength(1);
    expect(t.abandoned[0]!.abandonReason).toBe("cancel");
    expect(t.abandoned[0]!.status).toBe("abandoned");
    expect(t.monitor.watching).toBe(0);
  });

  it("does not fire when the shopper approves within the grace period", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    t.monitor.signal(t.cart, "cancel");
    await vi.advanceTimersByTimeAsync(20_000);
    await t.mock.approveOrder(t.orderId);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.abandoned).toHaveLength(0);
    expect((await t.store.getCart(t.cart.id))!.status).toBe("paid");
  });

  it("keeps waiting while the shopper is still in the PayPal popup (no signal)", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    await vi.advanceTimersByTimeAsync(GRACE * 3);
    expect(t.abandoned).toHaveLength(0);
    expect(t.monitor.isWatching(t.cart.id)).toBe(true);
    expect((await t.store.getCart(t.cart.id))!.orderStatus).toBe("PAYER_ACTION_REQUIRED");
  });

  it("fires 'timeout' once the order has sat unpaid for the max wait", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    await vi.advanceTimersByTimeAsync(MAX_WAIT + GRACE);
    expect(t.abandoned).toHaveLength(1);
    expect(t.abandoned[0]!.abandonReason).toBe("timeout");
  });

  it("confirms a late cancel quickly instead of waiting another full grace period", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    await vi.advanceTimersByTimeAsync(40_000);
    t.monitor.signal(t.cart, "cancel");
    await vi.advanceTimersByTimeAsync(2_900);
    expect(t.abandoned).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.abandoned).toHaveLength(1);
  });

  it("waits a full grace period after a weak signal such as idle", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    await vi.advanceTimersByTimeAsync(45_000);
    t.monitor.signal(t.cart, "idle");
    await vi.advanceTimersByTimeAsync(GRACE - 1_000);
    expect(t.abandoned).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.abandoned).toHaveLength(1);
    expect(t.abandoned[0]!.abandonReason).toBe("idle");
  });

  it("marks voided orders as expired instead of abandoned", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    t.monitor.signal(t.cart, "cancel");
    t.mock.setOrderStatus(t.orderId, "VOIDED");
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(t.abandoned).toHaveLength(0);
    expect((await t.store.getCart(t.cart.id))!.status).toBe("expired");
  });

  it("is idempotent for repeated order_created events and fires once", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    t.monitor.orderCreated(t.cart);
    t.monitor.signal(t.cart, "cancel");
    t.monitor.signal(t.cart, "exit_intent");
    await vi.advanceTimersByTimeAsync(GRACE * 2);
    expect(t.abandoned).toHaveLength(1);
    expect(t.abandoned[0]!.abandonReason).toBe("cancel");
  });

  it("polls GET /v2/checkout/orders/{id} before deciding", async () => {
    const t = await setup();
    t.monitor.orderCreated(t.cart);
    t.monitor.signal(t.cart, "cancel");
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(t.mock.requests.some((r) => r.method === "GET" && r.path === `/v2/checkout/orders/${t.orderId}`)).toBe(true);
  });
});
