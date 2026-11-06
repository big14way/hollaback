/**
 * Deterministic guardrails that sit outside the language model. The model can ask for
 * anything; these functions decide what actually happens.
 */
import { round2 } from "../util.js";

/** Absolute ceiling, regardless of configuration. */
export const HARD_DISCOUNT_CAP_PCT = 10;

/** Two agent messages without a reply ends the conversation. */
export const MAX_UNANSWERED = 2;

const PATCHABLE_ORDER_STATUSES = new Set(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"]);

export interface DiscountRequest {
  requestedPct: number;
  capPct: number;
  currentDiscountPct: number;
  total: number;
  payLaterEligible: boolean;
  payLaterOffered: boolean;
  orderStatus: string | null;
}

export type DiscountDecision =
  | { ok: true; percent: number; newTotal: number; discountAmount: number }
  | { ok: false; reason: string };

export function discountedTotal(total: number, pct: number): number {
  return round2((Math.round(total * 100) * (100 - pct)) / 10000);
}

export function checkDiscount(req: DiscountRequest): DiscountDecision {
  const cap = Math.min(req.capPct, HARD_DISCOUNT_CAP_PCT);
  const pct = Number(req.requestedPct);
  if (!Number.isFinite(pct) || pct <= 0) return { ok: false, reason: "Discount must be a positive percentage." };
  if (pct > cap) return { ok: false, reason: `A ${pct}% discount exceeds the ${cap}% cap. Offer at most ${cap}%.` };
  if (req.currentDiscountPct > 0) return { ok: false, reason: "A discount has already been applied to this order." };
  if (req.payLaterEligible && !req.payLaterOffered) {
    return { ok: false, reason: "Offer PayPal Pay Later first; discounts are a second resort." };
  }
  if (req.orderStatus && !PATCHABLE_ORDER_STATUSES.has(req.orderStatus)) {
    return { ok: false, reason: `The PayPal order is ${req.orderStatus} and can no longer be changed.` };
  }
  const percent = round2(pct);
  const newTotal = discountedTotal(req.total, percent);
  return { ok: true, percent, newTotal, discountAmount: round2(req.total - newTotal) };
}

/** Minimum gap between two PayPal reminder emails for the same invoice. */
export const INVOICE_REMINDER_GAP_MS = 10 * 60_000;

export type ReminderDecision = { ok: true; invoiceId: string } | { ok: false; reason: string };

/** Reminders only ever go to the cart's own invoice, while it is unpaid, and not in quick succession. */
export function checkInvoiceReminder(req: {
  invoiceId: string | null;
  cartStatus: string;
  lastReminderAt: number | null;
  now: number;
}): ReminderDecision {
  if (!req.invoiceId) return { ok: false, reason: "No PayPal invoice has been sent for this order. Use create_and_send_invoice." };
  if (req.cartStatus === "recovered" || req.cartStatus === "paid") return { ok: false, reason: "This order is already paid." };
  if (req.lastReminderAt !== null && req.now - req.lastReminderAt < INVOICE_REMINDER_GAP_MS) {
    return { ok: false, reason: "PayPal already re-sent this invoice a few minutes ago. Point them to the invoice link instead." };
  }
  return { ok: true, invoiceId: req.invoiceId };
}

const OPT_OUT_EXACT = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "no",
  "nope",
  "nah",
  "no thanks",
  "no thank you",
  "not interested",
  "leave me alone",
]);

export function isOptOut(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?\s]+$/g, "");
  if (OPT_OUT_EXACT.has(t)) return true;
  return /\b(stop (messaging|texting|contacting)|unsubscribe|don'?t (message|text|contact) me|not interested|remove me)\b/.test(t);
}

export type Intent = "email" | "trust" | "price" | "ready" | "other";

/** Coarse objection classifier used by the scripted agent and passed to the model as a hint. */
export function classifyIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/(e-?mail|invoice|send (me )?(a |the )?bill|mail me)/.test(t)) return "email";
  if (/(trust|scam|safe|secure|legit|fraud|protect|refund|return|fake|real\?)/.test(t)) return "trust";
  if (/(pric|expens|cost|afford|cheap|discount|too much|money|budget|broke|pay later|instal|split|salary|payday)/.test(t)) return "price";
  if (/^(ok|okay|yes|yeah|yep|sure|alright|go ahead|send|let'?s|i'?ll|i will|ready|done)\b/.test(t.trim()) || /send (me )?(the )?link/.test(t)) {
    return "ready";
  }
  return "other";
}

export function canSendAgentMessage(conv: { status: string; unanswered: number }): boolean {
  return conv.status === "open" && conv.unanswered < MAX_UNANSWERED;
}

/** Pay in 4 (US): purchases from $30 to $1,500. The merchant page can override with SDK eligibility. */
export function payLaterEligibleFor(total: number, currency: string, sdkHint?: boolean): boolean {
  if (sdkHint === false) return false;
  return currency === "USD" && total >= 30 && total <= 1500;
}

export function payInFour(total: number): number {
  return Math.ceil((total / 4) * 100) / 100;
}
