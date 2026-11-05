import { describe, expect, it } from "vitest";
import { buildOrderRequest } from "../src/orders.js";
import { loadConfig } from "../src/config.js";
import { PayPalClient, payerActionUrl } from "../src/paypal/client.js";
import { validateTwilioSignature } from "../src/channels/twilio.js";
import { createHmac } from "node:crypto";
import type { Cart } from "../src/store/types.js";

describe("PayPal client", () => {
  it("embeds the raw webhook body verbatim when verifying signatures", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      return new Response(JSON.stringify({ verification_status: "SUCCESS" }));
    };
    const client = new PayPalClient({ clientId: "a", clientSecret: "b", apiBase: "https://api-m.sandbox.paypal.com", fetch: fetchImpl });
    const raw = '{"id":"WH-1","event_type":"CHECKOUT.ORDER.APPROVED","resource":{"id":"ABC","amount":1.10}}';
    const ok = await client.verifyWebhookSignature({
      rawBody: raw,
      webhookId: "WH-ID",
      headers: {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
        "paypal-transmission-id": "tid",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2026-11-05T10:00:00Z",
      },
    });
    expect(ok).toBe(true);
    const verify = calls.find((c) => c.url.endsWith("/v1/notifications/verify-webhook-signature"))!;
    expect(verify.body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(verify.body).webhook_id).toBe("WH-ID");
  });

  it("refreshes a stale token once when PayPal answers 403, then succeeds", async () => {
    let tokens = 0;
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        tokens += 1;
        return new Response(JSON.stringify({ access_token: `t${tokens}`, expires_in: 32000 }));
      }
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      seen.push(auth);
      if (auth === "Bearer t1") return new Response(JSON.stringify({ name: "NOT_AUTHORIZED", message: "scope" }), { status: 403 });
      return new Response(JSON.stringify({ id: "INV2-1", status: "DRAFT" }), { status: 201 });
    };
    const client = new PayPalClient({ clientId: "a", clientSecret: "b", apiBase: "https://x", fetch: fetchImpl });
    const res = await client.request<{ id: string }>("POST", "/v2/invoicing/invoices", { detail: {} });
    expect(res.data.id).toBe("INV2-1");
    expect(seen).toEqual(["Bearer t1", "Bearer t2"]);
    expect(tokens).toBe(2);
  });

  it("does not loop when a fresh token is still refused", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 32000 }));
      calls += 1;
      return new Response(JSON.stringify({ name: "NOT_AUTHORIZED", message: "no" }), { status: 403 });
    };
    const client = new PayPalClient({ clientId: "a", clientSecret: "b", apiBase: "https://x", fetch: fetchImpl });
    await expect(client.request("GET", "/v2/invoicing/invoices")).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(2);
  });

  it("refuses to verify when PayPal headers are missing", async () => {
    const client = new PayPalClient({ clientId: "a", clientSecret: "b", apiBase: "https://x", fetch: async () => new Response("{}") });
    expect(await client.verifyWebhookSignature({ rawBody: "{}", webhookId: "W", headers: {} })).toBe(false);
  });

  it("prefers the payer-action link", () => {
    expect(
      payerActionUrl({
        links: [
          { rel: "self", href: "https://api/self" },
          { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=X" },
        ],
      }),
    ).toBe("https://www.sandbox.paypal.com/checkoutnow?token=X");
  });

  it("builds an Orders v2 body with PAY_NOW and a consistent breakdown", () => {
    const config = loadConfig({ MOCK_PAYPAL: "1" });
    const cart = {
      id: "cart-1",
      items: [
        { name: "Air Runners", quantity: 1, unitPrice: 89 },
        { name: "Socks", quantity: 2, unitPrice: 5.5 },
      ],
      currency: "USD",
      discountPct: 10,
    } as Cart;
    const body = buildOrderRequest(cart, config);
    const unit = body.purchase_units[0]!;
    expect(body.payment_source?.paypal?.experience_context?.user_action).toBe("PAY_NOW");
    expect(unit.reference_id).toBe("cart-1");
    expect(unit.amount.breakdown?.item_total?.value).toBe("100.00");
    expect(unit.amount.breakdown?.discount?.value).toBe("10.00");
    expect(unit.amount.value).toBe("90.00");
  });
});

describe("Twilio signature", () => {
  it("validates the documented HMAC-SHA1 scheme", () => {
    const url = "https://hb.example.com/whatsapp/inbound";
    const params = { From: "whatsapp:+2348031234567", Body: "hi" };
    const data = url + "Body" + "hi" + "From" + "whatsapp:+2348031234567";
    const sig = createHmac("sha1", "token").update(data).digest("base64");
    expect(validateTwilioSignature("token", url, params, sig)).toBe(true);
    expect(validateTwilioSignature("token", url, { ...params, Body: "tampered" }, sig)).toBe(false);
  });
});
