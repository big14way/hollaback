import { randomBytes, randomUUID } from "node:crypto";
import type {
  CreateOrderRequest,
  InvoiceDraft,
  PatchOperation,
  PayPalInvoice,
  PayPalOrder,
  PurchaseUnit,
  WebhookEvent,
} from "./types.js";

/**
 * In-process fake of the PayPal REST endpoints Hollaback calls (OAuth2, Orders v2,
 * Invoicing v2, Webhooks). It is plugged in as the `fetch` implementation of the real
 * PayPalClient, so mock mode exercises exactly the same request-building code that
 * talks to the sandbox. Validation mirrors the rules the sandbox enforces (item totals,
 * amount breakdowns, approval before capture).
 */

type Handler = (req: { method: string; path: string; body: unknown; headers: Headers }) => Response | Promise<Response>;

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

function orderId(): string {
  const bytes = randomBytes(17);
  return Array.from(bytes, (b) => ALNUM[b % ALNUM.length]).join("");
}

function invoiceId(): string {
  const part = () => Array.from(randomBytes(4), (b) => ALNUM[b % ALNUM.length]).join("");
  return `INV2-${part()}-${part()}-${part()}-${part()}`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function error(status: number, name: string, issue: string, description: string): Response {
  return json(status, {
    name,
    message: description,
    debug_id: randomBytes(6).toString("hex"),
    details: [{ issue, description }],
  });
}

const cents = (v: string | number | undefined) => Math.round(Number(v ?? 0) * 100);

function validateUnit(unit: PurchaseUnit): string | null {
  const b = unit.amount.breakdown;
  if (unit.items?.length) {
    if (!b?.item_total) return "ITEM_TOTAL_REQUIRED";
    const sum = unit.items.reduce((s, i) => s + cents(i.unit_amount.value) * Number(i.quantity), 0);
    if (sum !== cents(b.item_total.value)) return "ITEM_TOTAL_MISMATCH";
  }
  if (b) {
    const expected =
      cents(b.item_total?.value) + cents(b.shipping?.value) + cents(b.tax_total?.value) - cents(b.discount?.value);
    if (expected !== cents(unit.amount.value)) return "AMOUNT_MISMATCH";
  }
  return null;
}

export class MockPayPal {
  readonly orders = new Map<string, PayPalOrder>();
  readonly invoices = new Map<string, PayPalInvoice>();
  readonly webhooks: Array<{ id: string; url: string; event_types: Array<{ name: string }> }> = [];
  readonly requests: Array<{ method: string; path: string; body?: unknown }> = [];
  private returnUrls = new Map<string, { returnUrl?: string; cancelUrl?: string }>();
  /** Where emitted webhook events go (the server wires this to its own /webhooks/paypal route). */
  onEvent: (event: WebhookEvent) => void | Promise<void> = () => undefined;

  constructor(private readonly publicUrl: string) {}

  /** Drop-in replacement for global fetch, scoped to the PayPal API host. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    let body: unknown = undefined;
    if (typeof init?.body === "string" && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    this.requests.push({ method, path: url.pathname, body });
    for (const [pattern, m, handler] of this.routes) {
      const match = url.pathname.match(pattern);
      if (match && m === method) {
        return handler({ method, path: url.pathname, body, headers });
      }
    }
    return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", `mock: no route for ${method} ${url.pathname}`);
  };

  private get routes(): Array<[RegExp, string, Handler]> {
    return [
      [/^\/v1\/oauth2\/token$/, "POST", () => this.token()],
      [/^\/v2\/checkout\/orders$/, "POST", ({ body }) => this.createOrder(body as CreateOrderRequest)],
      [/^\/v2\/checkout\/orders\/[^/]+$/, "GET", ({ path }) => this.getOrder(path.split("/")[4]!)],
      [/^\/v2\/checkout\/orders\/[^/]+$/, "PATCH", ({ path, body }) => this.patchOrder(path.split("/")[4]!, body as PatchOperation[])],
      [/^\/v2\/checkout\/orders\/[^/]+\/capture$/, "POST", ({ path }) => this.captureOrder(path.split("/")[4]!)],
      [/^\/v2\/invoicing\/invoices$/, "POST", ({ body, headers }) => this.createInvoice(body as InvoiceDraft, headers)],
      [/^\/v2\/invoicing\/invoices\/[^/]+$/, "GET", ({ path }) => this.getInvoice(path.split("/")[4]!)],
      [/^\/v2\/invoicing\/invoices\/[^/]+\/send$/, "POST", ({ path }) => this.sendInvoice(path.split("/")[4]!)],
      [/^\/v2\/invoicing\/invoices\/[^/]+\/remind$/, "POST", ({ path }) => this.remindInvoice(path.split("/")[4]!)],
      [/^\/v1\/notifications\/verify-webhook-signature$/, "POST", () => json(200, { verification_status: "SUCCESS" })],
      [/^\/v1\/notifications\/webhooks$/, "POST", ({ body }) => this.createWebhook(body as { url: string; event_types: Array<{ name: string }> })],
      [/^\/v1\/notifications\/webhooks$/, "GET", () => json(200, { webhooks: this.webhooks })],
      [/^\/v1\/notifications\/simulate-event$/, "POST", ({ body }) => this.simulateEvent(body as { event_type: string })],
    ];
  }

  private token(): Response {
    return json(200, { access_token: `mock-${randomUUID()}`, token_type: "Bearer", expires_in: 32400, app_id: "APP-MOCK" });
  }

  private createOrder(body: CreateOrderRequest): Response {
    if (!body?.intent || !Array.isArray(body.purchase_units) || !body.purchase_units.length) {
      return error(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "intent and purchase_units are required");
    }
    for (const unit of body.purchase_units) {
      const issue = validateUnit(unit);
      if (issue) return error(422, "UNPROCESSABLE_ENTITY", issue, `mock: ${issue}`);
    }
    const id = orderId();
    const ctx = body.payment_source?.paypal?.experience_context;
    const now = new Date().toISOString();
    const approve = `${this.publicUrl}/mock/paypal/checkoutnow?token=${id}`;
    const order: PayPalOrder = {
      id,
      intent: body.intent,
      status: ctx ? "PAYER_ACTION_REQUIRED" : "CREATED",
      purchase_units: structuredClone(body.purchase_units).map((u) => ({ reference_id: "default", ...u })),
      create_time: now,
      update_time: now,
      links: [
        { href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${id}`, rel: "self", method: "GET" },
        { href: approve, rel: ctx ? "payer-action" : "approve", method: "GET" },
      ],
    };
    this.orders.set(id, order);
    this.returnUrls.set(id, { returnUrl: ctx?.return_url, cancelUrl: ctx?.cancel_url });
    return json(201, order);
  }

  private getOrder(id: string): Response {
    const order = this.orders.get(id);
    return order ? json(200, order) : error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "order not found");
  }

  private patchOrder(id: string, ops: PatchOperation[]): Response {
    const order = this.orders.get(id);
    if (!order) return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "order not found");
    if (!["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(order.status)) {
      return error(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_COMPLETED", "order can no longer be patched");
    }
    const next = structuredClone(order);
    for (const op of ops ?? []) {
      const m = op.path.match(/^\/purchase_units\/@reference_id=='([^']+)'\/amount$/);
      if (op.op !== "replace" || !m) {
        return error(422, "UNPROCESSABLE_ENTITY", "PATCH_PATH_NOT_SUPPORTED", `mock supports amount replace only (${op.path})`);
      }
      const unit = next.purchase_units?.find((u) => u.reference_id === m[1]);
      if (!unit) return error(422, "UNPROCESSABLE_ENTITY", "INVALID_PATCH_PATH", `no purchase unit ${m[1]}`);
      unit.amount = op.value as PurchaseUnit["amount"];
      const issue = validateUnit(unit);
      if (issue) return error(422, "UNPROCESSABLE_ENTITY", issue, `mock: ${issue}`);
    }
    next.update_time = new Date().toISOString();
    this.orders.set(id, next);
    return new Response(null, { status: 204 });
  }

  private async captureOrder(id: string): Promise<Response> {
    const order = this.orders.get(id);
    if (!order) return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "order not found");
    if (order.status === "COMPLETED") return error(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED", "already captured");
    if (order.status !== "APPROVED") return error(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED", "payer has not approved");
    const unit = order.purchase_units![0]!;
    const capture = { id: orderId(), status: "COMPLETED", amount: { ...unit.amount, breakdown: undefined } };
    delete (capture.amount as { breakdown?: unknown }).breakdown;
    unit.payments = { captures: [capture] };
    order.status = "COMPLETED";
    order.update_time = new Date().toISOString();
    await this.emit("PAYMENT.CAPTURE.COMPLETED", {
      ...capture,
      supplementary_data: { related_ids: { order_id: id } },
    });
    return json(201, order);
  }

  private createInvoice(draft: InvoiceDraft, headers: Headers): Response {
    const email = draft?.primary_recipients?.[0]?.billing_info?.email_address;
    if (!draft?.detail?.currency_code || !email || !draft.items?.length) {
      return error(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "currency_code, recipient email and items are required");
    }
    const id = invoiceId();
    const total = draft.items.reduce((s, i) => s + cents(i.unit_amount.value) * Number(i.quantity), 0) / 100;
    const invoice: PayPalInvoice = {
      id,
      status: "DRAFT",
      detail: {
        ...draft.detail,
        invoice_number: draft.detail.invoice_number ?? String(this.invoices.size + 1).padStart(4, "0"),
        metadata: { create_time: new Date().toISOString() },
      },
      primary_recipients: draft.primary_recipients,
      items: draft.items,
      amount: { currency_code: draft.detail.currency_code, value: total.toFixed(2) },
      links: [{ href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}`, rel: "self", method: "GET" }],
    };
    this.invoices.set(id, invoice);
    if ((headers.get("prefer") || "").includes("return=representation")) return json(201, invoice);
    return json(201, { rel: "self", href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}`, method: "GET" });
  }

  private getInvoice(id: string): Response {
    const inv = this.invoices.get(id);
    return inv ? json(200, inv) : error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "invoice not found");
  }

  private sendInvoice(id: string): Response {
    const inv = this.invoices.get(id);
    if (!inv) return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "invoice not found");
    if (inv.status !== "DRAFT") return error(422, "UNPROCESSABLE_ENTITY", "CANT_SEND", "invoice already sent");
    inv.status = "SENT";
    const view = `${this.publicUrl}/mock/paypal/invoice?id=${id}`;
    inv.detail.metadata = { ...inv.detail.metadata, recipient_view_url: view };
    return json(200, { links: [{ href: view, rel: "payer-view", method: "GET" }] });
  }

  private remindInvoice(id: string): Response {
    const inv = this.invoices.get(id);
    if (!inv) return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "invoice not found");
    if (inv.status !== "SENT" && inv.status !== "UNPAID") return error(422, "UNPROCESSABLE_ENTITY", "CANT_REMIND", `invoice is ${inv.status}`);
    return new Response(null, { status: 204 });
  }

  private createWebhook(body: { url: string; event_types: Array<{ name: string }> }): Response {
    const hook = { id: `WH-MOCK-${randomBytes(6).toString("hex").toUpperCase()}`, url: body.url, event_types: body.event_types };
    this.webhooks.push(hook);
    return json(201, hook);
  }

  private async simulateEvent(body: { event_type: string }): Promise<Response> {
    const event = await this.emit(body.event_type, { id: orderId(), status: "APPROVED", simulated: true });
    return json(202, event);
  }

  private async emit(eventType: string, resource: Record<string, unknown>): Promise<WebhookEvent> {
    const event: WebhookEvent = {
      id: `WH-${randomBytes(8).toString("hex").toUpperCase()}`,
      event_type: eventType,
      resource_type: eventType.startsWith("INVOICING") ? "invoices" : eventType.startsWith("PAYMENT") ? "capture" : "checkout-order",
      summary: `mock ${eventType}`,
      create_time: new Date().toISOString(),
      resource,
    };
    await this.onEvent(event);
    return event;
  }

  // ---- Shopper-side actions (what the PayPal approval page / invoice page would do) ----

  /** The shopper approves the order on PayPal. Emits CHECKOUT.ORDER.APPROVED. */
  async approveOrder(id: string): Promise<{ order: PayPalOrder; returnUrl?: string }> {
    const order = this.orders.get(id);
    if (!order) throw new Error(`mock: unknown order ${id}`);
    if (order.status === "CREATED" || order.status === "PAYER_ACTION_REQUIRED") {
      order.status = "APPROVED";
      order.payer = { email_address: "shopper@example.com", name: { given_name: "Sandbox", surname: "Shopper" } };
      order.update_time = new Date().toISOString();
      await this.emit("CHECKOUT.ORDER.APPROVED", structuredClone(order) as unknown as Record<string, unknown>);
    }
    const urls = this.returnUrls.get(id);
    return { order, returnUrl: urls?.returnUrl ? `${urls.returnUrl}${urls.returnUrl.includes("?") ? "&" : "?"}token=${id}` : undefined };
  }

  cancelUrl(id: string): string | undefined {
    const u = this.returnUrls.get(id)?.cancelUrl;
    return u ? `${u}${u.includes("?") ? "&" : "?"}token=${id}` : undefined;
  }

  /** The shopper pays the invoice. Emits INVOICING.INVOICE.PAID. */
  async payInvoice(id: string): Promise<PayPalInvoice> {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`mock: unknown invoice ${id}`);
    if (inv.status !== "PAID") {
      inv.status = "PAID";
      await this.emit("INVOICING.INVOICE.PAID", { invoice: structuredClone(inv) as unknown as Record<string, unknown> });
    }
    return inv;
  }

  /** Test helper: force a status (e.g. VOIDED) without emitting events. */
  setOrderStatus(id: string, status: PayPalOrder["status"]): void {
    const order = this.orders.get(id);
    if (order) order.status = status;
  }
}
