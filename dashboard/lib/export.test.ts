import { describe, expect, it } from "vitest";
import { cartTotals, CSV_COLUMNS, csvValue } from "./export";
import type { CartRow } from "./types";

function cart(partial: Partial<CartRow>): CartRow {
  return {
    id: "c1",
    shopperName: "Ada Obi",
    shopperPhone: "+2348031234567",
    shopperEmail: "ada@example.com",
    consent: true,
    items: [{ name: "Air Runners", quantity: 1, unitPrice: 89 }],
    total: 89,
    effectiveTotal: 89,
    currency: "USD",
    paypalOrderId: "5O190127TN364715T",
    orderStatus: "PAYER_ACTION_REQUIRED",
    payerActionUrl: null,
    status: "contacted",
    abandonReason: "cancel",
    abandonedAt: "2026-11-05T19:02:11.000Z",
    recoveredAt: null,
    recoveredAmount: null,
    discountPct: 0,
    invoiceId: null,
    invoiceUrl: null,
    channel: "console",
    outcome: null,
    createdAt: "2026-11-05T19:01:00.000Z",
    updatedAt: "2026-11-05T19:02:11.000Z",
    ...partial,
  };
}

const row = (c: CartRow) => CSV_COLUMNS.map((col) => csvValue(col.colId, c));

describe("CSV export values", () => {
  it("exports readable labels, ISO times and plain amounts", () => {
    expect(CSV_COLUMNS.map((c) => c.header)).toEqual([
      "Shopper",
      "Items",
      "Total",
      "Currency",
      "Left checkout",
      "How they left",
      "Outcome",
      "Recovered",
      "Paid via",
      "PayPal order",
    ]);
    expect(row(cart({}))).toEqual([
      "Ada Obi · +234•••567",
      "Air Runners",
      "89.00",
      "USD",
      "2026-11-05T19:02:11.000Z",
      "Closed PayPal",
      "In conversation",
      "",
      "",
      "5O190127TN364715T",
    ]);
  });

  it("shows how a recovered cart was paid", () => {
    const viaInvoice = cart({ status: "recovered", outcome: "recovered", recoveredAmount: 80.1, effectiveTotal: 80.1, invoiceId: "INV2-AAAA" });
    expect(row(viaInvoice).slice(6, 9)).toEqual(["Recovered", "80.10", "invoice"]);
    expect(csvValue("paidVia", cart({ status: "recovered", outcome: "recovered", recoveredAmount: 89 }))).toBe("link");
  });

  it("keeps spreadsheet formulas out of shopper-typed text", () => {
    expect(csvValue("shopper", cart({ shopperName: "=HYPERLINK(\"x\")" }))).toBe("'=HYPERLINK(\"x\") · +234•••567");
    expect(csvValue("shopper", cart({ shopperName: null }))).toBe("'+234•••567");
    expect(csvValue("items", cart({ items: [{ name: "@SUM(A1)", quantity: 1, unitPrice: 5 }] }))).toBe("'@SUM(A1)");
  });
});

describe("totals row", () => {
  it("counts the carts and sums their value and what was recovered", () => {
    const carts = [
      cart({ effectiveTotal: 89 }),
      cart({ status: "recovered", recoveredAmount: 80.1, effectiveTotal: 80.1 }),
      cart({ status: "declined", effectiveTotal: 45.35 }),
    ];
    expect(cartTotals(carts)).toEqual({ carts: 3, total: 214.45, recovered: 80.1 });
    expect(cartTotals([])).toEqual({ carts: 0, total: 0, recovered: 0 });
  });
});
