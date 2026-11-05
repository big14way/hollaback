/**
 * Sandbox smoke test: OAuth2 token -> POST /v2/checkout/orders -> GET /v2/checkout/orders/{id}.
 * Usage: pnpm paypal:smoke   (needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)
 */
import { loadConfig } from "../server/src/config.js";
import { buildOrderRequest } from "../server/src/orders.js";
import { PayPalClient, payerActionUrl } from "../server/src/paypal/client.js";
import type { Cart } from "../server/src/store/types.js";
import { loadEnvFiles, requireEnv } from "./env.js";

loadEnvFiles();
requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");

const config = loadConfig({ ...process.env, MOCK_PAYPAL: "0" });
const paypal = new PayPalClient({
  clientId: config.paypal.clientId,
  clientSecret: config.paypal.clientSecret,
  apiBase: config.paypal.apiBase,
});

const cart = {
  id: `smoke-${Date.now()}`,
  items: [{ name: "Air Runners", quantity: 1, unitPrice: 89 }],
  currency: "USD",
  discountPct: 0,
} as Cart;

console.log(`PayPal API: ${config.paypal.apiBase}`);
await paypal.accessToken();
console.log("✓ OAuth2 client_credentials token");

const created = await paypal.createOrder(buildOrderRequest(cart, config), cart.id);
console.log(`✓ POST /v2/checkout/orders -> ${created.id} (${created.status})`);
console.log(`  payer-action link: ${payerActionUrl(created)}`);

const fetched = await paypal.getOrder(created.id);
console.log(`✓ GET  /v2/checkout/orders/${fetched.id} -> ${fetched.status}, ${fetched.purchase_units?.[0]?.amount.value} ${fetched.purchase_units?.[0]?.amount.currency_code}`);

if (!["CREATED", "PAYER_ACTION_REQUIRED"].includes(fetched.status)) {
  console.error(`Unexpected status ${fetched.status}`);
  process.exit(1);
}
console.log("\nSandbox smoke test passed. Open the payer-action link and log in with a sandbox personal account to approve.");
