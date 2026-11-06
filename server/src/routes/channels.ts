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

  // The two routes below are unauthenticated, so they only ever reach console conversations
  // (the console channel, or CONSOLE_NUMBERS on a WhatsApp server), never a real WhatsApp chat.

  /** Console channel inbound: simulate a shopper reply without Twilio. */
  app.post("/channels/console/inbound", async (req, reply) => {
    const parsed = ConsoleInbound.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues });
    const from = normalizePhone(parsed.data.from);
    if (!from) return reply.code(400).send({ ok: false, error: "from must be an international phone number" });
    const res = await recovery.handleInbound(from, parsed.data.body, "console");
    if (!res.handled && deps.channel.name !== "console") {
      return reply.code(409).send({ ok: false, error: "no open console conversation for this number" });
    }
    return res;
  });

  /** Dashboard helper: reply as the shopper of a cart whose conversation runs on the console channel. */
  app.post<{ Params: { id: string } }>("/api/carts/:id/reply", async (req, reply) => {
    const body = z.object({ body: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: body.error.issues });
    const cart = await store.getCart(req.params.id);
    if (!cart) return reply.code(404).send({ ok: false, error: "cart not found" });
    // This cart's own conversation: many carts can share the demo shopper's number.
    const conv = (await store.listConversations(cart.id)).filter((c) => c.status === "open").at(-1);
    if (!conv) return { handled: false };
    if (conv.channel !== "console") {
      return reply.code(409).send({ ok: false, error: "this conversation runs on WhatsApp; the shopper replies there" });
    }
    return recovery.receive(conv, body.data.body);
  });
}
