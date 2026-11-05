/**
 * Register Hollaback's webhook with PayPal: POST /v1/notifications/webhooks.
 * Usage: pnpm paypal:webhook [https://your-server/webhooks/paypal]
 * Defaults to $SERVER_PUBLIC_URL/webhooks/paypal. PayPal requires a public HTTPS URL
 * (Render, or a tunnel such as cloudflared/ngrok for local runs).
 * Prints the webhook id to put in PAYPAL_WEBHOOK_ID.
 */
import { loadConfig } from "../server/src/config.js";
import { PayPalApiError, PayPalClient } from "../server/src/paypal/client.js";
import { RECOVERY_EVENT_TYPES } from "../server/src/paypal/types.js";
import { loadEnvFiles, requireEnv } from "./env.js";

loadEnvFiles();
requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");

const config = loadConfig({ ...process.env, MOCK_PAYPAL: "0" });
const url = process.argv[2] || `${config.publicUrl}/webhooks/paypal`;
if (!url.startsWith("https://")) {
  console.error(`PayPal only delivers to public HTTPS URLs. Got: ${url}\nPass one explicitly: pnpm paypal:webhook https://<host>/webhooks/paypal`);
  process.exit(1);
}

const paypal = new PayPalClient({ clientId: config.paypal.clientId, clientSecret: config.paypal.clientSecret, apiBase: config.paypal.apiBase });

const existing = (await paypal.listWebhooks()).find((w) => w.url === url);
if (existing) {
  console.log(`Webhook already registered for ${url}`);
  console.log(`PAYPAL_WEBHOOK_ID=${existing.id}`);
  console.log(`Events: ${existing.event_types.map((e) => e.name).join(", ")}`);
  process.exit(0);
}

try {
  const hook = await paypal.createWebhook(url, RECOVERY_EVENT_TYPES);
  console.log(`✓ Registered ${url}`);
  console.log(`  Events: ${RECOVERY_EVENT_TYPES.join(", ")}`);
  console.log(`\nAdd this to .env:\nPAYPAL_WEBHOOK_ID=${hook.id}`);
  console.log(`\nTry it: POST /v1/notifications/simulate-event with webhook_id=${hook.id} and event_type=CHECKOUT.ORDER.APPROVED`);
} catch (err) {
  if (err instanceof PayPalApiError) console.error(`${err.message}\n${JSON.stringify(err.details, null, 2)}`);
  else console.error(err);
  process.exit(1);
}
