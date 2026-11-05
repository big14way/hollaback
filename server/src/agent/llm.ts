import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { Config } from "../config.js";
import type { Message } from "../store/types.js";
import { classifyIntent } from "./guardrails.js";
import { FOLLOW_UP, kickoff, systemPrompt } from "./prompt.js";
import { createTools, toolDescriptions, toolSchemas } from "./tools.js";
import type { AgentContext, AgentEvent, RecoveryAgent } from "./types.js";

/**
 * Claude via the Vercel AI SDK. The model chooses tools; the tools enforce the rules
 * (discount cap, Pay Later before discount, opt-out handled before the model is called).
 */
export class ClaudeAgent implements RecoveryAgent {
  readonly name: string;
  private readonly model: LanguageModel;

  /** `model` can be injected (tests use the AI SDK's MockLanguageModelV2). */
  constructor(
    private readonly config: Config,
    model?: LanguageModel,
  ) {
    this.model = model ?? createAnthropic({ apiKey: config.agent.anthropicApiKey })(config.agent.model);
    this.name = `claude:${config.agent.model}`;
  }

  buildTools(ctx: AgentContext): ToolSet {
    const t = createTools(ctx);
    const own: ToolSet = {
      send_checkout_link: tool({
        description: toolDescriptions.send_checkout_link,
        inputSchema: toolSchemas.send_checkout_link,
        execute: () => t.send_checkout_link({}),
      }),
      offer_pay_later: tool({
        description: toolDescriptions.offer_pay_later,
        inputSchema: toolSchemas.offer_pay_later,
        execute: () => t.offer_pay_later({}),
      }),
      create_and_send_invoice: tool({
        description: toolDescriptions.create_and_send_invoice,
        inputSchema: toolSchemas.create_and_send_invoice,
        execute: (input) => t.create_and_send_invoice(input),
      }),
      apply_discount: tool({
        description: toolDescriptions.apply_discount,
        inputSchema: toolSchemas.apply_discount,
        execute: (input) => t.apply_discount(input),
      }),
      end_conversation: tool({
        description: toolDescriptions.end_conversation,
        inputSchema: toolSchemas.end_conversation,
        execute: (input) => t.end_conversation(input),
      }),
    };
    if (ctx.toolkit) return { ...own, ...ctx.toolkit.aiTools(ctx.logTool) };
    own.get_order = tool({
      description: toolDescriptions.get_order,
      inputSchema: toolSchemas.get_order,
      execute: () => t.get_order({}),
    });
    return own;
  }

  async respond(ctx: AgentContext, history: Message[], event: AgentEvent): Promise<string> {
    const messages: ModelMessage[] = [{ role: "user", content: kickoff(ctx.cart.abandonReason ?? "unknown") }];
    for (const m of history) {
      if (m.role === "agent" && m.body) messages.push({ role: "assistant", content: m.body });
      if (m.role === "shopper") messages.push({ role: "user", content: m.body });
    }
    if (event.kind === "follow_up") messages.push({ role: "user", content: FOLLOW_UP });
    if (event.kind === "reply") {
      // The shopper message is already in history; add the classifier's hint for the model.
      messages.push({ role: "user", content: `[hint] objection type: ${classifyIntent(event.text)}` });
    }

    // Sonnet 5.5 rejects non-default temperature and forced tool_choice, so neither is set.
    const result = await generateText({
      model: this.model,
      system: systemPrompt(ctx),
      messages,
      tools: this.buildTools(ctx),
      stopWhen: stepCountIs(6),
      maxOutputTokens: 1024,
    });
    return result.text.trim();
  }
}
