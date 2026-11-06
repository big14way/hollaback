import type { InvoiceDraft, PayPalInvoice } from "../paypal/types.js";
import { toolkitError } from "./toolkit.js";
import type { AgentContext } from "./types.js";

export const VIA_TOOLKIT = "paypal-agent-toolkit";

export interface IssuedInvoice {
  invoiceId: string;
  status: string | null;
  recipientViewUrl: string | null;
  via: typeof VIA_TOOLKIT | "rest";
  /** Toolkit steps that failed and were redone with the REST client. */
  fallbacks: string[];
}

/**
 * create_invoice input in the toolkit's shape: flat `invoicer_*` and detail fields, with
 * recipients and items in PayPal's nested shape. That shape has no payment term field.
 */
export function toolkitInvoiceInput(draft: InvoiceDraft): Record<string, unknown> {
  return {
    currency_code: draft.detail.currency_code,
    reference: draft.detail.reference,
    note: draft.detail.note,
    invoicer_business_name: draft.invoicer?.business_name,
    primary_recipients: draft.primary_recipients,
    items: draft.items,
  };
}

/** Without `Prefer: return=representation` PayPal answers a create with a link to the new invoice. */
function invoiceIdFrom(output: unknown): string | null {
  const o = (output ?? {}) as { id?: unknown; href?: unknown };
  const id = typeof o.id === "string" ? o.id : typeof o.href === "string" ? o.href.split("/").pop() : undefined;
  return id && /^[A-Za-z0-9_-]{1,127}$/.test(id) ? id : null;
}

/**
 * Create, send and read back a PayPal invoice. Runs through the PayPal Agent Toolkit when it is
 * configured; the REST client covers mock mode (the toolkit only talks to PayPal itself) and any
 * toolkit step that fails. Once the toolkit has created the invoice, a failed step is redone for
 * that same invoice, so a shopper never gets two.
 */
export async function issueInvoice(ctx: AgentContext, draft: InvoiceDraft): Promise<IssuedInvoice> {
  const tk = ctx.toolkit;
  const fallbacks: string[] = [];

  if (tk?.has("create_invoice") && tk.has("send_invoice")) {
    const created = await tk.call("create_invoice", toolkitInvoiceInput(draft));
    const invoiceId = created.ok ? invoiceIdFrom(created.output) : null;
    if (invoiceId) {
      const sent = await tk.call("send_invoice", { invoice_id: invoiceId, send_to_recipient: true });
      if (!sent.ok) {
        fallbacks.push(`send_invoice: ${toolkitError(sent.output)}`);
        await ctx.paypal.sendInvoice(invoiceId);
      }
      let invoice: PayPalInvoice | null = null;
      if (tk.has("get_invoice")) {
        const read = await tk.call("get_invoice", { invoice_id: invoiceId });
        if (read.ok) invoice = read.output as PayPalInvoice;
        else fallbacks.push(`get_invoice: ${toolkitError(read.output)}`);
      }
      invoice ??= await ctx.paypal.getInvoice(invoiceId);
      return {
        invoiceId,
        status: invoice.status ?? null,
        recipientViewUrl: invoice.detail?.metadata?.recipient_view_url ?? null,
        via: VIA_TOOLKIT,
        fallbacks,
      };
    }
    fallbacks.push(`create_invoice: ${created.ok ? "no invoice id in the response" : toolkitError(created.output)}`);
  }

  const invoiceId = await ctx.paypal.createInvoice(draft);
  await ctx.paypal.sendInvoice(invoiceId);
  const invoice = await ctx.paypal.getInvoice(invoiceId);
  return { invoiceId, status: invoice.status, recipientViewUrl: invoice.detail.metadata?.recipient_view_url ?? null, via: "rest", fallbacks };
}

/** PayPal's own reminder email for an invoice that was already sent: through the toolkit, else REST. */
export async function remindInvoice(
  ctx: AgentContext,
  invoiceId: string,
  notification: { subject: string; note: string },
): Promise<{ via: typeof VIA_TOOLKIT | "rest"; fallbacks: string[] }> {
  const fallbacks: string[] = [];
  if (ctx.toolkit?.has("send_invoice_reminder")) {
    const res = await ctx.toolkit.call("send_invoice_reminder", { invoice_id: invoiceId, ...notification });
    if (res.ok) return { via: VIA_TOOLKIT, fallbacks };
    fallbacks.push(`send_invoice_reminder: ${toolkitError(res.output)}`);
  }
  await ctx.paypal.remindInvoice(invoiceId, notification);
  return { via: "rest", fallbacks };
}
