export interface CartItem {
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Pipeline status of a cart:
 * active -> pending (PayPal order created, grace timer running) -> abandoned -> contacted -> recovered
 * plus the exits: paid (finished without help), declined (opted out), expired (order voided).
 */
export type CartStatus = "active" | "pending" | "abandoned" | "contacted" | "recovered" | "paid" | "declined" | "expired";

export type Outcome = "recovered" | "declined" | "no_reply" | "invoice_sent";

export type Channel = "whatsapp" | "console";

export interface Cart {
  id: string;
  merchantId: string;
  sessionId: string | null;
  shopperName: string | null;
  shopperPhone: string | null;
  shopperEmail: string | null;
  consent: boolean;
  items: CartItem[];
  total: number;
  currency: string;
  paypalOrderId: string | null;
  orderStatus: string | null;
  payerActionUrl: string | null;
  payLaterEligible: boolean;
  status: CartStatus;
  abandonReason: string | null;
  orderCreatedAt: string | null;
  abandonedAt: string | null;
  recoveredAt: string | null;
  recoveryChannel: Channel | null;
  recoveredAmount: number | null;
  discountPct: number;
  invoiceId: string | null;
  invoiceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NewCart = Pick<Cart, "merchantId" | "items" | "total" | "currency"> & Partial<Omit<Cart, "id" | "createdAt" | "updatedAt">>;

export interface Conversation {
  id: string;
  cartId: string;
  channel: Channel;
  address: string;
  status: "open" | "closed";
  outcome: Outcome | null;
  /** Agent messages sent since the shopper last replied. */
  unanswered: number;
  payLaterOffered: boolean;
  startedAt: string;
  endedAt: string | null;
}

export interface ToolCallLog {
  name: string;
  source: "hollaback" | "paypal-agent-toolkit";
  input: unknown;
  output: unknown;
  ok: boolean;
  durationMs: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "agent" | "shopper" | "system";
  body: string;
  toolCall: ToolCallLog | null;
  createdAt: string;
}

export interface StoredWebhookEvent {
  id: string;
  eventType: string;
  resourceId: string | null;
  cartId: string | null;
  payload: unknown;
  verified: boolean;
  receivedAt: string;
}

export interface CheckoutEvent {
  id: string;
  cartId: string;
  type: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface Store {
  readonly kind: "memory" | "memory+postgres" | "supabase";
  createCart(input: NewCart): Promise<Cart>;
  updateCart(id: string, patch: Partial<Omit<Cart, "id" | "createdAt">>): Promise<Cart>;
  getCart(id: string): Promise<Cart | null>;
  findCart(by: { sessionId?: string; paypalOrderId?: string; invoiceId?: string }): Promise<Cart | null>;
  listCarts(): Promise<Cart[]>;

  createConversation(input: Omit<Conversation, "id" | "startedAt" | "endedAt" | "outcome" | "unanswered" | "payLaterOffered" | "status">): Promise<Conversation>;
  updateConversation(id: string, patch: Partial<Omit<Conversation, "id">>): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  findOpenConversation(address: string): Promise<Conversation | null>;
  listConversations(cartId?: string): Promise<Conversation[]>;

  addMessage(input: Omit<Message, "id" | "createdAt">): Promise<Message>;
  listMessages(conversationId: string): Promise<Message[]>;

  addWebhookEvent(input: Omit<StoredWebhookEvent, "id" | "receivedAt">): Promise<StoredWebhookEvent>;
  listWebhookEvents(cartId?: string): Promise<StoredWebhookEvent[]>;

  addCheckoutEvent(input: Omit<CheckoutEvent, "id" | "createdAt">): Promise<CheckoutEvent>;
  listCheckoutEvents(cartId: string): Promise<CheckoutEvent[]>;
}
