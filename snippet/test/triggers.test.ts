import { describe, expect, it } from "vitest";
import { AbandonTriggers } from "../src/triggers";

const ORDER = "5O190127TN364715T";

describe("abandonment triggers", () => {
  it("stays quiet until a PayPal order exists", () => {
    const t = new AbandonTriggers();
    expect(t.tick(1_000_000)).toBeNull();
    expect(t.fire("exit_intent")).toBeNull();
  });

  it("fires idle after 45s without interaction", () => {
    const t = new AbandonTriggers();
    t.orderCreated(ORDER, 0);
    expect(t.tick(44_000)).toBeNull();
    expect(t.tick(45_000)).toBe("idle");
    expect(t.tick(90_000)).toBeNull();
  });

  it("does not count time spent in the PayPal popup as idle", () => {
    const t = new AbandonTriggers();
    t.orderCreated(ORDER, 0);
    t.focus(false, 1_000);
    expect(t.tick(120_000)).toBeNull();
    t.focus(true, 120_000);
    expect(t.tick(150_000)).toBeNull();
    expect(t.tick(165_000)).toBe("idle");
  });

  it("fires hidden after the tab has been hidden for 20s", () => {
    const t = new AbandonTriggers();
    t.orderCreated(ORDER, 0);
    t.visibility(true, 5_000);
    expect(t.tick(24_000)).toBeNull();
    expect(t.tick(25_000)).toBe("hidden");
  });

  it("resets when the tab becomes visible again", () => {
    const t = new AbandonTriggers();
    t.orderCreated(ORDER, 0);
    t.visibility(true, 5_000);
    t.visibility(false, 15_000);
    expect(t.tick(30_000)).toBeNull();
  });

  it("fires once per order and never after approval", () => {
    const t = new AbandonTriggers();
    t.orderCreated(ORDER, 0);
    expect(t.fire("cancel")).toBe("cancel");
    expect(t.fire("exit_intent")).toBeNull();

    const paid = new AbandonTriggers();
    paid.orderCreated(ORDER, 0);
    paid.approve();
    expect(paid.fire("cancel")).toBeNull();
    expect(paid.tick(100_000)).toBeNull();
  });

  it("re-arms for a new order after a retry", () => {
    const t = new AbandonTriggers();
    t.orderCreated(ORDER, 0);
    t.fire("cancel");
    expect(t.orderCreated("7XY12345AB678901C", 10_000)).toBe(true);
    expect(t.fire("cancel")).toBe("cancel");
  });
});
