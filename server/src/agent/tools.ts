import { z } from "zod";
import { createOrderForCart, effectiveTotal, itemsTotal } from "../orders.js";
import { money, PayPalApiError } from "../paypal/client.js";
import type { InvoiceDraft } from "../paypal/types.js";
import type { ToolCallLog } from "../store/types.js";
import { firstName, formatMoney, isValidEmail, round2 } from "../util.js";
import { checkDiscount, payInFour } from "./guardrails.js";
import type { AgentContext } from "./types.js";

export type ToolOutput = { ok: boolean } & Record<string, unknown>;

/** Input schemas shared by the LLM tool definitions and the scripted agent. */
export const toolSchemas = {
  get_order: z.object({}),
  send_checkout_link: z.object({}),
  offer_pay_later: z.object({}),
  create_and_send_invoice: z.object({
    email: z.string().optional().describe("Shopper email. Omit to use the email captured at checkout."),
  }),
  apply_discount: z.object({
    percent: z.number().describe("Percentage off the order total. Hard cap enforced server-side."),
    reason: z.string().describe("Why the shopper needs it, in a few words."),
  }),
  end_conversation: z.object({
    outcome: z.enum(["declined", "no_reply"]).describe("declined if the shopper said no or asked to stop."),
    reason: z.string(),
  }),
} as const;

export const toolDescriptions: Record<keyof typeof toolSchemas, string> = {
  get_order: "Read the shopper's PayPal order (Orders v2): status and amount.",
  send_checkout_link:
    "Attach the shopper's one-tap PayPal checkout link (the order's payer-action link) to your reply. Regenerates the order if it expired.",
  offer_pay_later:
    "Check PayPal Pay Later eligibility and get the Pay in 4 instalment amount; attaches the checkout link. Use this first for price objections.",
  create_and_send_invoice:
    "Create and send a PayPal invoice (Invoicing v2) to the shopper's email and attach the invoice payment link. Use when they ask to be emailed or invoiced.",
  apply_discount:
    "Lower the PayPal order total by a percentage (PATCH the order). Server-enforced cap; only after Pay Later was offered when eligible; once per order.",
  end_conversation: "End the conversation when the shopper declines or asks you to stop.",
};

export type ToolName = keyof typeof toolSchemas;

async function timed(
  ctx: AgentContext,
  name: string,
  source: ToolCallLog["source"],
  input: unknown,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  const started = Date.now();
  let output: unknown;
  let ok = true;
  try {
    output = await fn();
    if (output && typeof output === "object" && "ok" in output) ok = Boolean((output as { ok: unknown }).ok);
  } catch (err) {
    ok = false;
    output = {
      ok: false,
      error: err instanceof PayPalApiError ? `${err.errorName}${err.issue ? ` (${err.issue})` : ""}` : String((err as Error)?.message ?? err),
    };
  }
  await ctx.logTool({ name, source, input, output, ok, durationMs: Date.now() - started });
  return output;
}

export { timed as runLoggedTool };

/** Hollaback's own tools. Every call is validated by guardrails and logged to the transcript. */
export function createTools(ctx: AgentContext) {
  const refreshCart = async () => {
    const fresh = await ctx.store.getCart(ctx.cart.id);
    if (fresh) ctx.cart = fresh;
    return ctx.cart;
  };

  const ensureLink = async (): Promise<ToolOutput> => {
    let cart = await refreshCart();
    if (cart.paypalOrderId) {
      const order = await ctx.paypal.getOrder(cart.paypalOrderId);
      if (order.status === "COMPLETED") return { ok: false, reason: "This order is already paid." };
      if (order.status === "VOIDED") cart = await createOrderForCart(ctx, cart);
    } else {
      cart = await createOrderForCart(ctx, cart);
    }
    ctx.cart = cart;
    if (!cart.payerActionUrl) return { ok: false, reason: "No PayPal checkout link available." };
    if (!ctx.links.includes(cart.payerActionUrl)) ctx.links.push(cart.payerActionUrl);
    return {
      ok: true,
      link: cart.payerActionUrl,
      linkAttached: "Already appended under your reply. Tell them to tap it; do not ask whether to send it.",
      orderId: cart.paypalOrderId,
      amount: formatMoney(effectiveTotal(cart), cart.currency),
    };
  };

  const handlers = {
    get_order: async (_input?: object): Promise<ToolOutput> => {
      const cart = await refreshCart();
      if (!cart.paypalOrderId) return { ok: false, reason: "No PayPal order yet." };
      if (ctx.toolkit?.has("get_order")) {
        // Read through PayPal's own Agent Toolkit when credentials are configured.
        const res = (await ctx.toolkit.run("get_order", { id: cart.paypalOrderId }, ctx.logTool)) as { status?: string };
        if (res?.status) await ctx.store.updateCart(cart.id, { orderStatus: res.status });
        return { ok: Boolean(res?.status), via: "paypal-agent-toolkit", orderId: cart.paypalOrderId, status: res?.status };
      }
      const order = await ctx.paypal.getOrder(cart.paypalOrderId);
      await ctx.store.updateCart(cart.id, { orderStatus: order.status });
      return { ok: true, orderId: order.id, status: order.status, amount: order.purchase_units?.[0]?.amount?.value };
    },

    send_checkout_link: async (_input?: object): Promise<ToolOutput> => ensureLink(),

    offer_pay_later: async (_input?: object): Promise<ToolOutput> => {
      const cart = await refreshCart();
      if (!cart.payLaterEligible) return { ok: false, reason: "Pay Later is not available for this order." };
      const total = effectiveTotal(cart);
      ctx.conversation = await ctx.store.updateConversation(ctx.conversation.id, { payLaterOffered: true });
      const link = await ensureLink();
      return {
        ...link,
        ok: link.ok,
        product: "PayPal Pay in 4",
        installments: 4,
        perInstallment: formatMoney(payInFour(total), cart.currency),
        dueToday: formatMoney(payInFour(total), cart.currency),
        note: "Interest-free, chosen on the PayPal checkout page. Subject to PayPal approval.",
      };
    },

    create_and_send_invoice: async (input: { email?: string }): Promise<ToolOutput> => {
      const cart = await refreshCart();
      const email = (input.email || cart.shopperEmail || "").trim();
      if (!isValidEmail(email)) return { ok: false, reason: "Need the shopper's email address first." };
      if (cart.invoiceId && cart.invoiceUrl) {
        if (!ctx.links.includes(cart.invoiceUrl)) ctx.links.push(cart.invoiceUrl);
        return { ok: true, invoiceId: cart.invoiceId, recipientViewUrl: cart.invoiceUrl, note: "Invoice already sent." };
      }
      const draft: InvoiceDraft = {
        // Shown as the seller on PayPal's invoice page; without it PayPal shows the account's own profile name.
        invoicer: { business_name: ctx.config.merchant.name.slice(0, 300) },
        detail: {
          currency_code: cart.currency,
          reference: cart.id.slice(0, 120),
          note: `Thanks for shopping with ${ctx.config.merchant.name}. Pay securely with PayPal.`,
          payment_term: { term_type: "DUE_ON_RECEIPT" },
        },
        primary_recipients: [
          { billing_info: { email_address: email, ...(firstName(cart.shopperName) ? { name: { given_name: firstName(cart.shopperName)! } } : {}) } },
        ],
        items: cart.items.map((i) => ({
          name: i.name.slice(0, 200),
          quantity: String(i.quantity),
          unit_amount: money(cart.discountPct > 0 ? round2(i.unitPrice * (1 - cart.discountPct / 100)) : i.unitPrice, cart.currency),
        })),
      };
      const invoiceId = await ctx.paypal.createInvoice(draft);
      await ctx.paypal.sendInvoice(invoiceId);
      const invoice = await ctx.paypal.getInvoice(invoiceId);
      const url = invoice.detail.metadata?.recipient_view_url ?? null;
      ctx.cart = await ctx.store.updateCart(cart.id, { invoiceId, invoiceUrl: url, shopperEmail: email });
      ctx.conversation = await ctx.store.updateConversation(ctx.conversation.id, { outcome: "invoice_sent" });
      if (url && !ctx.links.includes(url)) ctx.links.push(url);
      return { ok: true, invoiceId, status: invoice.status, sentTo: email, recipientViewUrl: url };
    },

    apply_discount: async (input: { percent: number; reason: string }): Promise<ToolOutput> => {
      const cart = await refreshCart();
      const decision = checkDiscount({
        requestedPct: input.percent,
        capPct: ctx.config.discountCapPct,
        currentDiscountPct: cart.discountPct,
        total: itemsTotal(cart.items),
        payLaterEligible: cart.payLaterEligible,
        payLaterOffered: ctx.conversation.payLaterOffered,
        orderStatus: cart.orderStatus,
      });
      if (!decision.ok) return { ok: false, reason: decision.reason };
      if (!cart.paypalOrderId) return { ok: false, reason: "No PayPal order to discount." };
      const itemTotal = itemsTotal(cart.items);
      await ctx.paypal.patchOrder(cart.paypalOrderId, [
        {
          op: "replace",
          path: `/purchase_units/@reference_id=='${cart.id}'/amount`,
          value: {
            ...money(decision.newTotal, cart.currency),
            breakdown: {
              item_total: money(itemTotal, cart.currency),
              discount: money(decision.discountAmount, cart.currency),
            },
          },
        },
      ]);
      ctx.cart = await ctx.store.updateCart(cart.id, { discountPct: decision.percent });
      const link = await ensureLink();
      return {
        ...link,
        ok: true,
        percent: decision.percent,
        newTotal: formatMoney(decision.newTotal, cart.currency),
        saved: formatMoney(decision.discountAmount, cart.currency),
      };
    },

    end_conversation: async (input: { outcome: "declined" | "no_reply"; reason: string }): Promise<ToolOutput> => {
      ctx.ended = { outcome: input.outcome, reason: input.reason };
      return { ok: true, outcome: input.outcome };
    },
  };

  type Handlers = typeof handlers;
  const logged = {} as { [K in keyof Handlers]: (input: Parameters<Handlers[K]>[0]) => Promise<ToolOutput> };
  for (const name of Object.keys(handlers) as Array<keyof Handlers>) {
    const fn = handlers[name] as (input: unknown) => Promise<ToolOutput>;
    // get_order delegates to the PayPal Agent Toolkit when present, which logs the call itself.
    const delegated = name === "get_order" && ctx.toolkit?.has("get_order");
    (logged as Record<string, (input: unknown) => Promise<ToolOutput>>)[name] = (input: unknown) =>
      delegated ? fn(input ?? {}) : (timed(ctx, name, "hollaback", input ?? {}, () => fn(input ?? {})) as Promise<ToolOutput>);
  }
  return logged;
}

export type AgentTools = ReturnType<typeof createTools>;
