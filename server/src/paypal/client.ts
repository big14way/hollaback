import type {
  CreateOrderRequest,
  InvoiceDraft,
  LinkDescription,
  PatchOperation,
  PayPalInvoice,
  PayPalOrder,
  VerifySignatureInput,
} from "./types.js";

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string,
    message: string,
    readonly details: unknown,
    readonly debugId?: string,
  ) {
    super(`PayPal ${status} ${errorName}: ${message}`);
    this.name = "PayPalApiError";
  }

  /** First `details[].issue` code, e.g. ORDER_NOT_APPROVED. */
  get issue(): string | undefined {
    const d = this.details as Array<{ issue?: string }> | undefined;
    return Array.isArray(d) ? d[0]?.issue : undefined;
  }
}

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  apiBase: string;
  fetch?: typeof fetch;
}

/**
 * Minimal REST client for the PayPal endpoints Hollaback uses:
 * OAuth2 token, Orders v2, Invoicing v2 and Webhooks (notifications).
 */
export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: PayPalClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get apiBase(): string {
    return this.opts.apiBase;
  }

  /** POST /v1/oauth2/token (client_credentials), cached until shortly before expiry. */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.opts.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      throw new PayPalApiError(res.status, data.error || "AUTHENTICATION_FAILURE", data.error_description || "token request failed", null);
    }
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; data: T }> {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const send = async () =>
      this.fetchImpl(`${this.opts.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body: payload,
      });
    let res = await send();
    // A cached token can be stale: revoked early (401), or minted before a feature such as Invoicing
    // was enabled on the app, so it lacks that scope (403). Fetch a fresh token and retry once.
    if (res.status === 401 || res.status === 403) {
      this.token = null;
      res = await send();
    }
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const e = (data || {}) as { name?: string; message?: string; details?: unknown; debug_id?: string };
      throw new PayPalApiError(res.status, e.name || "HTTP_ERROR", e.message || res.statusText, e.details, e.debug_id);
    }
    return { status: res.status, data: data as T };
  }

  /** POST /v2/checkout/orders */
  async createOrder(body: CreateOrderRequest, requestId?: string): Promise<PayPalOrder> {
    const headers: Record<string, string> = { Prefer: "return=representation" };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    return (await this.request<PayPalOrder>("POST", "/v2/checkout/orders", body, headers)).data;
  }

  /** GET /v2/checkout/orders/{id} */
  async getOrder(id: string): Promise<PayPalOrder> {
    return (await this.request<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`)).data;
  }

  /** PATCH /v2/checkout/orders/{id} (204 No Content) */
  async patchOrder(id: string, ops: PatchOperation[]): Promise<void> {
    await this.request("PATCH", `/v2/checkout/orders/${encodeURIComponent(id)}`, ops);
  }

  /** POST /v2/checkout/orders/{id}/capture */
  async captureOrder(id: string, requestId?: string): Promise<PayPalOrder> {
    const headers: Record<string, string> = { Prefer: "return=representation" };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    return (await this.request<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, headers)).data;
  }

  /** POST /v2/invoicing/invoices, returns the new draft invoice id. */
  async createInvoice(draft: InvoiceDraft): Promise<string> {
    const { data } = await this.request<Partial<PayPalInvoice> & { href?: string }>(
      "POST",
      "/v2/invoicing/invoices",
      draft,
      { Prefer: "return=representation" },
    );
    const id = data.id || (data.href ? data.href.split("/").pop() : undefined);
    if (!id) throw new PayPalApiError(500, "INVALID_RESPONSE", "invoice id missing from create response", data);
    return id;
  }

  /** POST /v2/invoicing/invoices/{id}/send */
  async sendInvoice(id: string): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
      send_to_recipient: true,
      send_to_invoicer: false,
    });
  }

  /** GET /v2/invoicing/invoices/{id} */
  async getInvoice(id: string): Promise<PayPalInvoice> {
    return (await this.request<PayPalInvoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`)).data;
  }

  /**
   * POST /v1/notifications/verify-webhook-signature.
   * The raw request body is embedded verbatim so re-serialisation can't break the signature.
   */
  async verifyWebhookSignature({ headers, rawBody, webhookId }: VerifySignatureInput): Promise<boolean> {
    const h = (name: string) => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    const fields = {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
    };
    if (Object.values(fields).some((v) => !v)) return false;
    const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
    const { data } = await this.request<{ verification_status?: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      body,
    );
    return data.verification_status === "SUCCESS";
  }

  /** POST /v1/notifications/webhooks */
  async createWebhook(url: string, eventTypes: readonly string[]): Promise<{ id: string; url: string }> {
    return (
      await this.request<{ id: string; url: string }>("POST", "/v1/notifications/webhooks", {
        url,
        event_types: eventTypes.map((name) => ({ name })),
      })
    ).data;
  }

  /** GET /v1/notifications/webhooks */
  async listWebhooks(): Promise<Array<{ id: string; url: string; event_types: Array<{ name: string }> }>> {
    const { data } = await this.request<{ webhooks?: Array<{ id: string; url: string; event_types: Array<{ name: string }> }> }>(
      "GET",
      "/v1/notifications/webhooks",
    );
    return data.webhooks ?? [];
  }

  /** POST /v1/notifications/simulate-event */
  async simulateEvent(input: { webhookId?: string; url?: string; eventType: string; resourceVersion?: string }): Promise<unknown> {
    const body: Record<string, string> = { event_type: input.eventType };
    if (input.webhookId) body.webhook_id = input.webhookId;
    if (input.url) body.url = input.url;
    if (input.resourceVersion) body.resource_version = input.resourceVersion;
    return (await this.request("POST", "/v1/notifications/simulate-event", body)).data;
  }
}

/** The link the shopper follows to approve: rel "payer-action" (with payment_source) or "approve". */
export function payerActionUrl(order: Pick<PayPalOrder, "links">): string | null {
  const links: LinkDescription[] = order.links ?? [];
  return (links.find((l) => l.rel === "payer-action") ?? links.find((l) => l.rel === "approve"))?.href ?? null;
}

export function money(value: number, currency: string) {
  return { currency_code: currency, value: value.toFixed(2) };
}
