import { effectiveTotal } from "../orders.js";
import type { Message } from "../store/types.js";
import { extractEmail, firstName, formatMoney } from "../util.js";
import { classifyIntent } from "./guardrails.js";
import { createTools } from "./tools.js";
import type { AgentContext, AgentEvent, RecoveryAgent } from "./types.js";

function itemSummary(ctx: AgentContext): string {
  const items = ctx.cart.items;
  if (!items.length) return "your order";
  const first = items[0]!.name;
  return items.length === 1 ? `the ${first}` : `the ${first} and ${items.length - 1} more`;
}

/**
 * Deterministic recovery policy. Runs when no ANTHROPIC_API_KEY is set (so the whole
 * loop works offline) and as a fallback if the model call fails. It uses the same
 * guarded tools as the Claude agent, so the transcript and PayPal calls are identical.
 */
export class ScriptedAgent implements RecoveryAgent {
  readonly name = "scripted";

  async respond(ctx: AgentContext, _history: Message[], event: AgentEvent): Promise<string> {
    const tools = createTools(ctx);
    const name = firstName(ctx.cart.shopperName);
    const hi = name ? `Hi ${name}` : "Hi there";
    const merchant = ctx.config.merchant.name;
    const total = formatMoney(effectiveTotal(ctx.cart), ctx.cart.currency);

    if (event.kind === "abandoned") {
      await tools.get_order({});
      return `${hi}, this is ${merchant}. Saw you were about to grab ${itemSummary(ctx)} (${total}). Anything holding you back?`;
    }

    if (event.kind === "follow_up") {
      const link = await tools.send_checkout_link({});
      return link.ok
        ? `Just checking in${name ? `, ${name}` : ""}. ${itemSummary(ctx).replace(/^the/, "The")} is still saved for you:`
        : `Just checking in${name ? `, ${name}` : ""}. Reply here any time if you want to finish your order.`;
    }

    const intent = classifyIntent(event.text);
    if (intent === "email") {
      const email = extractEmail(event.text) ?? undefined;
      const res = await tools.create_and_send_invoice({ email });
      if (res.ok) return `Done. I've sent a PayPal invoice to ${String(res.sentTo ?? "your email")}. You can also pay it right here:`;
      return "Happy to. What email address should I send the PayPal invoice to?";
    }

    if (intent === "trust") {
      await tools.send_checkout_link({});
      return "Totally fair. You pay on PayPal's own checkout page, and PayPal Purchase Protection covers you if your order doesn't arrive or isn't as described. Here's your secure link:";
    }

    if (intent === "price") {
      if (ctx.cart.payLaterEligible && !ctx.conversation.payLaterOffered) {
        const res = await tools.offer_pay_later({});
        if (res.ok) {
          return `No stress. You can split it into 4 interest-free payments with PayPal Pay Later: ${String(res.perInstallment)} today, the rest every 2 weeks. Pick Pay Later on the PayPal page:`;
        }
      }
      if (ctx.cart.discountPct === 0) {
        const res = await tools.apply_discount({ percent: ctx.config.discountCapPct, reason: "price objection" });
        if (res.ok) {
          return `I can do ${String(res.percent)}% off just for you: ${String(res.newTotal)} instead of ${formatMoney(ctx.cart.total, ctx.cart.currency)}. Same secure PayPal checkout:`;
        }
      }
      await tools.send_checkout_link({});
      return "That's the best I can do on price, but your cart is saved here whenever you're ready:";
    }

    if (intent === "ready") {
      await tools.send_checkout_link({});
      return "Here you go, your cart is saved. One tap to finish with PayPal:";
    }

    await tools.send_checkout_link({});
    return `Happy to help. You can pay with PayPal or split it with Pay Later. Your cart (${total}) is saved here:`;
  }
}
