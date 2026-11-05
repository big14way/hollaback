/**
 * Pure checkout-detection heuristics. Everything here is side-effect free so it
 * can be unit tested without a browser.
 */

export interface CheckoutSignals {
  /** location.pathname + location.search */
  path: string;
  /** <paypal-button>, <paypal-pay-later-button> or legacy [data-funding-source] present */
  hasPayPalButtons: boolean;
  /** A PayPal SDK <script> (v6 core or legacy sdk/js) is on the page */
  hasPayPalScript: boolean;
  hasEmailField: boolean;
  hasPhoneField: boolean;
  /** The merchant marked the page with data-hb-checkout */
  explicit: boolean;
}

const CHECKOUT_PATH = /(check-?out|cart|basket|bag|payment|pay\b|order)/i;

/** Score how likely a page is a checkout page. 3+ means "treat as checkout". */
export function scoreCheckout(s: CheckoutSignals): number {
  if (s.explicit) return 10;
  let score = 0;
  if (CHECKOUT_PATH.test(s.path)) score += 2;
  if (s.hasPayPalButtons) score += 3;
  else if (s.hasPayPalScript) score += 2;
  if (s.hasEmailField) score += 1;
  if (s.hasPhoneField) score += 1;
  return score;
}

export function isCheckoutPage(s: CheckoutSignals): boolean {
  return scoreCheckout(s) >= 3;
}

export interface FieldHints {
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  placeholder?: string | null;
}

function hintText(f: FieldHints): string {
  return [f.name, f.id, f.autocomplete, f.placeholder].filter(Boolean).join(" ").toLowerCase();
}

export function isPhoneField(f: FieldHints): boolean {
  if ((f.type || "").toLowerCase() === "tel") return true;
  return /(phone|mobile|whatsapp|\btel\b|cell)/.test(hintText(f));
}

export function isEmailField(f: FieldHints): boolean {
  if ((f.type || "").toLowerCase() === "email") return true;
  return /e-?mail/.test(hintText(f));
}

/** Normalise to E.164-ish "+<digits>". Returns null when it can't be a phone number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  if (!hasPlus) return null;
  return `+${digits}`;
}

export function isValidEmail(raw: string | null | undefined): boolean {
  return !!raw && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export interface CartItem {
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Cart {
  items: CartItem[];
  currency: string;
  total: number;
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Coerce whatever the merchant exposes (window.hollabackCart or data-hb-cart JSON) into a Cart. */
export function coerceCart(input: unknown, fallbackCurrency = "USD"): Cart | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : Array.isArray(input) ? (input as unknown[]) : [];
  const items: CartItem[] = rawItems
    .map((r) => {
      const it = (r || {}) as Record<string, unknown>;
      const name = String(it.name ?? it.title ?? "").trim();
      if (!name) return null;
      const item: CartItem = {
        name,
        quantity: Math.max(1, Math.round(toNumber(it.quantity ?? it.qty ?? 1))),
        unitPrice: toNumber(it.unitPrice ?? it.unit_price ?? it.price),
      };
      if (it.sku != null) item.sku = String(it.sku);
      return item;
    })
    .filter((x): x is CartItem => x !== null);
  if (!items.length) return null;
  const computed = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const total = obj.total != null ? toNumber(obj.total) : computed;
  const currency = String(obj.currency ?? obj.currencyCode ?? fallbackCurrency).toUpperCase();
  return { items, currency, total: Math.round(total * 100) / 100 };
}

const PAYPAL_ORDER_ID = /^[A-Z0-9]{12,20}$/;

/**
 * Detect a PayPal order id in a JSON response the merchant's page received
 * (e.g. from its own create-order endpoint). Returns null when nothing matches.
 */
export function extractOrderId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  for (const key of ["orderId", "orderID", "order_id"]) {
    const v = o[key];
    if (typeof v === "string" && PAYPAL_ORDER_ID.test(v)) return v;
  }
  const status = typeof o.status === "string" ? o.status : "";
  if (typeof o.id === "string" && PAYPAL_ORDER_ID.test(o.id) && /^(CREATED|PAYER_ACTION_REQUIRED|SAVED)$/.test(status)) {
    return o.id;
  }
  return null;
}

/** Exit intent: the pointer leaves through the top edge of the viewport. */
export function isExitIntent(e: { clientY: number; relatedTarget: unknown }): boolean {
  return e.relatedTarget == null && e.clientY <= 0;
}
