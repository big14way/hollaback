import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { PayPalApiError } from "../paypal/client.js";
import { RECOVERY_EVENT_TYPES, type WebhookEvent } from "../paypal/types.js";
import type { Cart } from "../store/types.js";

const IN_RECOVERY: ReadonlySet<Cart["status"]> = new Set(["abandoned", "contacted", "declined"]);

/** Which of our ids a PayPal event refers to. */
export function eventRefs(event: WebhookEvent): { orderId?: string; invoiceId?: string; resourceId: string | null } {
  const r = event.resource ?? {};
  if (event.event_type.startsWith("CHECKOUT.ORDER.")) {
    return { orderId: r.id as string | undefined, resourceId: (r.id as string) ?? null };
  }
  if (event.event_type.startsWith("PAYMENT.CAPTURE.")) {
    const related = (r.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids;
    return { orderId: related?.order_id, resourceId: (r.id as string) ?? null };
  }
  if (event.event_type.startsWith("INVOICING.INVOICE.")) {
    const invoice = (r.invoice as { id?: string } | undefined) ?? undefined;
    const id = invoice?.id ?? (r.id as string | undefined);
    return { invoiceId: id, resourceId: id ?? null };
  }
  return { resourceId: (r.id as string) ?? null };
}

function paidAmount(event: WebhookEvent): number | undefined {
  const r = event.resource ?? {};
  const amount = (r.amount as { value?: string } | undefined)?.value;
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && amount) return Number(amount);
  const inv = r.invoice as { amount?: { value?: string } } | undefined;
  if (event.event_type === "INVOICING.INVOICE.PAID" && inv?.amount?.value) return Number(inv.amount.value);
  return undefined;
}

export function registerWebhookRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config, store, paypal, recovery, log } = deps;

  app.post("/webhooks/paypal", async (req, reply) => {
    const event = req.body as WebhookEvent;
    if (!event || typeof event !== "object" || typeof event.event_type !== "string") {
      return reply.code(400).send({ ok: false, error: "not a PayPal webhook event" });
    }

    let verified = false;
    if (config.mockPaypal) {
      verified = true; // mock mode: events come from the in-process PayPal fake
    } else if (!config.paypal.webhookId) {
      log.warn({ type: event.event_type }, "PAYPAL_WEBHOOK_ID not set; cannot verify webhook, ignoring it");
    } else {
      try {
        verified = await paypal.verifyWebhookSignature({
          headers: req.headers as Record<string, string | string[] | undefined>,
          rawBody: req.rawBody ?? JSON.stringify(event),
          webhookId: config.paypal.webhookId,
        });
      } catch (err) {
        log.error({ err }, "webhook signature verification call failed");
      }
    }

    const refs = eventRefs(event);
    let cart: Cart | null = null;
    if (refs.orderId) cart = await store.findCart({ paypalOrderId: refs.orderId });
    if (!cart && refs.invoiceId) cart = await store.findCart({ invoiceId: refs.invoiceId });
    await store.addWebhookEvent({ eventType: event.event_type, resourceId: refs.resourceId, cartId: cart?.id ?? null, payload: event, verified });
    log.info({ type: event.event_type, resource: refs.resourceId, cart: cart?.id ?? "-", verified }, "PayPal webhook");

    if (!verified) return reply.code(400).send({ ok: false, error: "signature verification failed" });
    if (!cart || !(RECOVERY_EVENT_TYPES as readonly string[]).includes(event.event_type)) return { ok: true };

    if (event.event_type === "CHECKOUT.ORDER.APPROVED" && refs.orderId) {
      await store.updateCart(cart.id, { orderStatus: "APPROVED" });
      if (IN_RECOVERY.has(cart.status)) {
        // Shopper approved from the recovery link; capture so the money actually moves.
        try {
          await paypal.captureOrder(refs.orderId, `hb-capture-${refs.orderId}`);
        } catch (err) {
          if (!(err instanceof PayPalApiError && err.issue === "ORDER_ALREADY_CAPTURED")) {
            log.warn({ err, orderId: refs.orderId }, "auto-capture after approval failed");
          }
        }
      }
    }
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" || event.event_type === "CHECKOUT.ORDER.COMPLETED") {
      await store.updateCart(cart.id, { orderStatus: "COMPLETED" });
    }
    await recovery.onPayment(cart, event.event_type, paidAmount(event));
    return { ok: true };
  });
}
