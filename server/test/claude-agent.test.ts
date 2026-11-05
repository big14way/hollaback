import { MockLanguageModelV2 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeAgent } from "../src/agent/llm.js";
import { buildApp } from "../src/app.js";
import { ConsoleChannel } from "../src/channels/console.js";
import { loadConfig } from "../src/config.js";
import { silentLogger } from "../src/log.js";
import type { Message } from "../src/store/types.js";
import { PHONE, startCheckout, waitFor } from "./helpers.js";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV2["doGenerate"]>>;
const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };
const text = (t: string): GenerateResult => ({ content: [{ type: "text", text: t }], finishReason: "stop", usage, warnings: [] });
const toolCall = (toolName: string, input: unknown): GenerateResult => ({
  content: [{ type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) }],
  finishReason: "tool-calls",
  usage,
  warnings: [],
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function setup(responses: GenerateResult[]) {
  const model = new MockLanguageModelV2({ doGenerate: responses });
  const config = loadConfig({ MOCK_PAYPAL: "1", GRACE_MS: "40", ABANDON_SETTLE_MS: "5", FOLLOW_UP_MS: "0" });
  const channel = new ConsoleChannel({ quiet: true });
  const { app, deps } = await buildApp(config, { channel, log: silentLogger, agent: new ClaudeAgent(config, model) });
  await app.ready();
  close = () => app.close();
  const post = async (url: string, payload: unknown) => {
    const res = await app.inject({ method: "POST", url, payload: JSON.stringify(payload), headers: { "content-type": "application/json" } });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const get = async (url: string) => JSON.parse((await app.inject({ method: "GET", url })).body);
  const t = { app, deps, outbox: channel.outbox, post, get };
  return { model, t };
}

describe("Claude agent (Vercel AI SDK) wiring", () => {
  it("runs tools chosen by the model and appends the checkout link", async () => {
    const { model, t } = await setup([
      text("Hi Ada, Kicks Lagos here. Still thinking about the Air Runners ($89)?"),
      toolCall("offer_pay_later", {}),
      text("Totally get it. Split it in 4 with PayPal Pay Later, $22.25 today."),
    ]);
    const order = await startCheckout(t as never, { sessionId: "llm-1" });
    await t.post("/events", { type: "abandoned", sessionId: "llm-1", orderId: order.orderId, reason: "cancel" });
    await waitFor(() => t.outbox.length === 1);
    await t.post("/channels/console/inbound", { from: PHONE, body: "bit pricey rn" });

    expect(t.outbox[1]!.body).toBe(`Totally get it. Split it in 4 with PayPal Pay Later, $22.25 today.\n${order.payerActionUrl}`);

    const view = await t.get(`/api/carts/${order.cartId}`);
    const calls = (view.conversations[0].messages as Message[]).filter((m) => m.toolCall).map((m) => m.toolCall!);
    expect(calls.map((c) => c.name)).toEqual(["offer_pay_later"]);
    expect(calls[0]!.ok).toBe(true);

    const first = model.doGenerateCalls[0]!;
    expect(first.temperature).toBeUndefined();
    expect(first.maxOutputTokens).toBe(4096);
    expect(first.providerOptions?.anthropic?.effort).toBe("medium");
    expect(first.toolChoice?.type ?? "auto").toBe("auto");
    expect(first.tools?.map((tl) => tl.name).sort()).toEqual(
      ["apply_discount", "create_and_send_invoice", "end_conversation", "get_order", "offer_pay_later", "send_checkout_link"].sort(),
    );
    const system = first.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(system)).toContain("Discount cap: 10%");
  });

  it("refuses an over-cap discount requested by the model without touching PayPal", async () => {
    const { t } = await setup([
      text("Hi Ada!"),
      toolCall("apply_discount", { percent: 30, reason: "asked" }),
      text("I can't go that low, but Pay Later can help."),
    ]);
    const order = await startCheckout(t as never, { sessionId: "llm-2" });
    await t.post("/events", { type: "abandoned", sessionId: "llm-2", orderId: order.orderId, reason: "cancel" });
    await waitFor(() => t.outbox.length === 1);
    await t.post("/channels/console/inbound", { from: PHONE, body: "give me 30% off" });

    const view = await t.get(`/api/carts/${order.cartId}`);
    const call = (view.conversations[0].messages as Message[]).find((m) => m.toolCall?.name === "apply_discount")!.toolCall!;
    expect(call.ok).toBe(false);
    expect(JSON.stringify(call.output)).toMatch(/cap/);
    expect(t.deps.mock!.requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(view.cart.discountPct).toBe(0);
  });

  it("falls back to the scripted agent if the model call fails", async () => {
    const model = new MockLanguageModelV2({
      doGenerate: async () => {
        throw new Error("overloaded");
      },
    });
    const config = loadConfig({ MOCK_PAYPAL: "1", GRACE_MS: "40", ABANDON_SETTLE_MS: "5", FOLLOW_UP_MS: "0" });
    const channel = new ConsoleChannel({ quiet: true });
    const { app } = await buildApp(config, { channel, log: silentLogger, agent: new ClaudeAgent(config, model) });
    close = () => app.close();
    const post = (url: string, payload: unknown) =>
      app.inject({ method: "POST", url, payload: JSON.stringify(payload), headers: { "content-type": "application/json" } });
    await post("/events", {
      type: "checkout_started",
      sessionId: "llm-3",
      cart: { items: [{ name: "Air Runners", quantity: 1, unitPrice: 89 }], currency: "USD" },
      contact: { phone: PHONE, name: "Ada Obi" },
      consent: true,
    });
    const order = JSON.parse((await post("/orders", { sessionId: "llm-3", items: [{ name: "Air Runners", quantity: 1, unitPrice: 89 }] })).body);
    await post("/events", { type: "abandoned", sessionId: "llm-3", orderId: order.orderId, reason: "cancel" });
    await waitFor(() => channel.outbox.length === 1);
    expect(channel.outbox[0]!.body).toMatch(/^Hi Ada, this is Kicks Lagos/);
  });

  it("falls back to the scripted agent when the model returns no text and no tool calls", async () => {
    const { t } = await setup([{ content: [], finishReason: "content-filter", usage, warnings: [] }]);
    const order = await startCheckout(t as never, { sessionId: "llm-4" });
    await t.post("/events", { type: "abandoned", sessionId: "llm-4", orderId: order.orderId, reason: "cancel" });
    await waitFor(() => t.outbox.length === 1);
    expect(t.outbox[0]!.body).toMatch(/^Hi Ada, this is Kicks Lagos/);
    const view = await t.get(`/api/carts/${order.cartId}`);
    const notes = (view.conversations[0].messages as Message[]).filter((m) => m.role === "system").map((m) => m.body);
    expect(notes.some((b) => b.includes("empty reply from claude-haiku-5-5 (finishReason=content-filter)"))).toBe(true);
  });
});
