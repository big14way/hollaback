import { itemsSummary, OUTCOME_LABEL, outcomeKey } from "./format";
import type { CartRow } from "./types";

/**
 * Outcome grouping for AG Grid Community. Row grouping (rowGroup) is an AG Grid
 * Enterprise feature, so groups are rendered as full-width header rows instead.
 */
export interface GroupHeaderRow {
  kind: "group";
  id: string;
  key: string;
  label: string;
  count: number;
  recovered: number;
  collapsed: boolean;
  /** Text of every child, so the quick filter keeps the header when a child matches. */
  search: string;
}

export interface DataRow extends CartRow {
  kind: "cart";
  search: string;
}

export type GridRow = GroupHeaderRow | DataRow;

export const GROUP_ORDER = ["recovered", "invoice_sent", "in_progress", "none", "no_reply", "declined", "paid"] as const;

export function searchText(c: CartRow): string {
  return [c.shopperName, c.shopperPhone, c.shopperEmail, itemsSummary(c.items), c.status, c.outcome, c.channel, c.paypalOrderId, c.abandonReason]
    .filter(Boolean)
    .join(" ");
}

export function toDataRows(carts: CartRow[]): DataRow[] {
  return carts.map((c) => ({ ...c, kind: "cart" as const, search: searchText(c) }));
}

export function groupByOutcome(carts: CartRow[], collapsed: ReadonlySet<string>): GridRow[] {
  const buckets = new Map<string, CartRow[]>();
  for (const c of carts) {
    const key = outcomeKey(c);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const keys = [...buckets.keys()].sort(
    (a, b) => GROUP_ORDER.indexOf(a as (typeof GROUP_ORDER)[number]) - GROUP_ORDER.indexOf(b as (typeof GROUP_ORDER)[number]),
  );
  const rows: GridRow[] = [];
  for (const key of keys) {
    const children = buckets.get(key)!;
    const data = toDataRows(children);
    rows.push({
      kind: "group",
      id: `group:${key}`,
      key,
      label: OUTCOME_LABEL[key as keyof typeof OUTCOME_LABEL] ?? key,
      count: children.length,
      recovered: children.reduce((s, c) => s + (c.status === "recovered" ? c.recoveredAmount ?? 0 : 0), 0),
      collapsed: collapsed.has(key),
      search: data.map((d) => d.search).join(" "),
    });
    if (!collapsed.has(key)) rows.push(...data);
  }
  return rows;
}
