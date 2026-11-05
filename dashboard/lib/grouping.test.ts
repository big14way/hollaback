import { describe, expect, it } from "vitest";
import { itemsSummary, money, outcomeKey, relativeTime } from "./format";
import { groupByOutcome } from "./grouping";
import type { CartRow } from "./types";

function cart(partial: Partial<CartRow>): CartRow {
  return {
    id: Math.random().toString(36).slice(2),
    shopperName: "Ada Obi",
    shopperPhone: "+2348031234567",
    shopperEmail: null,
    consent: true,
    items: [{ name: "Air Runners", quantity: 1, unitPrice: 89 }],
    total: 89,
    effectiveTotal: 89,
    currency: "USD",
    paypalOrderId: null,
    orderStatus: null,
    payerActionUrl: null,
    status: "abandoned",
    abandonReason: "cancel",
    abandonedAt: null,
    recoveredAt: null,
    recoveredAmount: null,
    discountPct: 0,
    invoiceId: null,
    invoiceUrl: null,
    channel: null,
    outcome: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("outcome grouping", () => {
  const carts = [
    cart({ status: "recovered", outcome: "recovered", recoveredAmount: 89 }),
    cart({ status: "recovered", outcome: "recovered", recoveredAmount: 80.1 }),
    cart({ status: "contacted" }),
    cart({ status: "declined", outcome: "declined", shopperName: "Tunde" }),
  ];

  it("puts a header before each outcome bucket, recovered first", () => {
    const rows = groupByOutcome(carts, new Set());
    expect(rows.filter((r) => r.kind === "group").map((r) => r.kind === "group" && r.key)).toEqual(["recovered", "in_progress", "declined"]);
    const header = rows[0]!;
    expect(header.kind === "group" && header.count).toBe(2);
    expect(header.kind === "group" && header.recovered).toBeCloseTo(169.1);
    expect(rows).toHaveLength(7);
  });

  it("hides children of collapsed groups and keeps child text searchable on the header", () => {
    const rows = groupByOutcome(carts, new Set(["recovered"]));
    expect(rows).toHaveLength(5);
    const declined = rows.find((r) => r.kind === "group" && r.key === "declined")!;
    expect(declined.search).toContain("Tunde");
  });
});

describe("formatting", () => {
  it("formats money, items and outcome keys", () => {
    expect(money(80.1)).toBe("$80.10");
    expect(itemsSummary([{ name: "Socks", quantity: 2, unitPrice: 5 }])).toBe("Socks ×2");
    expect(outcomeKey({ outcome: null, status: "contacted" })).toBe("in_progress");
    expect(outcomeKey({ outcome: null, status: "pending" })).toBe("none");
  });

  it("renders relative times", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(relativeTime("2026-11-05T11:59:30Z", now)).toBe("30s ago");
    expect(relativeTime("2026-11-05T11:45:00Z", now)).toBe("15m ago");
  });
});
