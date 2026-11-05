import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { AbandonmentMonitor, type Logger } from "./abandonment.js";
import { ClaudeAgent } from "./agent/llm.js";
import { RecoveryService } from "./agent/recovery.js";
import { ScriptedAgent } from "./agent/scripted.js";
import { createToolkitBridge, type ToolkitBridge } from "./agent/toolkit.js";
import type { RecoveryAgent } from "./agent/types.js";
import { ConsoleChannel } from "./channels/console.js";
import { TwilioWhatsAppChannel } from "./channels/twilio.js";
import type { ChannelAdapter } from "./channels/types.js";
import type { Config } from "./config.js";
import { createLogger } from "./log.js";
import { PayPalClient } from "./paypal/client.js";
import { MockPayPal } from "./paypal/mock.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerMockRoutes } from "./routes/mock.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { createStore, type Store } from "./store/index.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export interface AppDeps {
  config: Config;
  store: Store;
  paypal: PayPalClient;
  mock: MockPayPal | null;
  monitor: AbandonmentMonitor;
  recovery: RecoveryService;
  channel: ChannelAdapter;
  agent: RecoveryAgent;
  toolkit: ToolkitBridge | null;
  log: Logger;
  snippetPath: string;
}

export interface BuildOverrides {
  store?: Store;
  channel?: ChannelAdapter;
  agent?: RecoveryAgent;
  log?: Logger;
}

export async function buildApp(config: Config, overrides: BuildOverrides = {}): Promise<{ app: FastifyInstance; deps: AppDeps }> {
  const log = overrides.log ?? createLogger();
  const store = overrides.store ?? createStore(config);
  const mock = config.mockPaypal ? new MockPayPal(config.publicUrl) : null;
  const paypal = new PayPalClient({
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
    apiBase: config.paypal.apiBase,
    fetch: mock?.fetch,
  });
  const channel: ChannelAdapter =
    overrides.channel ??
    (config.twilio.accountSid && config.twilio.authToken && config.twilio.whatsappFrom
      ? new TwilioWhatsAppChannel({ accountSid: config.twilio.accountSid, authToken: config.twilio.authToken, from: config.twilio.whatsappFrom })
      : new ConsoleChannel());
  const useClaude = config.agent.mode !== "scripted" && !!config.agent.anthropicApiKey;
  if (config.agent.mode === "claude" && !config.agent.anthropicApiKey) log.warn({}, "AGENT_MODE=claude but ANTHROPIC_API_KEY is not set; using the scripted agent");
  const agent: RecoveryAgent = overrides.agent ?? (useClaude ? new ClaudeAgent(config) : new ScriptedAgent());
  const toolkit = createToolkitBridge(config, log);

  const recovery = new RecoveryService({ store, paypal, config, agent, channel, toolkit, log });
  const monitor = new AbandonmentMonitor({
    store,
    paypal,
    graceMs: config.graceMs,
    maxWaitMs: config.maxWaitMs,
    settleMs: config.settleMs,
    log,
    onAbandoned: async (cart) => {
      await store.addCheckoutEvent({
        cartId: cart.id,
        type: "abandonment_confirmed",
        detail: { orderStatus: cart.orderStatus, reason: cart.abandonReason },
      });
      await recovery.onAbandoned(cart);
    },
  });

  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: true });
  await app.register(cors, { origin: config.corsOrigins, methods: ["GET", "POST", "PATCH", "OPTIONS"] });

  const parseJson = (body: string) => (body ? JSON.parse(body) : {});
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, parseJson(body as string));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
  // The snippet posts text/plain (sendBeacon / no CORS preflight); the body is JSON.
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, parseJson(body as string));
    } catch {
      done(null, body);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) log.error({ err, url: req.url }, "request failed");
    reply.code(status).send({ ok: false, error: err.message });
  });

  const deps: AppDeps = {
    config,
    store,
    paypal,
    mock,
    monitor,
    recovery,
    channel,
    agent,
    toolkit,
    log,
    snippetPath: config.snippetPath ?? fileURLToPath(new URL("../../snippet/dist/hb.js", import.meta.url)),
  };

  registerPublicRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  registerApiRoutes(app, deps);
  registerChannelRoutes(app, deps);
  if (mock) {
    registerMockRoutes(app, deps, mock);
    mock.onEvent = async (event) => {
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/paypal",
        payload: event,
        headers: { "content-type": "application/json", "paypal-transmission-id": `mock-${event.id}` },
      });
      if (res.statusCode >= 400) log.warn({ status: res.statusCode, body: res.body }, "mock webhook delivery failed");
    };
  }

  app.addHook("onClose", async () => {
    monitor.stopAll();
    recovery.stop();
  });

  return { app, deps };
}
