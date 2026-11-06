import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryStore, type SnapshotBackend, type StoreState } from "../src/store/index.js";
import type { Cart } from "../src/store/types.js";
import { makeApp, startCheckout, waitFor, type TestApp } from "./helpers.js";

/** Stands in for the Postgres table: keeps the last saved state and every save. */
class FakeSnapshot implements SnapshotBackend {
  state: StoreState | null = null;
  saves: StoreState[] = [];
  loadError: Error | null = null;
  closed = false;

  async load() {
    if (this.loadError) throw this.loadError;
    return this.state ? structuredClone(this.state) : null;
  }

  async save(state: StoreState) {
    this.saves.push(structuredClone(state));
    this.state = structuredClone(state);
  }

  async close() {
    this.closed = true;
  }
}

// A long grace period keeps the abandonment monitor quiet, so the only writes are the test's own.
const ENV = { GRACE_MS: "60000", SNAPSHOT_DEBOUNCE_MS: "100" };

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Postgres snapshot of the memory store", () => {
  it("is off when DATABASE_URL is unset", async () => {
    expect(loadConfig({}).databaseUrl).toBe("");
    t = await makeApp();
    expect((await t.get<{ store: string }>("/health")).body.store).toBe("memory");
  });

  it("saves the whole store once per burst of writes, about a debounce window later", async () => {
    const fake = new FakeSnapshot();
    t = await makeApp({ ...ENV, SNAPSHOT_DEBOUNCE_MS: "400" }, { snapshot: fake });
    expect((await t.get<{ store: string }>("/health")).body.store).toBe("memory+postgres");

    const order = await startCheckout(t, { sessionId: "snap-burst" });
    expect(fake.saves).toHaveLength(0);
    await waitFor(() => fake.saves.length === 1);
    await sleep(450);
    expect(fake.saves).toHaveLength(1);

    const saved = fake.saves[0]!;
    expect(saved.carts.map((c) => c.id)).toEqual([order.cartId]);
    expect(saved.carts[0]!.paypalOrderId).toBe(order.orderId);
    expect(saved.events.map((e) => e.type)).toEqual(["checkout_started", "order_created"]);
  });

  it("loads the latest snapshot on boot", async () => {
    const fake = new FakeSnapshot();
    t = await makeApp(ENV, { snapshot: fake });
    const order = await startCheckout(t, { sessionId: "snap-restart" });
    await t.app.close();

    t = await makeApp(ENV, { snapshot: fake });
    const carts = (await t.get<{ carts: Cart[] }>("/api/carts")).body.carts;
    expect(carts.map((c) => c.id)).toEqual([order.cartId]);
    const view = (await t.get<{ cart: Cart; events: Array<{ type: string }> }>(`/api/carts/${order.cartId}`)).body;
    expect(view.cart.paypalOrderId).toBe(order.orderId);
    expect(view.events.map((e) => e.type)).toEqual(["checkout_started", "order_created"]);
  });

  it("saves pending writes when the server shuts down", async () => {
    const fake = new FakeSnapshot();
    t = await makeApp({ ...ENV, SNAPSHOT_DEBOUNCE_MS: "60000" }, { snapshot: fake });
    const order = await startCheckout(t, { sessionId: "snap-close" });
    expect(fake.saves).toHaveLength(0);
    await t.app.close();
    t = null;
    expect(fake.saves).toHaveLength(1);
    expect(fake.saves[0]!.carts[0]!.id).toBe(order.cartId);
    expect(fake.closed).toBe(true);
  });

  it("starts empty, warns, and leaves the saved snapshot alone when the database is unreachable", async () => {
    const fake = new FakeSnapshot();
    fake.state = new MemoryStore().exportState();
    const before = structuredClone(fake.state);
    fake.loadError = new Error("connect ECONNREFUSED");
    const warnings: string[] = [];
    const log = { info: () => undefined, error: () => undefined, warn: (_: unknown, msg?: string) => void warnings.push(msg ?? "") };

    t = await makeApp(ENV, { snapshot: fake, log });
    expect((await t.get<{ store: string }>("/health")).body.store).toBe("memory");
    expect(warnings.some((w) => w.includes("Postgres snapshot unavailable"))).toBe(true);
    await startCheckout(t, { sessionId: "snap-down" });
    await sleep(150);
    await t.app.close();
    t = null;
    expect(fake.saves).toHaveLength(0);
    expect(fake.state).toEqual(before);
  });

  it("round-trips the memory store through its snapshot state", async () => {
    const a = new MemoryStore();
    const cart = await a.createCart({ merchantId: "demo", items: [{ name: "Cap", quantity: 2, unitPrice: 15 }], total: 30, currency: "USD" });
    const conv = await a.createConversation({ cartId: cart.id, channel: "console", address: "+2348031234567" });
    await a.addMessage({ conversationId: conv.id, role: "agent", body: "Hi", toolCall: null });

    const b = new MemoryStore({ state: JSON.parse(JSON.stringify(a.exportState())) as StoreState });
    expect(await b.getCart(cart.id)).toEqual(cart);
    expect(await b.findOpenConversation("+2348031234567")).toEqual(conv);
    expect((await b.listMessages(conv.id)).map((m) => m.body)).toEqual(["Hi"]);
    expect(() => new MemoryStore({ state: { version: 2 } as unknown as StoreState })).toThrow(/snapshot/);
  });
});
