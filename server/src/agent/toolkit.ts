import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { dynamicTool, type ToolSet } from "ai";
import type { Config } from "../config.js";
import type { ToolCallLog } from "../store/types.js";

/**
 * PayPal Agent Toolkit integration.
 *
 * `@paypal/agent-toolkit/ai-sdk` builds its tools with AI SDK v4's `tool({ parameters })`.
 * Hollaback runs AI SDK v5 (`inputSchema`), so each toolkit tool is re-wrapped with
 * `dynamicTool` here. The toolkit gets read and reminder actions; anything that moves
 * money (discounts, new invoices) goes through Hollaback's guarded tools instead.
 */
export const TOOLKIT_ACTIONS = {
  orders: { get: true },
  invoices: { get: true, sendReminder: true, generateQRC: true },
};

interface V4Tool {
  description?: string;
  parameters: unknown;
  execute?: (args: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;
}

type LogFn = (call: ToolCallLog) => Promise<void>;

export class ToolkitBridge {
  private readonly raw: Record<string, V4Tool>;

  constructor(config: Config) {
    const toolkit = new PayPalAgentToolkit({
      clientId: config.paypal.clientId,
      clientSecret: config.paypal.clientSecret,
      configuration: {
        actions: TOOLKIT_ACTIONS,
        context: { sandbox: config.paypal.environment !== "live" },
      },
    });
    this.raw = toolkit.getTools() as unknown as Record<string, V4Tool>;
  }

  get names(): string[] {
    return Object.keys(this.raw);
  }

  has(name: string): boolean {
    return typeof this.raw[name]?.execute === "function";
  }

  /** Execute a toolkit tool directly (deterministic paths) and log it to the transcript. */
  async run(name: string, input: unknown, log: LogFn): Promise<unknown> {
    const t = this.raw[name];
    if (!t?.execute) throw new Error(`toolkit tool ${name} is not enabled`);
    const started = Date.now();
    let output: unknown;
    let ok = true;
    try {
      const result = await t.execute(input, { toolCallId: `hb-${Date.now()}`, messages: [] });
      output = typeof result === "string" ? safeJson(result) : result;
      if (output && typeof output === "object" && "error" in output) ok = false;
    } catch (err) {
      ok = false;
      output = { error: String((err as Error)?.message ?? err) };
    }
    await log({ name, source: "paypal-agent-toolkit", input, output, ok, durationMs: Date.now() - started });
    return output;
  }

  /** AI SDK v5 tools for the model, each call logged to the transcript. */
  aiTools(log: LogFn): ToolSet {
    const set: ToolSet = {};
    for (const [name, t] of Object.entries(this.raw)) {
      if (!t.execute) continue;
      set[name] = dynamicTool({
        description: `[PayPal Agent Toolkit] ${t.description ?? name}`,
        inputSchema: t.parameters as Parameters<typeof dynamicTool>[0]["inputSchema"],
        execute: (input) => this.run(name, input, log),
      });
    }
    return set;
  }
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
    return new ToolkitBridge(config);
  } catch (err) {
    log?.warn({ err }, "PayPal Agent Toolkit unavailable; continuing with Hollaback tools only");
    return null;
  }
}
