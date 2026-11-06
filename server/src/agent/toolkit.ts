import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { dynamicTool, type ToolSet } from "ai";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { ToolCallLog } from "../store/types.js";

/**
 * PayPal Agent Toolkit integration.
 *
 * `@paypal/agent-toolkit/ai-sdk` builds its tools with AI SDK v4's `tool({ parameters })`.
 * Hollaback runs AI SDK v5 (`inputSchema`), so the tools handed to the model are re-wrapped
 * with `dynamicTool` here. The rest run from Hollaback's guarded tools (tools.ts):
 * create_and_send_invoice creates and sends invoices through the toolkit, get_order reads the
 * order, and send_invoice_reminder reminds only the cart's own invoice. The model never gets
 * create_invoice, send_invoice or an unscoped reminder.
 */
export const TOOLKIT_ACTIONS = {
  orders: { get: true },
  invoices: { create: true, send: true, get: true, sendReminder: true, generateQRC: true },
};

/** Read-only toolkit tools the model calls directly, limited to the cart's own invoice. */
const MODEL_TOOLS = ["get_invoice", "generate_invoice_qr_code"] as const;

/** A toolkit tool as `getTools()` returns it (AI SDK v4 shape). */
export interface ToolkitTool {
  description?: string;
  parameters: unknown;
  execute?: (args: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;
}

export interface ToolkitResult {
  ok: boolean;
  output: unknown;
}

type LogFn = (call: ToolCallLog) => Promise<void>;
type Parser = { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { message: string } } };

export class ToolkitBridge {
  private raw: Record<string, ToolkitTool>;

  /** `load` builds the toolkit's tools. It runs again when PayPal rejects the toolkit's token. */
  constructor(private readonly load: () => Record<string, ToolkitTool>) {
    this.raw = load();
  }

  static fromConfig(config: Config): ToolkitBridge {
    return new ToolkitBridge(
      () =>
        new PayPalAgentToolkit({
          clientId: config.paypal.clientId,
          clientSecret: config.paypal.clientSecret,
          configuration: { actions: TOOLKIT_ACTIONS, context: { sandbox: config.paypal.environment !== "live" } },
        }).getTools() as unknown as Record<string, ToolkitTool>,
    );
  }

  get names(): string[] {
    return Object.keys(this.raw);
  }

  has(name: string): boolean {
    return typeof this.raw[name]?.execute === "function";
  }

  /** Execute a toolkit tool without logging it. The input is checked against the tool's own schema first. */
  async call(name: string, input: unknown): Promise<ToolkitResult> {
    let result = await this.execute(name, input);
    // The toolkit fetches one OAuth token and keeps it for the life of the process. Once PayPal
    // rejects it (expired, or minted before a scope was added), start a fresh toolkit and retry once.
    if (!result.ok && isAuthRejection(result.output)) {
      this.raw = this.load();
      result = await this.execute(name, input);
    }
    return result;
  }

  /** Execute a toolkit tool and log it to the transcript. */
  async run(name: string, input: unknown, log: LogFn): Promise<unknown> {
    const started = Date.now();
    const { ok, output } = await this.call(name, input);
    await log({ name, source: "paypal-agent-toolkit", input, output, ok, durationMs: Date.now() - started });
    return output;
  }

  /** AI SDK v5 tools for the model, each call logged. `invoiceId` is the only invoice they may touch. */
  aiTools(log: LogFn, scope: () => { invoiceId: string | null }): ToolSet {
    const set: ToolSet = {};
    for (const name of MODEL_TOOLS) {
      const t = this.raw[name];
      if (!t?.execute) continue;
      set[name] = dynamicTool({
        description: `[PayPal Agent Toolkit] ${t.description ?? name}`,
        inputSchema: t.parameters as Parameters<typeof dynamicTool>[0]["inputSchema"],
        execute: async (input) => {
          const own = scope().invoiceId;
          if (!own || (input as { invoice_id?: unknown })?.invoice_id !== own) {
            const output = { ok: false, reason: own ? `Only this shopper's invoice ${own} can be used.` : "No invoice has been sent to this shopper." };
            await log({ name, source: "paypal-agent-toolkit", input, output, ok: false, durationMs: 0 });
            return output;
          }
          return this.run(name, input, log);
        },
      });
    }
    return set;
  }

  private async execute(name: string, input: unknown): Promise<ToolkitResult> {
    const t = this.raw[name];
    if (!t?.execute) return { ok: false, output: { error: `toolkit tool ${name} is not enabled` } };
    const parser = t.parameters as Partial<Parser> | null;
    let args = input;
    if (typeof parser?.safeParse === "function") {
      const parsed = parser.safeParse(input);
      if (!parsed.success) return { ok: false, output: { error: `invalid ${name} input: ${parsed.error.message.slice(0, 300)}` } };
      args = parsed.data;
    }
    try {
      const result = await t.execute(args, { toolCallId: `hb-${randomUUID()}`, messages: [] });
      const output = typeof result === "string" ? safeJson(result) : result;
      return { ok: !isToolkitError(output), output };
    } catch (err) {
      return { ok: false, output: { error: String((err as Error)?.message ?? err) } };
    }
  }
}

/** The toolkit reports failures as `{ error: {...} }` or, for PayPal HTTP errors, `{ ok: false, status, code, message }`. */
function isToolkitError(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  return "error" in output || (output as { ok?: unknown }).ok === false;
}

function isAuthRejection(output: unknown): boolean {
  const status = (output as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

/** Short reason for a failed toolkit call, for transcripts and fallbacks. */
export function toolkitError(output: unknown): string {
  const o = (output ?? {}) as { error?: unknown; message?: unknown };
  if (typeof o.error === "string") return o.error;
  const nested = (o.error as { message?: unknown } | undefined)?.message;
  if (typeof nested === "string") return nested;
  if (typeof o.message === "string") return o.message;
  return JSON.stringify(output ?? null).slice(0, 200);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function createToolkitBridge(config: Config, log?: { warn(obj: unknown, msg?: string): void }): ToolkitBridge | null {
  if (config.mockPaypal) return null;
  try {
    return ToolkitBridge.fromConfig(config);
  } catch (err) {
    log?.warn({ err }, "PayPal Agent Toolkit unavailable; continuing with Hollaback tools only");
    return null;
  }
}
