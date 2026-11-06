import { itemsSummary, maskPhone, OUTCOME_LABEL, outcomeKey } from "./format";
import type { CartRow } from "./types";

/** How the shopper left checkout, as the carts table shows it. */
export const LEFT_VIA: Record<string, string> = {
  cancel: "Closed PayPal",
  idle: "Went idle",
  hidden: "Left the tab",
  exit_intent: "Exit intent",
  pagehide: "Closed the page",
  timeout: "Never paid",
};

export function shopperLabel(c: CartRow): string {
  return [c.shopperName, maskPhone(c.shopperPhone)].filter(Boolean).join(" · ") || "Anonymous";
}

/** How a recovered cart was paid: the agent's invoice or the checkout link. */
export function paidVia(c: CartRow): "invoice" | "link" | "" {
  if (c.status !== "recovered") return "";
  return c.invoiceId ? "invoice" : "link";
}

/** Columns of the CSV export, in order. Each `colId` is a column of the carts grid. */
export const CSV_COLUMNS = [
  { colId: "shopper", header: "Shopper" },
  { colId: "items", header: "Items" },
  { colId: "total", header: "Total" },
  { colId: "currency", header: "Currency" },
  { colId: "leftAt", header: "Left checkout" },
  { colId: "leftVia", header: "How they left" },
  { colId: "outcome", header: "Outcome" },
  { colId: "recovered", header: "Recovered" },
  { colId: "paidVia", header: "Paid via" },
  { colId: "orderId", header: "PayPal order" },
] as const;

export type CsvColumnId = (typeof CSV_COLUMNS)[number]["colId"];

/** Readable CSV value for one cart: labels instead of internal keys, ISO times, plain amounts. */
export function csvValue(colId: string, c: CartRow): string {
  const value = (() => {
    switch (colId as CsvColumnId) {
      case "shopper":
        return shopperLabel(c);
      case "items":
        return itemsSummary(c.items);
      case "total":
        return c.effectiveTotal.toFixed(2);
      case "currency":
        return c.currency;
      case "leftAt":
        return c.abandonedAt ?? "";
      case "leftVia":
        return c.abandonReason ? (LEFT_VIA[c.abandonReason] ?? c.abandonReason) : "";
      case "outcome":
        return OUTCOME_LABEL[outcomeKey(c)];
      case "recovered":
        return c.status === "recovered" && c.recoveredAmount !== null ? c.recoveredAmount.toFixed(2) : "";
      case "paidVia":
        return paidVia(c);
      case "orderId":
        return c.paypalOrderId ?? "";
      default:
        return "";
    }
  })();
  // Shopper names and items come from a public checkout form: never let a spreadsheet run them as formulas.
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export interface CartTotals {
  carts: number;
  total: number;
  recovered: number;
}

export function cartTotals(carts: CartRow[]): CartTotals {
  const cents = (n: number) => Math.round(n * 100);
  let total = 0;
  let recovered = 0;
  for (const c of carts) {
    total += cents(c.effectiveTotal);
    if (c.status === "recovered") recovered += cents(c.recoveredAmount ?? 0);
  }
  return { carts: carts.length, total: total / 100, recovered: recovered / 100 };
}
