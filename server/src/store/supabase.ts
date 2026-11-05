import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Cart, CheckoutEvent, Conversation, Message, NewCart, Store, StoredWebhookEvent } from "./types.js";

type Row = Record<string, unknown>;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function toRow(obj: object): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[snake(k)] = v;
  return out;
}

function fromRow<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  // numeric columns come back as strings from PostgREST
  for (const key of ["total", "recoveredAmount", "discountPct"]) {
    if (typeof out[key] === "string") out[key] = Number(out[key]);
  }
  return out as T;
}

/** Supabase (Postgres) store. Schema: supabase/schema.sql. Used when SUPABASE_URL is set. */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private readonly db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async one<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await q;
    if (error) throw new Error(`supabase: ${error.message}`);
    return fromRow<T>(data as Row);
  }

  private async maybe<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
    const { data, error } = await q;
    if (error) throw new Error(`supabase: ${error.message}`);
    return data ? fromRow<T>(data as Row) : null;
  }

  private async many<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
    const { data, error } = await q;
    if (error) throw new Error(`supabase: ${error.message}`);
    return ((data as Row[]) ?? []).map((r) => fromRow<T>(r));
  }

  createCart(input: NewCart): Promise<Cart> {
    return this.one(this.db.from("carts").insert(toRow(input)).select().single());
  }

  updateCart(id: string, patch: Partial<Omit<Cart, "id" | "createdAt">>): Promise<Cart> {
    return this.one(
      this.db
        .from("carts")
        .update({ ...toRow(patch), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single(),
    );
  }

  getCart(id: string): Promise<Cart | null> {
    return this.maybe(this.db.from("carts").select().eq("id", id).maybeSingle());
  }

  findCart(by: { sessionId?: string; paypalOrderId?: string; invoiceId?: string }): Promise<Cart | null> {
    let q = this.db.from("carts").select();
    if (by.paypalOrderId !== undefined) q = q.eq("paypal_order_id", by.paypalOrderId);
    else if (by.invoiceId !== undefined) q = q.eq("invoice_id", by.invoiceId);
    else if (by.sessionId !== undefined) q = q.eq("session_id", by.sessionId);
    else return Promise.resolve(null);
    return this.maybe(q.order("created_at", { ascending: false }).limit(1).maybeSingle());
  }

  listCarts(): Promise<Cart[]> {
    return this.many(this.db.from("carts").select().order("created_at", { ascending: false }).limit(500));
  }

  createConversation(
    input: Omit<Conversation, "id" | "startedAt" | "endedAt" | "outcome" | "unanswered" | "payLaterOffered" | "status">,
  ): Promise<Conversation> {
    return this.one(this.db.from("conversations").insert(toRow(input)).select().single());
  }

  updateConversation(id: string, patch: Partial<Omit<Conversation, "id">>): Promise<Conversation> {
    return this.one(this.db.from("conversations").update(toRow(patch)).eq("id", id).select().single());
  }

  getConversation(id: string): Promise<Conversation | null> {
    return this.maybe(this.db.from("conversations").select().eq("id", id).maybeSingle());
  }

  findOpenConversation(address: string): Promise<Conversation | null> {
    return this.maybe(
      this.db
        .from("conversations")
        .select()
        .eq("address", address)
        .eq("status", "open")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
  }

  listConversations(cartId?: string): Promise<Conversation[]> {
    let q = this.db.from("conversations").select();
    if (cartId) q = q.eq("cart_id", cartId);
    return this.many(q.order("started_at", { ascending: true }));
  }

  addMessage(input: Omit<Message, "id" | "createdAt">): Promise<Message> {
    return this.one(this.db.from("messages").insert(toRow(input)).select().single());
  }

  listMessages(conversationId: string): Promise<Message[]> {
    return this.many(this.db.from("messages").select().eq("conversation_id", conversationId).order("created_at", { ascending: true }));
  }

  addWebhookEvent(input: Omit<StoredWebhookEvent, "id" | "receivedAt">): Promise<StoredWebhookEvent> {
    return this.one(this.db.from("webhook_events").insert(toRow(input)).select().single());
  }

  listWebhookEvents(cartId?: string): Promise<StoredWebhookEvent[]> {
    let q = this.db.from("webhook_events").select();
    if (cartId) q = q.eq("cart_id", cartId);
    return this.many(q.order("received_at", { ascending: true }).limit(500));
  }

  addCheckoutEvent(input: Omit<CheckoutEvent, "id" | "createdAt">): Promise<CheckoutEvent> {
    return this.one(this.db.from("checkout_events").insert(toRow(input)).select().single());
  }

  listCheckoutEvents(cartId: string): Promise<CheckoutEvent[]> {
    return this.many(this.db.from("checkout_events").select().eq("cart_id", cartId).order("created_at", { ascending: true }));
  }
}
