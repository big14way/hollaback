import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { validateTwilioSignature } from "../channels/twilio.js";
import { normalizePhone } from "../util.js";

const ConsoleInbound = z.object({ from: z.string().min(4).max(40), body: z.string().min(1).max(2000) });

export function registerChannelRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config, recovery, store, log } = deps;

  /** Twilio WhatsApp inbound webhook (form-encoded). Configure it in the Twilio sandbox settings. */
  app.post("/whatsapp/inbound", async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;
    if (config.twilio.authToken && config.twilio.validateSignature) {
      const url = `${config.publicUrl}${req.url}`;
      const sig = req.headers["x-twilio-signature"];
      if (!validateTwilioSignature(config.twilio.authToken, url, params, Array.isArray(sig) ? sig[0] : sig)) {
        log.warn({ url }, "rejected WhatsApp inbound with a bad Twilio signature");
        return reply.code(403).send("invalid signature");
      }
    }
    const from = normalizePhone(params.From);
    const body = (params.Body ?? "").trim();
    if (from && body) {
      const res = await recovery.handleInbound(from, body);
      if (!res.handled) log.info({ from }, "WhatsApp message with no open conversation");
    }
    return reply.type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
  });

  /** Console channel inbound: simulate a shopper reply without Twilio. */
  app.post("/channels/console/inbound", async (req, reply) => {
    if (deps.channel.name !== "console") return reply.code(409).send({ ok: false, error: "console channel is not active" });
    const parsed = ConsoleInbound.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues });
    const from = normalizePhone(parsed.data.from);
    if (!from) return reply.code(400).send({ ok: false, error: "from must be an international phone number" });
    return recovery.handleInbound(from, parsed.data.body);
  });

  /** Dashboard helper: reply as the shopper of a cart (console channel only). */
  app.post<{ Params: { id: string } }>("/api/carts/:id/reply", async (req, reply) => {
    if (deps.channel.name !== "console") return reply.code(409).send({ ok: false, error: "console channel is not active" });
    const body = z.object({ body: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: body.error.issues });
    const cart = await store.getCart(req.params.id);
    if (!cart?.shopperPhone) return reply.code(404).send({ ok: false, error: "cart has no shopper phone" });
    return recovery.handleInbound(cart.shopperPhone, body.data.body);
  });
}
