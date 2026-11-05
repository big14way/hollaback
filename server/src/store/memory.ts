import { randomUUID } from "node:crypto";
import type { Cart, CheckoutEvent, Conversation, Message, NewCart, Store, StoredWebhookEvent } from "./types.js";

const now = () => new Date().toISOString();

/** Zero-setup store used when SUPABASE_URL is not set. Same interface as the Supabase store. */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private carts = new Map<string, Cart>();
  private conversations = new Map<string, Conversation>();
  private messages: Message[] = [];
  private webhooks: StoredWebhookEvent[] = [];
  private events: CheckoutEvent[] = [];

  async createCart(input: NewCart): Promise<Cart> {
    const ts = now();
    const cart: Cart = {
      sessionId: null,
      shopperName: null,
      shopperPhone: null,
      shopperEmail: null,
      consent: false,
      paypalOrderId: null,
      orderStatus: null,
      payerActionUrl: null,
      payLaterEligible: true,
      status: "active",
      abandonReason: null,
      orderCreatedAt: null,
      abandonedAt: null,
      recoveredAt: null,
      recoveryChannel: null,
      recoveredAmount: null,
      discountPct: 0,
      invoiceId: null,
      invoiceUrl: null,
      ...input,
      id: randomUUID(),
      createdAt: ts,
      updatedAt: ts,
    };
    this.carts.set(cart.id, cart);
    return structuredClone(cart);
  }

  async updateCart(id: string, patch: Partial<Omit<Cart, "id" | "createdAt">>): Promise<Cart> {
    const cart = this.carts.get(id);
    if (!cart) throw new Error(`cart ${id} not found`);
    const next = { ...cart, ...patch, updatedAt: now() };
    this.carts.set(id, next);
    return structuredClone(next);
  }

  async getCart(id: string): Promise<Cart | null> {
    const c = this.carts.get(id);
    return c ? structuredClone(c) : null;
  }

  async findCart(by: { sessionId?: string; paypalOrderId?: string; invoiceId?: string }): Promise<Cart | null> {
    const all = [...this.carts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const hit = all.find(
      (c) =>
        (by.paypalOrderId !== undefined && c.paypalOrderId === by.paypalOrderId) ||
        (by.invoiceId !== undefined && c.invoiceId === by.invoiceId) ||
        (by.sessionId !== undefined && c.sessionId === by.sessionId),
    );
    return hit ? structuredClone(hit) : null;
  }

  async listCarts(): Promise<Cart[]> {
    return [...this.carts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => structuredClone(c));
  }

  async createConversation(
    input: Omit<Conversation, "id" | "startedAt" | "endedAt" | "outcome" | "unanswered" | "payLaterOffered" | "status">,
  ): Promise<Conversation> {
    const conv: Conversation = {
      ...input,
      id: randomUUID(),
      status: "open",
      outcome: null,
      unanswered: 0,
      payLaterOffered: false,
      startedAt: now(),
      endedAt: null,
    };
    this.conversations.set(conv.id, conv);
    return { ...conv };
  }

  async updateConversation(id: string, patch: Partial<Omit<Conversation, "id">>): Promise<Conversation> {
    const conv = this.conversations.get(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const next = { ...conv, ...patch };
    this.conversations.set(id, next);
    return { ...next };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const c = this.conversations.get(id);
    return c ? { ...c } : null;
  }

  async findOpenConversation(address: string): Promise<Conversation | null> {
    const open = [...this.conversations.values()]
      .filter((c) => c.address === address && c.status === "open")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return open[0] ? { ...open[0] } : null;
  }

  async listConversations(cartId?: string): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter((c) => !cartId || c.cartId === cartId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((c) => ({ ...c }));
  }

  async addMessage(input: Omit<Message, "id" | "createdAt">): Promise<Message> {
    const msg: Message = { ...input, id: randomUUID(), createdAt: now() };
    this.messages.push(msg);
    return structuredClone(msg);
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return this.messages.filter((m) => m.conversationId === conversationId).map((m) => structuredClone(m));
  }

  async addWebhookEvent(input: Omit<StoredWebhookEvent, "id" | "receivedAt">): Promise<StoredWebhookEvent> {
    const ev: StoredWebhookEvent = { ...input, id: randomUUID(), receivedAt: now() };
    this.webhooks.push(ev);
    return structuredClone(ev);
  }

  async listWebhookEvents(cartId?: string): Promise<StoredWebhookEvent[]> {
    return this.webhooks.filter((w) => !cartId || w.cartId === cartId).map((w) => structuredClone(w));
  }

  async addCheckoutEvent(input: Omit<CheckoutEvent, "id" | "createdAt">): Promise<CheckoutEvent> {
    const ev: CheckoutEvent = { ...input, id: randomUUID(), createdAt: now() };
    this.events.push(ev);
    return structuredClone(ev);
  }

  async listCheckoutEvents(cartId: string): Promise<CheckoutEvent[]> {
    return this.events.filter((e) => e.cartId === cartId).map((e) => structuredClone(e));
  }
}
