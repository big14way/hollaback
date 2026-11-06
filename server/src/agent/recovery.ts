import type { Logger } from "../abandonment.js";
import type { ChannelRouter } from "../channels/router.js";
import type { Config } from "../config.js";
import { effectiveTotal } from "../orders.js";
import type { PayPalClient } from "../paypal/client.js";
import type { Cart, Channel, Conversation, Store, ToolCallLog } from "../store/types.js";
import { firstName, formatMoney } from "../util.js";
import { canSendAgentMessage, isOptOut, MAX_UNANSWERED } from "./guardrails.js";
import { ScriptedAgent } from "./scripted.js";
import type { ToolkitBridge } from "./toolkit.js";
import type { AgentContext, AgentEvent, RecoveryAgent } from "./types.js";

export interface RecoveryDeps {
  store: Store;
  paypal: PayPalClient;
  config: Config;
  agent: RecoveryAgent;
  channels: ChannelRouter;
  toolkit: ToolkitBridge | null;
  log: Logger;
}

const RECOVERABLE: ReadonlySet<Cart["status"]> = new Set(["abandoned", "contacted", "declined"]);

/** Runs the conversation: first message on abandonment, replies, follow-ups, payment outcomes. */
export class RecoveryService {
  private readonly fallback = new ScriptedAgent();
  private readonly followUps = new Map<string, ReturnType<typeof setTimeout>>();
  /** Serialises turns per conversation so overlapping inbound messages can't interleave. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: RecoveryDeps) {}

  private enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Called by the abandonment monitor once a checkout is confirmed abandoned. */
  async onAbandoned(cart: Cart): Promise<Conversation | null> {
    const { store, channels, log } = this.deps;
    if (!cart.consent || !cart.shopperPhone) {
      const reason = !cart.shopperPhone ? "no phone number captured" : "no WhatsApp consent";
      await store.addCheckoutEvent({ cartId: cart.id, type: "recovery_skipped", detail: { reason } });
      log.info({ cartId: cart.id, reason }, "abandoned cart not contacted");
      return null;
    }
    const existing = (await store.listConversations(cart.id)).find((c) => c.status === "open");
    if (existing) return existing;

    const channel = channels.forAddress(cart.shopperPhone).name;
    const conv = await store.createConversation({ cartId: cart.id, channel, address: cart.shopperPhone });
    await store.updateCart(cart.id, { status: "contacted", recoveryChannel: channel });
    await this.enqueue(conv.id, () => this.turn(conv.id, { kind: "abandoned", reason: cart.abandonReason ?? "unknown" }));
    return store.getConversation(conv.id);
  }

  /**
   * A shopper message arrived (WhatsApp webhook or console). With `channel`, only an open
   * conversation on that channel takes it.
   */
  async handleInbound(address: string, text: string, channel?: Channel): Promise<{ handled: boolean; conversationId?: string }> {
    const conv = await this.deps.store.findOpenConversation(address);
    if (!conv || (channel && conv.channel !== channel)) return { handled: false };
    return this.receive(conv, text);
  }

  /** A shopper message for a known open conversation (the dashboard's "reply as shopper"). */
  async receive(conv: Conversation, text: string): Promise<{ handled: true; conversationId: string }> {
    const { store } = this.deps;
    await this.enqueue(conv.id, async () => {
      await store.addMessage({ conversationId: conv.id, role: "shopper", body: text.slice(0, 2000), toolCall: null });
      await store.updateConversation(conv.id, { unanswered: 0 });
      this.clearFollowUp(conv.id);
      if (isOptOut(text)) {
        await this.close(conv.id, "declined", "Shopper opted out");
        await this.sendRaw(conv, "Got it, you won't hear from us about this order again. Have a great day!");
        return;
      }
      await this.turn(conv.id, { kind: "reply", text });
    });
    return { handled: true, conversationId: conv.id };
  }

  private async turn(conversationId: string, event: AgentEvent): Promise<void> {
    const { store, paypal, config, agent, toolkit, log } = this.deps;
    let conv = await store.getConversation(conversationId);
    if (!conv || conv.status !== "open") return;
    if (!canSendAgentMessage(conv)) {
      await this.close(conv.id, "no_reply", `No reply after ${MAX_UNANSWERED} messages`);
      return;
    }
    const cart = await store.getCart(conv.cartId);
    if (!cart || cart.status === "recovered" || cart.status === "paid") return;

    const ctx: AgentContext = {
      cart,
      conversation: conv,
      config,
      store,
      paypal,
      toolkit,
      links: [],
      ended: null,
      logTool: async (call: ToolCallLog) => {
        await store.addMessage({ conversationId, role: "system", body: `tool:${call.name}`, toolCall: call });
      },
    };
    const history = await store.listMessages(conversationId);

    let text: string;
    try {
      text = await agent.respond(ctx, history, event);
    } catch (err) {
      log.error({ err, conversationId }, `agent ${agent.name} failed; using scripted fallback`);
      await store.addMessage({
        conversationId,
        role: "system",
        body: `Agent error, scripted fallback used: ${String((err as Error)?.message ?? err).slice(0, 300)}`,
        toolCall: null,
      });
      ctx.links = [];
      text = await this.fallback.respond(ctx, history, event);
    }

    const body = composeMessage(text, ctx.links);
    conv = (await store.getConversation(conversationId)) ?? conv;
    if (body) await this.sendAgent(conv, body);
    if (ctx.ended) {
      await this.close(conversationId, ctx.ended.outcome, ctx.ended.reason);
      return;
    }
    this.scheduleFollowUp(conversationId);
  }

  private async sendAgent(conv: Conversation, body: string): Promise<void> {
    const { store, channels, log } = this.deps;
    try {
      await channels.byName(conv.channel).send(conv.address, body);
    } catch (err) {
      log.error({ err, conversationId: conv.id }, "channel send failed");
      await store.addMessage({ conversationId: conv.id, role: "system", body: `Send failed: ${String((err as Error)?.message ?? err)}`, toolCall: null });
      return;
    }
    await store.addMessage({ conversationId: conv.id, role: "agent", body, toolCall: null });
    const fresh = await store.getConversation(conv.id);
    await store.updateConversation(conv.id, { unanswered: (fresh?.unanswered ?? conv.unanswered) + 1 });
  }

  /** Templated message that is not counted as an unanswered agent turn. */
  private async sendRaw(conv: Conversation, body: string): Promise<void> {
    const { store, channels, log } = this.deps;
    try {
      await channels.byName(conv.channel).send(conv.address, body);
      await store.addMessage({ conversationId: conv.id, role: "agent", body, toolCall: null });
    } catch (err) {
      log.error({ err }, "channel send failed");
    }
  }

  private async close(conversationId: string, outcome: Conversation["outcome"], reason: string): Promise<void> {
    const { store } = this.deps;
    this.clearFollowUp(conversationId);
    const conv = await store.updateConversation(conversationId, { status: "closed", outcome, endedAt: new Date().toISOString() });
    await store.addMessage({ conversationId, role: "system", body: `Conversation closed: ${outcome} (${reason})`, toolCall: null });
    if (outcome === "declined") await store.updateCart(conv.cartId, { status: "declined" });
  }

  private scheduleFollowUp(conversationId: string): void {
    const ms = this.deps.config.followUpMs;
    if (!ms || ms <= 0) return;
    this.clearFollowUp(conversationId);
    const timer = setTimeout(() => {
      this.followUps.delete(conversationId);
      this.enqueue(conversationId, () => this.turn(conversationId, { kind: "follow_up" })).catch((err) =>
        this.deps.log.error({ err, conversationId }, "follow-up failed"),
      );
    }, ms);
    timer.unref?.();
    this.followUps.set(conversationId, timer);
  }

  private clearFollowUp(conversationId: string): void {
    const t = this.followUps.get(conversationId);
    if (t) clearTimeout(t);
    this.followUps.delete(conversationId);
  }

  stop(): void {
    for (const id of [...this.followUps.keys()]) this.clearFollowUp(id);
  }

  /**
   * Payment signal from a webhook or a capture. Carts we were working on become
   * "recovered" (with the amount); carts that paid on their own become "paid".
   */
  async onPayment(cart: Cart, source: string, amount?: number): Promise<Cart> {
    const { store, log } = this.deps;
    const current = (await store.getCart(cart.id)) ?? cart;
    if (current.status === "recovered" || current.status === "paid") return current;

    const convs = await store.listConversations(current.id);
    const conv = convs[convs.length - 1];
    const contacted = conv ? (await store.listMessages(conv.id)).some((m) => m.role === "agent") : false;

    if (RECOVERABLE.has(current.status) && contacted && conv) {
      const recoveredAmount = amount ?? effectiveTotal(current);
      const updated = await store.updateCart(current.id, {
        status: "recovered",
        recoveredAt: new Date().toISOString(),
        recoveredAmount,
        recoveryChannel: conv.channel,
      });
      if (conv.status === "open") {
        await this.close(conv.id, "recovered", source);
        const name = firstName(current.shopperName);
        await this.sendRaw(
          conv,
          `Payment received${name ? `, ${name}` : ""}! ${formatMoney(recoveredAmount, current.currency)} via PayPal. Thanks for shopping with ${this.deps.config.merchant.name}.`,
        );
      } else {
        await store.updateConversation(conv.id, { outcome: "recovered" });
      }
      log.info({ cartId: current.id, source, recoveredAmount }, "cart recovered");
      return updated;
    }
    return store.updateCart(current.id, { status: "paid" });
  }
}

/** Append tool links the model didn't already include. */
export function composeMessage(text: string, links: string[]): string {
  const body = text.trim();
  const missing = links.filter((l) => !body.includes(l));
  return [body, ...missing].filter(Boolean).join("\n");
}
