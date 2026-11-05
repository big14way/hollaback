import { describe, expect, it } from "vitest";
import {
  coerceCart,
  extractOrderId,
  isCheckoutPage,
  isEmailField,
  isExitIntent,
  isPhoneField,
  normalizePhone,
  scoreCheckout,
} from "../src/detect";

const none = {
  path: "/",
  hasPayPalButtons: false,
  hasPayPalScript: false,
  hasEmailField: false,
  hasPhoneField: false,
  explicit: false,
};

describe("checkout detection", () => {
  it("ignores a plain landing page", () => {
    expect(isCheckoutPage(none)).toBe(false);
  });

  it("treats a page with PayPal buttons as checkout", () => {
    expect(isCheckoutPage({ ...none, hasPayPalButtons: true })).toBe(true);
  });

  it("treats a /checkout URL with a contact field as checkout", () => {
    expect(isCheckoutPage({ ...none, path: "/checkout", hasEmailField: true })).toBe(true);
  });

  it("does not fire on a /cart URL alone", () => {
    expect(isCheckoutPage({ ...none, path: "/cart" })).toBe(false);
  });

  it("honours an explicit data-hb-checkout marker", () => {
    expect(scoreCheckout({ ...none, explicit: true })).toBeGreaterThanOrEqual(3);
  });
});

describe("contact field heuristics", () => {
  it("recognises phone fields by type and by name", () => {
    expect(isPhoneField({ type: "tel" })).toBe(true);
    expect(isPhoneField({ type: "text", name: "whatsapp_number" })).toBe(true);
    expect(isPhoneField({ type: "text", name: "city" })).toBe(false);
  });

  it("recognises email fields", () => {
    expect(isEmailField({ type: "email" })).toBe(true);
    expect(isEmailField({ type: "text", autocomplete: "email" })).toBe(true);
    expect(isEmailField({ type: "text", name: "address" })).toBe(false);
  });

  it("normalises international phone numbers and rejects local-only ones", () => {
    expect(normalizePhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("00 44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("0803 123 4567")).toBeNull();
    expect(normalizePhone("+12")).toBeNull();
  });
});

describe("cart coercion", () => {
  it("computes totals and defaults quantities", () => {
    const cart = coerceCart({ items: [{ name: "Air Runners", price: "$89.00" }] });
    expect(cart).toEqual({ items: [{ name: "Air Runners", quantity: 1, unitPrice: 89 }], currency: "USD", total: 89 });
  });

  it("returns null for empty carts", () => {
    expect(coerceCart({ items: [] })).toBeNull();
    expect(coerceCart(null)).toBeNull();
  });
});

describe("order id extraction", () => {
  it("reads orderId from a merchant create-order response", () => {
    expect(extractOrderId({ orderId: "5O190127TN364715T" })).toBe("5O190127TN364715T");
  });

  it("reads a raw Orders v2 response only when it is still pending", () => {
    expect(extractOrderId({ id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED" })).toBe("5O190127TN364715T");
    expect(extractOrderId({ id: "5O190127TN364715T", status: "COMPLETED" })).toBeNull();
  });

  it("ignores unrelated JSON", () => {
    expect(extractOrderId({ id: 42 })).toBeNull();
    expect(extractOrderId({ orderId: "abc" })).toBeNull();
  });
});

describe("exit intent", () => {
  it("fires when the pointer leaves through the top edge", () => {
    expect(isExitIntent({ clientY: -2, relatedTarget: null })).toBe(true);
    expect(isExitIntent({ clientY: 300, relatedTarget: null })).toBe(false);
    expect(isExitIntent({ clientY: -2, relatedTarget: {} })).toBe(false);
  });
});
