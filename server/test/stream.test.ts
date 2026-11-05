import { afterEach, describe, expect, it } from "vitest";
import type { ChangeEvent } from "../src/events.js";
import { makeApp, startCheckout, waitFor, type TestApp } from "./helpers.js";

let t: TestApp;
let abort: AbortController | null = null;
afterEach(async () => {
  abort?.abort();
  await t?.app.close();
});

/** Opens /api/stream over real HTTP and collects parsed SSE events. */
async function openStream(base: string, query = "") {
  abort = new AbortController();
  const res = await fetch(`${base}/api/stream${query}`, { headers: { origin: "http://localhost:3000" }, signal: abort.signal });
  const events: Array<{ event: string; data: unknown }> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event) events.push({ event, data: data ? JSON.parse(data) : null });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { res, events };
}

describe("/api/stream (server-sent events)", () => {
  it("pushes a change event when a PayPal webhook lands, with CORS headers", async () => {
    t = await makeApp();
    const base = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const { res, events } = await openStream(base);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    await waitFor(() => events.some((e) => e.event === "ready"));

    const order = await startCheckout(t, { sessionId: "s-stream" });
    await t.post(`/mock/paypal/orders/${order.orderId}/approve`);
    await waitFor(() => events.some((e) => e.event === "change" && (e.data as ChangeEvent).kind === "webhook"));

    const changes = events.filter((e) => e.event === "change").map((e) => e.data as ChangeEvent);
    expect(changes.every((c) => c.cartId === order.cartId)).toBe(true);
    expect(changes.map((c) => c.kind)).toEqual(expect.arrayContaining(["cart", "webhook"]));
  });

  it("filters to one cart when cartId is given", async () => {
    t = await makeApp();
    const base = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const first = await startCheckout(t, { sessionId: "s-a" });
    const { events } = await openStream(base, `?cartId=${first.cartId}`);
    await waitFor(() => events.some((e) => e.event === "ready"));

    const other = await startCheckout(t, { sessionId: "s-b" });
    await t.post(`/mock/paypal/orders/${other.orderId}/approve`);
    await t.post(`/mock/paypal/orders/${first.orderId}/approve`);
    await waitFor(() => events.some((e) => e.event === "change" && (e.data as ChangeEvent).kind === "webhook"));

    const changes = events.filter((e) => e.event === "change").map((e) => e.data as ChangeEvent);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.cartId === first.cartId)).toBe(true);
  });

  it("releases subscribers when the app closes", async () => {
    t = await makeApp();
    const base = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const { events } = await openStream(base);
    await waitFor(() => events.some((e) => e.event === "ready"));
    expect(t.deps.bus.listeners).toBe(1);
    await t.app.close();
    await waitFor(() => t.deps.bus.listeners === 0);
  });
});
