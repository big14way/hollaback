import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

loadEnv({
  path: [fileURLToPath(new URL("../../.env", import.meta.url)), fileURLToPath(new URL("../.env", import.meta.url))],
  quiet: true,
});

const config = loadConfig();
const { app, deps } = await buildApp(config);

await app.listen({ port: config.port, host: config.host });

const line = (k: string, v: string) => `  ${k.padEnd(12)} ${v}`;
process.stdout.write(
  [
    "",
    `Hollaback server listening on ${config.publicUrl}`,
    line("PayPal", config.mockPaypal ? "MOCK (in-process fake of Orders v2 / Invoicing v2 / Webhooks)" : `${config.paypal.environment} ${config.paypal.apiBase}`),
    line("Store", deps.store.kind),
    line(
      "Channel",
      deps.channel.name === "console"
        ? "console (messages print here)"
        : `Twilio WhatsApp; console for ${config.consoleNumbers.length} demo number${config.consoleNumbers.length === 1 ? "" : "s"}`,
    ),
    line("Agent", deps.agent.name),
    line("Toolkit", deps.toolkit ? deps.toolkit.names.join(", ") : "off (mock mode)"),
    line("Grace", `${config.graceMs / 1000}s`),
    line("Snippet", `${config.publicUrl}/hb.js`),
    "",
  ].join("\n") + "\n",
);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
