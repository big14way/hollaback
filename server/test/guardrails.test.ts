import { describe, expect, it } from "vitest";
import {
  canSendAgentMessage,
  checkDiscount,
  checkInvoiceReminder,
  classifyIntent,
  discountedTotal,
  HARD_DISCOUNT_CAP_PCT,
  INVOICE_REMINDER_GAP_MS,
  isOptOut,
  payInFour,
  payLaterEligibleFor,
} from "../src/agent/guardrails.js";

const base = {
  requestedPct: 10,
  capPct: 10,
  currentDiscountPct: 0,
  total: 89,
  payLaterEligible: true,
  payLaterOffered: true,
  orderStatus: "PAYER_ACTION_REQUIRED",
};

describe("discount cap guard", () => {
  it("allows a discount at the cap and computes the new total", () => {
    expect(checkDiscount(base)).toEqual({ ok: true, percent: 10, newTotal: 80.1, discountAmount: 8.9 });
  });

  it("rejects anything above the cap", () => {
    const d = checkDiscount({ ...base, requestedPct: 15 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/exceeds the 10% cap/);
  });

  it("never exceeds the hard 10% ceiling even if configured higher", () => {
    expect(checkDiscount({ ...base, capPct: 50, requestedPct: 25 }).ok).toBe(false);
    expect(checkDiscount({ ...base, capPct: 50, requestedPct: HARD_DISCOUNT_CAP_PCT }).ok).toBe(true);
  });

  it("rejects zero, negative and non-numeric discounts", () => {
    expect(checkDiscount({ ...base, requestedPct: 0 }).ok).toBe(false);
    expect(checkDiscount({ ...base, requestedPct: -5 }).ok).toBe(false);
    expect(checkDiscount({ ...base, requestedPct: Number.NaN }).ok).toBe(false);
  });

  it("requires Pay Later to be offered first when the shopper is eligible", () => {
    expect(checkDiscount({ ...base, payLaterOffered: false }).ok).toBe(false);
    expect(checkDiscount({ ...base, payLaterEligible: false, payLaterOffered: false }).ok).toBe(true);
  });

  it("allows only one discount per order", () => {
    expect(checkDiscount({ ...base, currentDiscountPct: 5, requestedPct: 5 }).ok).toBe(false);
  });

  it("refuses to patch an order that is already completed", () => {
    expect(checkDiscount({ ...base, orderStatus: "COMPLETED" }).ok).toBe(false);
  });

  it("rounds to cents", () => {
    expect(discountedTotal(89, 10)).toBe(80.1);
    expect(discountedTotal(19.99, 7.5)).toBe(18.49);
  });
});

describe("conversation guards", () => {
  it("detects opt-out words without tripping on normal sentences", () => {
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut("no.")).toBe(true);
    expect(isOptOut("Please stop messaging me")).toBe(true);
    expect(isOptOut("no worries, send the link")).toBe(false);
    expect(isOptOut("bit pricey rn")).toBe(false);
  });

  it("stops after two unanswered agent messages", () => {
    expect(canSendAgentMessage({ status: "open", unanswered: 0 })).toBe(true);
    expect(canSendAgentMessage({ status: "open", unanswered: 1 })).toBe(true);
    expect(canSendAgentMessage({ status: "open", unanswered: 2 })).toBe(false);
    expect(canSendAgentMessage({ status: "closed", unanswered: 0 })).toBe(false);
  });

  it("classifies the common objections", () => {
    expect(classifyIntent("bit pricey rn")).toBe("price");
    expect(classifyIntent("just email me the invoice")).toBe("email");
    expect(classifyIntent("is this site legit?")).toBe("trust");
    expect(classifyIntent("ok send the link")).toBe("ready");
    expect(classifyIntent("what colours do you have")).toBe("other");
  });

  it("knows Pay in 4 eligibility and instalments", () => {
    expect(payLaterEligibleFor(89, "USD")).toBe(true);
    expect(payLaterEligibleFor(20, "USD")).toBe(false);
    expect(payLaterEligibleFor(89, "USD", false)).toBe(false);
    expect(payInFour(89)).toBe(22.25);
  });

  it("reminds only an unpaid invoice of this cart, and not twice in quick succession", () => {
    const now = Date.now();
    const req = { invoiceId: "INV2-AAAA", cartStatus: "contacted", lastReminderAt: null, now };
    expect(checkInvoiceReminder(req)).toEqual({ ok: true, invoiceId: "INV2-AAAA" });
    expect(checkInvoiceReminder({ ...req, invoiceId: null }).ok).toBe(false);
    expect(checkInvoiceReminder({ ...req, cartStatus: "recovered" }).ok).toBe(false);
    expect(checkInvoiceReminder({ ...req, lastReminderAt: now - 60_000 }).ok).toBe(false);
    expect(checkInvoiceReminder({ ...req, lastReminderAt: now - INVOICE_REMINDER_GAP_MS }).ok).toBe(true);
  });
});
