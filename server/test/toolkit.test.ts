import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { MockLanguageModelV2 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAgent } from "../src/agent/llm.js";
import { TOOLKIT_ACTIONS, ToolkitBridge, type ToolkitTool } from "../src/agent/toolkit.js";
import { loadConfig } from "../src/config.js";
import type { MockPayPal } from "../src/paypal/mock.js";
import type { Cart, Conversation, Message, ToolCallLog } from "../src/store/types.js";
import { makeApp, PHONE, startCheckout, waitFor, type TestApp } from "./helpers.js";

type CartView = { cart: Cart; conversations: Array<Conversation & { messages: Message[] }> };
type Input = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let t: TestApp;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.app.close();
});

async function cartView(id: string) {
  return (await t.get<CartView>(`/api/carts/${id}`)).body;
}

const toolCalls = (view: CartView): ToolCallLog[] => view.conversations.flatMap((c) => c.messages).flatMap((m) => (m.toolCall ? [m.toolCall] : []));

async function abandon(sessionId: string) {
  const order = await startCheckout(t, { sessionId });
  await t.post("/events", { type: "abandoned", sessionId, orderId: order.orderId, reason: "cancel" });
  await waitFor(() => t.outbox.length >= 1);
  return order;
}

/**
 * The real toolkit's tools, so every input Hollaback builds is parsed with the toolkit's own
 * schemas, with execute swapped for calls into the PayPal mock (the toolkit only talks to PayPal).
 * Results come back the way the toolkit returns them: JSON strings, with PayPal HTTP errors as
 * `{ ok: false, status, code, message }`.
 */
function stubToolkit(mock: () => MockPayPal, replace: Record<string, (input: Input) => Promise<string>> = {}) {
  const real = new PayPalAgentToolkit({
    clientId: "test",
    clientSecret: "test",
    configuration: { actions: TOOLKIT_ACTIONS, context: { sandbox: true } },
  }).getTools() as unknown as Record<string, ToolkitTool>;
  const calls: Array<{ name: string; input: Input }> = [];
  const rest = async (method: string, path: string, body?: unknown) => {
    const res = await mock().fetch(`https://api-m.sandbox.paypal.com${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : "";
    return JSON.stringify(res.ok ? data : { ok: false, status: res.status, code: "PAYPAL_API_HTTP_ERROR", message: data.message });
  };
  const behaviour: Record<string, (i: Input) => Promise<string>> = {
    get_order: (i) => rest("GET", `/v2/checkout/orders/${i.id}`),
    create_invoice: (i) =>
      rest("POST", "/v2/invoicing/invoices", {
        detail: { currency_code: i.currency_code, reference: i.reference, note: i.note },
        invoicer: { business_name: i.invoicer_business_name },
        primary_recipients: i.primary_recipients,
        items: i.items,
      }),
    send_invoice: (i) => rest("POST", `/v2/invoicing/invoices/${i.invoice_id}/send`, { send_to_recipient: i.send_to_recipient }),
    get_invoice: (i) => rest("GET", `/v2/invoicing/invoices/${i.invoice_id}`),
    send_invoice_reminder: (i) => rest("POST", `/v2/invoicing/invoices/${i.invoice_id}/remind`, { subject: i.subject, note: i.note }),
    generate_invoice_qr_code: async () => JSON.stringify({ image: "stub" }),
  };
  const tools: Record<string, ToolkitTool> = {};
  for (const [name, tool] of Object.entries(real)) {
    tools[name] = {
      ...tool,
      execute: async (input) => {
        calls.push({ name, input: input as Input });
        return (replace[name] ?? behaviour[name]!)(input as Input);
      },
    };
  }
  return { toolkit: new ToolkitBridge(() => tools), calls };
}

describe("PayPal Agent Toolkit", () => {
  it("creates, sends and reads the invoice through the toolkit and logs it as a toolkit call", async () => {
    const stub = stubToolkit(() => t.deps.mock!);
    t = await makeApp({}, { toolkit: stub.toolkit });
    const restCreate = vi.spyOn(t.deps.paypal, "createInvoice");
    const restSend = vi.spyOn(t.deps.paypal, "sendInvoice");
    const order = await abandon("tk-invoice");

    await t.post("/channels/console/inbound", { from: PHONE, body: "just email me the invoice" });
    const view = await cartView(order.cartId);
    expect(view.cart.invoiceId).toMatch(/^INV2-/);
    expect(stub.calls.map((c) => c.name)).toEqual(["get_order", "create_invoice", "send_invoice", "get_invoice"]);

    const created = stub.calls.find((c) => c.name === "create_invoice")!.input;
    expect(created.invoicer_business_name).toBe("Kicks Lagos");
    expect(created.currency_code).toBe("USD");
    expect(created.primary_recipients[0].billing_info.email_address).toBe("ada@example.com");
    expect(created.items).toEqual([{ name: "Air Runners", quantity: "1", unit_amount: { currency_code: "USD", value: "89.00" } }]);
    expect(stub.calls.find((c) => c.name === "send_invoice")!.input).toEqual({ invoice_id: view.cart.invoiceId, send_to_recipient: true });
    expect(restCreate).not.toHaveBeenCalled();
    expect(restSend).not.toHaveBeenCalled();

    const calls = toolCalls(view);
    const invoice = calls.find((c) => c.name === "create_and_send_invoice")!;
    expect(invoice.source).toBe("paypal-agent-toolkit");
    expect(invoice.ok).toBe(true);
    expect(invoice.output).toMatchObject({ via: "paypal-agent-toolkit", invoiceId: view.cart.invoiceId });
    expect(calls.find((c) => c.name === "get_order")!.source).toBe("paypal-agent-toolkit");
    expect(t.outbox[1]!.body).toContain(`/mock/paypal/invoice?id=${view.cart.invoiceId}`);

    await t.post(`/mock/paypal/invoices/${view.cart.invoiceId}/pay`);
    expect((await cartView(order.cartId)).cart.status).toBe("recovered");
  });

  it("falls back to the REST client when the toolkit's create_invoice fails", async () => {
    const stub = stubToolkit(() => t.deps.mock!, {
      create_invoice: async () => JSON.stringify({ ok: false, status: 422, code: "PAYPAL_API_HTTP_ERROR", message: "boom" }),
    });
    t = await makeApp({}, { toolkit: stub.toolkit });
    const restCreate = vi.spyOn(t.deps.paypal, "createInvoice");
    const order = await abandon("tk-fallback");

    await t.post("/channels/console/inbound", { from: PHONE, body: "just email me the invoice" });
    const view = await cartView(order.cartId);
    expect(restCreate).toHaveBeenCalledTimes(1);
    expect(view.cart.invoiceId).toMatch(/^INV2-/);
    const invoice = toolCalls(view).find((c) => c.name === "create_and_send_invoice")!;
    expect(invoice.source).toBe("hollaback");
    expect(invoice.output).toMatchObject({ ok: true, via: "rest", fallbacks: ["create_invoice: boom"] });
  });

  it("reminds only the cart's own invoice, whatever the model asks for", async () => {
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const text = (s: string) => ({ content: [{ type: "text" as const, text: s }], finishReason: "stop" as const, usage, warnings: [] });
    const call = (toolName: string, input: unknown) => ({
      content: [{ type: "tool-call" as const, toolCallId: `c-${toolName}-${Math.random()}`, toolName, input: JSON.stringify(input) }],
      finishReason: "tool-calls" as const,
      usage,
      warnings: [],
    });
    const model = new MockLanguageModelV2({
      doGenerate: [
        text("Hi Ada, Kicks Lagos here. Still keen on the Air Runners?"),
        call("send_invoice_reminder", {}),
        call("create_and_send_invoice", {}),
        text("Sent you a PayPal invoice."),
        call("send_invoice_reminder", { invoice_id: "INV2-SOME-ONE-ELSE" }),
        call("get_invoice", { invoice_id: "INV2-AAAA-BBBB-CCCC-DDDD" }),
        text("PayPal just emailed it again."),
      ],
    });
    const stub = stubToolkit(() => t.deps.mock!);
    const config = loadConfig({ MOCK_PAYPAL: "1" });
    t = await makeApp({}, { toolkit: stub.toolkit, agent: new ClaudeAgent(config, model) });
    const order = await abandon("tk-remind");

    await t.post("/channels/console/inbound", { from: PHONE, body: "can you email me an invoice" });
    await t.post("/channels/console/inbound", { from: PHONE, body: "I'll pay it later today" });
    const view = await cartView(order.cartId);

    const offered = model.doGenerateCalls[0]!.tools!.map((tl) => tl.name);
    expect(offered).toEqual(expect.arrayContaining(["get_order", "send_invoice_reminder", "get_invoice", "generate_invoice_qr_code"]));
    expect(offered).not.toContain("create_invoice");
    expect(offered).not.toContain("send_invoice");

    const reminders = stub.calls.filter((c) => c.name === "send_invoice_reminder");
    expect(reminders.map((r) => r.input.invoice_id)).toEqual([view.cart.invoiceId]);
    expect(stub.calls.some((c) => c.input.invoice_id === "INV2-AAAA-BBBB-CCCC-DDDD")).toBe(false);

    const calls = toolCalls(view);
    const reminderLogs = calls.filter((c) => c.name === "send_invoice_reminder");
    expect(reminderLogs.map((c) => c.ok)).toEqual([false, true]);
    expect(String((reminderLogs[0]!.output as { reason: string }).reason)).toMatch(/No PayPal invoice/);
    expect(reminderLogs[1]!.source).toBe("paypal-agent-toolkit");
    const foreign = calls.find((c) => c.name === "get_invoice")!;
    expect(foreign.ok).toBe(false);
    expect(t.outbox.at(-1)!.body).toContain(`/mock/paypal/invoice?id=${view.cart.invoiceId}`);
  });

  it("sends the invoice reminder as the follow-up instead of the checkout link", async () => {
    const stub = stubToolkit(() => t.deps.mock!);
    t = await makeApp({ FOLLOW_UP_MS: "150" }, { toolkit: stub.toolkit });
    const order = await abandon("tk-follow-up");
    await t.post("/channels/console/inbound", { from: PHONE, body: "just email me the invoice" });
    await waitFor(() => t.outbox.length >= 3);

    const view = await cartView(order.cartId);
    const reminders = stub.calls.filter((c) => c.name === "send_invoice_reminder");
    expect(reminders.map((r) => r.input.invoice_id)).toEqual([view.cart.invoiceId]);
    expect(t.outbox[2]!.body).toContain("PayPal has re-sent your invoice to ada@example.com");
    expect(t.outbox[2]!.body).toContain(`/mock/paypal/invoice?id=${view.cart.invoiceId}`);
    expect(t.outbox[2]!.body).not.toContain(order.payerActionUrl);
    expect(toolCalls(view).find((c) => c.name === "send_invoice_reminder")!.source).toBe("paypal-agent-toolkit");
  });

  it("sends the follow-up reminder over REST in mock mode without the toolkit", async () => {
    t = await makeApp({ FOLLOW_UP_MS: "150" });
    const order = await abandon("rest-follow-up");
    await t.post("/channels/console/inbound", { from: PHONE, body: "just email me the invoice" });
    await waitFor(() => t.outbox.length >= 3);

    const view = await cartView(order.cartId);
    expect(t.deps.mock!.requests.some((r) => r.method === "POST" && r.path === `/v2/invoicing/invoices/${view.cart.invoiceId}/remind`)).toBe(true);
    const reminder = toolCalls(view).find((c) => c.name === "send_invoice_reminder")!;
    expect(reminder).toMatchObject({ ok: true, source: "hollaback" });
  });
});

describe("ToolkitBridge", () => {
  it("rebuilds the toolkit and retries once when PayPal rejects its cached token", async () => {
    let builds = 0;
    const bridge = new ToolkitBridge(() => {
      const fresh = builds++ > 0;
      return {
        get_order: {
          parameters: {},
          execute: async () => JSON.stringify(fresh ? { id: "ORDER", status: "APPROVED" } : { ok: false, status: 401, code: "PAYPAL_API_HTTP_ERROR", message: "expired" }),
        },
      };
    });
    const res = await bridge.call("get_order", { id: "ORDER" });
    expect(res).toEqual({ ok: true, output: { id: "ORDER", status: "APPROVED" } });
    expect(builds).toBe(2);
  });

  it("rejects input that fails the toolkit's own schema without calling PayPal", async () => {
    const stub = stubToolkit(() => {
      throw new Error("PayPal should not be called");
    });
    const res = await stub.toolkit.call("get_order", { id: "not an order id" });
    expect(res.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });
});
