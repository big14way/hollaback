import { HARD_DISCOUNT_CAP_PCT } from "./agent/guardrails.js";

export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  demoStoreUrl: string;
  dashboardUrl: string;
  corsOrigins: string[] | true;
  mockPaypal: boolean;
  paypal: {
    clientId: string;
    clientSecret: string;
    apiBase: string;
    webhookId: string;
    environment: "sandbox" | "live";
  };
  graceMs: number;
  maxWaitMs: number;
  settleMs: number;
  followUpMs: number;
  discountCapPct: number;
  merchant: { id: string; name: string; currency: string; persona: string };
  agent: { anthropicApiKey: string; model: string; mode: "auto" | "claude" | "scripted" };
  twilio: { accountSid: string; authToken: string; whatsappFrom: string; validateSignature: boolean };
  supabase: { url: string; serviceRoleKey: string };
  snippetPath: string | null;
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const SANDBOX_API = "https://api-m.sandbox.paypal.com";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = num(env.PORT, 4000);
  // On Render, RENDER_EXTERNAL_URL is the service's own https://<name>.onrender.com URL.
  const publicUrl = (env.SERVER_PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, "");
  const clientId = env.PAYPAL_CLIENT_ID || "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET || "";
  const mockPaypal = env.MOCK_PAYPAL === "1" || env.MOCK_PAYPAL === "true" || !clientId || !clientSecret;
  const origins = (env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    port,
    host: env.HOST || "0.0.0.0",
    publicUrl,
    demoStoreUrl: (env.DEMO_STORE_URL || "http://localhost:5173").replace(/\/$/, ""),
    dashboardUrl: (env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, ""),
    corsOrigins: origins.length ? origins : true,
    mockPaypal,
    paypal: {
      clientId: mockPaypal ? env.PAYPAL_CLIENT_ID || "mock-client-id" : clientId,
      clientSecret: mockPaypal ? "mock-secret" : clientSecret,
      apiBase: (env.PAYPAL_API_BASE || SANDBOX_API).replace(/\/$/, ""),
      webhookId: env.PAYPAL_WEBHOOK_ID || "",
      environment: env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox",
    },
    graceMs: num(env.GRACE_MS, 30_000),
    maxWaitMs: num(env.ABANDON_MAX_WAIT_MS, 10 * 60_000),
    settleMs: num(env.ABANDON_SETTLE_MS, 3_000),
    followUpMs: num(env.FOLLOW_UP_MS, 15 * 60_000),
    discountCapPct: Math.min(num(env.DISCOUNT_CAP_PCT, HARD_DISCOUNT_CAP_PCT), HARD_DISCOUNT_CAP_PCT),
    merchant: {
      id: env.MERCHANT_ID || "demo",
      name: env.MERCHANT_NAME || "Kicks Lagos",
      currency: env.MERCHANT_CURRENCY || "USD",
      persona:
        env.MERCHANT_PERSONA ||
        "A friendly Lagos sneaker boutique. Warm, brief, a little playful. Never pushy.",
    },
    agent: {
      anthropicApiKey: env.ANTHROPIC_API_KEY || "",
      model: env.AGENT_MODEL || "claude-sonnet-5-5",
      mode: env.AGENT_MODE === "scripted" || env.AGENT_MODE === "claude" ? env.AGENT_MODE : "auto",
    },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || "",
      authToken: env.TWILIO_AUTH_TOKEN || "",
      whatsappFrom: env.TWILIO_WHATSAPP_FROM || "",
      validateSignature: env.TWILIO_VALIDATE_SIGNATURE !== "0",
    },
    supabase: {
      url: env.SUPABASE_URL || "",
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    },
    snippetPath: env.SNIPPET_PATH || null,
  };
}
