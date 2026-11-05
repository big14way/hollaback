import type { CartItem, CartStatus, Outcome } from "./types";

export function money(value: number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export function itemsSummary(items: CartItem[]): string {
  if (!items?.length) return "";
  return items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ");
}

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const diff = Math.round((now - Date.parse(iso)) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function maskPhone(phone: string | null): string {
  if (!phone) return "";
  return phone.length > 6 ? `${phone.slice(0, 4)}•••${phone.slice(-3)}` : phone;
}

export const STATUS_LABEL: Record<CartStatus, string> = {
  active: "Browsing",
  pending: "In checkout",
  abandoned: "Abandoned",
  contacted: "Agent engaged",
  recovered: "Recovered",
  paid: "Paid",
  declined: "Declined",
  expired: "Expired",
};

export const OUTCOME_LABEL: Record<Outcome | "in_progress" | "none", string> = {
  recovered: "Recovered",
  invoice_sent: "Invoice sent",
  declined: "Declined",
  no_reply: "No reply",
  paid: "Paid without help",
  in_progress: "In conversation",
  none: "Not contacted",
};

export function outcomeKey(row: { outcome: Outcome | null; status: CartStatus }): keyof typeof OUTCOME_LABEL {
  if (row.outcome) return row.outcome;
  if (row.status === "contacted") return "in_progress";
  return "none";
}
