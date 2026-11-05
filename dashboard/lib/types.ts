export type CartStatus = "active" | "pending" | "abandoned" | "contacted" | "recovered" | "paid" | "declined" | "expired";
export type Outcome = "recovered" | "declined" | "no_reply" | "invoice_sent" | "paid";

export interface CartItem {
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CartRow {
  id: string;
  shopperName: string | null;
  shopperPhone: string | null;
  shopperEmail: string | null;
  consent: boolean;
  items: CartItem[];
  total: number;
  effectiveTotal: number;
  currency: string;
  paypalOrderId: string | null;
  orderStatus: string | null;
  payerActionUrl: string | null;
  status: CartStatus;
  abandonReason: string | null;
  abandonedAt: string | null;
  recoveredAt: string | null;
  recoveredAmount: number | null;
  discountPct: number;
  invoiceId: string | null;
  invoiceUrl: string | null;
  channel: string | null;
  outcome: Outcome | null;
  createdAt: string;
  updatedAt: string;
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
  role: "agent" | "shopper" | "system";
  body: string;
  toolCall: ToolCallLog | null;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  channel: string;
  address: string;
  status: "open" | "closed";
  outcome: Outcome | null;
  startedAt: string;
  endedAt: string | null;
  messages: Message[];
}

export interface CartDetail {
  cart: CartRow;
  conversations: ConversationView[];
  events: Array<{ id: string; type: string; detail: Record<string, unknown>; createdAt: string }>;
  webhooks: Array<{ id: string; eventType: string; resourceId: string | null; verified: boolean; receivedAt: string }>;
  channel: string;
}

export interface Stats {
  carts: number;
  abandoned: number;
  contacted: number;
  recovered: number;
  recoveredRevenue: number;
  recoveryRate: number;
  currency: string;
}

/** GET /config: public, non-secret server settings. */
export interface PublicConfig {
  mock: boolean;
  environment: "sandbox" | "live";
  merchant: { id: string; name: string; currency: string };
  channel: string;
  agent: string;
  graceMs: number;
  policy?: { discountCapPct: number; followUpMs: number; maxWaitMs: number; webhookVerified: boolean; toolkit: string[] };
}
