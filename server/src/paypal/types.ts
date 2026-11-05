export interface Money {
  currency_code: string;
  value: string;
}

export interface LinkDescription {
  href: string;
  rel: string;
  method?: string;
}

export type OrderStatus = "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";

export interface OrderItem {
  name: string;
  quantity: string;
  unit_amount: Money;
  sku?: string;
  category?: "PHYSICAL_GOODS" | "DIGITAL_GOODS" | "DONATION";
}

export interface PurchaseUnit {
  reference_id?: string;
  description?: string;
  custom_id?: string;
  amount: Money & {
    breakdown?: {
      item_total?: Money;
      discount?: Money;
      shipping?: Money;
      tax_total?: Money;
    };
  };
  items?: OrderItem[];
  payments?: { captures?: Array<{ id: string; status: string; amount: Money }> };
}

export interface CreateOrderRequest {
  intent: "CAPTURE" | "AUTHORIZE";
  purchase_units: PurchaseUnit[];
  payment_source?: {
    paypal?: {
      experience_context?: {
        return_url?: string;
        cancel_url?: string;
        user_action?: "PAY_NOW" | "CONTINUE";
        brand_name?: string;
        shipping_preference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";
      };
      email_address?: string;
    };
  };
}

export interface PayPalOrder {
  id: string;
  status: OrderStatus;
  intent?: string;
  purchase_units?: PurchaseUnit[];
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  links?: LinkDescription[];
  create_time?: string;
  update_time?: string;
}

export interface PatchOperation {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
}

export interface InvoiceItem {
  name: string;
  quantity: string;
  unit_amount: Money;
  description?: string;
}

export interface InvoiceDraft {
  detail: {
    currency_code: string;
    note?: string;
    reference?: string;
    invoice_number?: string;
    payment_term?: { term_type: string };
  };
  invoicer?: { business_name?: string; email_address?: string };
  primary_recipients: Array<{
    billing_info: { email_address: string; name?: { given_name?: string; surname?: string } };
  }>;
  items: InvoiceItem[];
}

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "PARTIALLY_PAID"
  | "UNPAID";

export interface PayPalInvoice {
  id: string;
  status: InvoiceStatus;
  detail: InvoiceDraft["detail"] & {
    metadata?: { recipient_view_url?: string; invoicer_view_url?: string; create_time?: string };
  };
  primary_recipients?: InvoiceDraft["primary_recipients"];
  items?: InvoiceItem[];
  amount?: Money;
  links?: LinkDescription[];
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  summary?: string;
  create_time?: string;
  resource: Record<string, unknown>;
}

export interface VerifySignatureInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  webhookId: string;
}

export const RECOVERY_EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
  "PAYMENT.CAPTURE.COMPLETED",
  "INVOICING.INVOICE.PAID",
] as const;
