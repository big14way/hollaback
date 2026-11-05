import {
  coerceCart,
  extractOrderId,
  isCheckoutPage,
  isEmailField,
  isExitIntent,
  isPhoneField,
  isValidEmail,
  normalizePhone,
  type Cart,
} from "./detect";
import { AbandonTriggers, type AbandonReason } from "./triggers";

type EventType = "checkout_started" | "order_created" | "abandoned";

interface Contact {
  phone: string | null;
  email: string | null;
  name: string | null;
}

interface HollabackApi {
  sessionId: string;
  orderCreated(orderId: string): void;
  cancelled(orderId?: string): void;
  approved(orderId?: string): void;
  setCart(cart: unknown): void;
  setContact(contact: Partial<Contact>): void;
}

declare global {
  interface Window {
    Hollaback?: HollabackApi;
    hollabackCart?: unknown;
  }
}

(function boot() {
  if (window.Hollaback) return;

  const script = document.currentScript as HTMLScriptElement | null;
  const data = script ? script.dataset : ({} as DOMStringMap);
  const endpoint = (data.endpoint || (script && script.src ? new URL(script.src).origin : "")).replace(/\/$/, "");
  const merchantId = data.merchant || "demo";
  const debug = data.debug === "1";
  const eventsUrl = `${endpoint}/events`;
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  const log = (...a: unknown[]) => {
    if (debug) console.log("[hollaback]", ...a);
  };

  const sessionId = (() => {
    const key = "hb_sid";
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const id = `hb_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      sessionStorage.setItem(key, id);
      return id;
    } catch {
      return `hb_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
  })();

  const contact: Contact = { phone: null, email: null, name: null };
  let cart: Cart | null = null;
  let consentBox: HTMLInputElement | null = null;
  let started = false;
  const triggers = new AbandonTriggers();

  function readCart(): Cart | null {
    if (window.hollabackCart) return coerceCart(window.hollabackCart);
    const el = document.querySelector<HTMLElement>("[data-hb-cart]");
    if (el) {
      try {
        return coerceCart(JSON.parse(el.dataset.hbCart || "null"));
      } catch {
        /* fall through */
      }
    }
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-hb-item]")).map((n) => ({
      name: n.dataset.name || n.textContent || "",
      unitPrice: n.dataset.price,
      quantity: n.dataset.qty || 1,
      sku: n.dataset.sku,
    }));
    return items.length ? coerceCart({ items }) : null;
  }

  function send(type: EventType, extra: Record<string, unknown> = {}, beacon = false): void {
    const payload = {
      type,
      sessionId,
      merchantId,
      url: location.href,
      ts: Date.now(),
      cart: cart || readCart(),
      contact,
      consent: consentBox ? consentBox.checked : false,
      ...extra,
    };
    const body = JSON.stringify(payload);
    log(type, payload);
    try {
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(eventsUrl, new Blob([body], { type: "text/plain" }));
        return;
      }
      if (nativeFetch) {
        // text/plain keeps this a "simple" request: no CORS preflight.
        nativeFetch(eventsUrl, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(
          () => undefined,
        );
      }
    } catch {
      /* never break the merchant's page */
    }
  }

  function signal(reason: AbandonReason | null, beacon = false): void {
    if (!reason) return;
    send("abandoned", { orderId: triggers.currentOrderId, reason }, beacon);
  }

  function hints(input: HTMLInputElement) {
    return {
      type: input.type,
      name: input.name,
      id: input.id,
      autocomplete: input.getAttribute("autocomplete"),
      placeholder: input.placeholder,
    };
  }

  function scanFields(): { phone: HTMLInputElement | null; email: HTMLInputElement | null; name: HTMLInputElement | null } {
    let phone: HTMLInputElement | null = null;
    let email: HTMLInputElement | null = null;
    let name: HTMLInputElement | null = null;
    document.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
      const h = hints(input);
      if (!phone && isPhoneField(h)) phone = input;
      else if (!email && isEmailField(h)) email = input;
      else if (!name && /(^|\s)(name|full-?name|given-name)(\s|$)/i.test(`${h.name} ${h.autocomplete} ${h.id}`)) name = input;
    });
    return { phone, email, name };
  }

  function injectConsent(anchor: HTMLElement | null): void {
    consentBox = document.querySelector<HTMLInputElement>("input[data-hb-consent]");
    if (consentBox || !anchor) return;
    const label = document.createElement("label");
    label.className = "hb-consent";
    label.style.cssText = "display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.4;margin:8px 0;";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("data-hb-consent", "");
    const text = document.createElement("span");
    text.textContent =
      data.consentText ||
      "If I don't finish checkout, message me on WhatsApp about this order. Reply STOP anytime.";
    label.append(box, text);
    (anchor.closest("label, .field, .form-group, div") || anchor).insertAdjacentElement("afterend", label);
    consentBox = box;
  }

  let contactTimer: number | undefined;
  function captureContact(): void {
    const f = scanFields();
    const phone = normalizePhone(f.phone && f.phone.value);
    const email = f.email && isValidEmail(f.email.value) ? f.email.value.trim() : null;
    const name = f.name && f.name.value.trim() ? f.name.value.trim().slice(0, 80) : null;
    const changed = phone !== contact.phone || email !== contact.email || name !== contact.name;
    contact.phone = phone || contact.phone;
    contact.email = email || contact.email;
    contact.name = name || contact.name;
    if (changed && started) send("checkout_started", { update: true });
  }

  function orderCreated(orderId: string): void {
    if (!triggers.orderCreated(orderId, Date.now())) return;
    send("order_created", { orderId });
  }

  function watchFetch(): void {
    if (!nativeFetch) return;
    window.fetch = function patched(input: RequestInfo | URL, init?: RequestInit) {
      const res = nativeFetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.indexOf(eventsUrl) === 0) return res;
      res
        .then((r) => {
          const type = r.headers.get("content-type") || "";
          if (!r.ok || type.indexOf("json") === -1) return;
          return r
            .clone()
            .json()
            .then((json: unknown) => {
              const id = extractOrderId(json);
              if (id) orderCreated(id);
            });
        })
        .catch(() => undefined);
      return res;
    } as typeof window.fetch;
  }

  function start(): void {
    const f = scanFields();
    const signals = {
      path: location.pathname + location.search,
      hasPayPalButtons: !!document.querySelector("paypal-button, paypal-pay-later-button, [data-funding-source]"),
      hasPayPalScript: !!document.querySelector('script[src*="paypal.com"]'),
      hasEmailField: !!f.email,
      hasPhoneField: !!f.phone,
      explicit: document.querySelector("[data-hb-checkout]") !== null,
    };
    if (!isCheckoutPage(signals)) {
      log("not a checkout page", signals);
      return;
    }
    cart = readCart();
    injectConsent(f.phone || f.email);
    captureContact();
    started = true;
    send("checkout_started");
    watchFetch();

    document.addEventListener(
      "input",
      () => {
        window.clearTimeout(contactTimer);
        contactTimer = window.setTimeout(captureContact, 700);
      },
      true,
    );
    document.addEventListener("change", (e) => {
      if (e.target === consentBox && started) send("checkout_started", { update: true });
    });

    const activity = () => triggers.activity(Date.now());
    ["keydown", "pointerdown", "scroll", "touchstart"].forEach((t) =>
      window.addEventListener(t, activity, { passive: true, capture: true }),
    );
    let lastMove = 0;
    window.addEventListener(
      "mousemove",
      () => {
        const now = Date.now();
        if (now - lastMove > 1000) {
          lastMove = now;
          triggers.activity(now);
        }
      },
      { passive: true },
    );
    document.addEventListener("visibilitychange", () => triggers.visibility(document.hidden, Date.now()));
    window.addEventListener("blur", () => triggers.focus(false, Date.now()));
    window.addEventListener("focus", () => triggers.focus(true, Date.now()));
    document.addEventListener("mouseout", (e) => {
      if (isExitIntent(e)) signal(triggers.fire("exit_intent"));
    });
    window.addEventListener("pagehide", () => signal(triggers.fire("pagehide"), true));
    window.setInterval(() => signal(triggers.tick(Date.now())), 1000);
  }

  window.Hollaback = {
    sessionId,
    orderCreated,
    cancelled(orderId?: string) {
      if (orderId) orderCreated(orderId);
      signal(triggers.fire("cancel"));
    },
    approved() {
      triggers.approve();
    },
    setCart(next: unknown) {
      cart = coerceCart(next);
    },
    setContact(next: Partial<Contact>) {
      if (next.phone !== undefined) contact.phone = normalizePhone(next.phone);
      if (next.email !== undefined) contact.email = isValidEmail(next.email) ? next.email : null;
      if (next.name !== undefined) contact.name = next.name;
      if (started) send("checkout_started", { update: true });
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
