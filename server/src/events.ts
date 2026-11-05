import { EventEmitter } from "node:events";
import type { Store } from "./store/types.js";

export type ChangeKind = "cart" | "conversation" | "message" | "webhook" | "checkout_event";

export interface ChangeEvent {
  kind: ChangeKind;
  cartId: string | null;
  at: string;
}

/** In-process fan-out of store writes, consumed by the dashboard's /api/stream. */
export class ChangeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(kind: ChangeKind, cartId: string | null): void {
    this.emitter.emit("change", { kind, cartId, at: new Date().toISOString() } satisfies ChangeEvent);
  }

  subscribe(fn: (e: ChangeEvent) => void): () => void {
    this.emitter.on("change", fn);
    return () => this.emitter.off("change", fn);
  }

  get listeners(): number {
    return this.emitter.listenerCount("change");
  }
}

/** Wraps a store so every successful write is announced on the bus. Reads pass straight through. */
export function withChangeEvents(store: Store, bus: ChangeBus): Store {
  return {
    kind: store.kind,
    createCart: async (input) => {
      const cart = await store.createCart(input);
      bus.emit("cart", cart.id);
      return cart;
    },
    updateCart: async (id, patch) => {
      const cart = await store.updateCart(id, patch);
      bus.emit("cart", cart.id);
      return cart;
    },
    getCart: (id) => store.getCart(id),
    findCart: (by) => store.findCart(by),
    listCarts: () => store.listCarts(),

    createConversation: async (input) => {
      const conv = await store.createConversation(input);
      bus.emit("conversation", conv.cartId);
      return conv;
    },
    updateConversation: async (id, patch) => {
      const conv = await store.updateConversation(id, patch);
      bus.emit("conversation", conv.cartId);
      return conv;
    },
    getConversation: (id) => store.getConversation(id),
    findOpenConversation: (address) => store.findOpenConversation(address),
    listConversations: (cartId) => store.listConversations(cartId),

    addMessage: async (input) => {
      const msg = await store.addMessage(input);
      const conv = await store.getConversation(msg.conversationId).catch(() => null);
      bus.emit("message", conv?.cartId ?? null);
      return msg;
    },
    listMessages: (conversationId) => store.listMessages(conversationId),

    addWebhookEvent: async (input) => {
      const evt = await store.addWebhookEvent(input);
      bus.emit("webhook", evt.cartId);
      return evt;
    },
    listWebhookEvents: (cartId) => store.listWebhookEvents(cartId),

    addCheckoutEvent: async (input) => {
      const evt = await store.addCheckoutEvent(input);
      bus.emit("checkout_event", evt.cartId);
      return evt;
    },
    listCheckoutEvents: (cartId) => store.listCheckoutEvents(cartId),
  };
}
