import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter } from "./types.js";

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  /** e.g. "whatsapp:+14155238886" (the Twilio WhatsApp sandbox number) */
  from: string;
  fetch?: typeof fetch;
}

/** WhatsApp via the Twilio Messages REST API (works with the free WhatsApp sandbox). */
export class TwilioWhatsAppChannel implements ChannelAdapter {
  readonly name = "whatsapp" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: TwilioOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async send(to: string, body: string): Promise<{ id: string }> {
    const from = this.opts.from.startsWith("whatsapp:") ? this.opts.from : `whatsapp:${this.opts.from}`;
    const params = new URLSearchParams({ From: from, To: `whatsapp:${to.replace(/^whatsapp:/, "")}`, Body: body.slice(0, 1600) });
    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");
    const res = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.opts.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !data.sid) throw new Error(`Twilio send failed (${res.status} ${data.code ?? ""}): ${data.message ?? "unknown error"}`);
    return { id: data.sid };
  }
}

/**
 * Validate X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)).
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
