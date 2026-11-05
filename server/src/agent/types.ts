import type { Config } from "../config.js";
import type { PayPalClient } from "../paypal/client.js";
import type { Cart, Conversation, Message, Outcome, Store, ToolCallLog } from "../store/types.js";
import type { ToolkitBridge } from "./toolkit.js";

export type AgentEvent =
  | { kind: "abandoned"; reason: string }
  | { kind: "reply"; text: string }
  | { kind: "follow_up" };

export interface AgentContext {
  cart: Cart;
  conversation: Conversation;
  config: Config;
  store: Store;
  paypal: PayPalClient;
  /** PayPal Agent Toolkit tools (null in mock mode). */
  toolkit: ToolkitBridge | null;
  /** Links tools want delivered with this turn's reply (appended if the text omits them). */
  links: string[];
  /** Set by end_conversation. */
  ended: { outcome: Outcome; reason: string } | null;
  /** Persist a tool call to the transcript (messages.tool_call). */
  logTool(call: ToolCallLog): Promise<void>;
}

export interface RecoveryAgent {
  readonly name: string;
  /** Produce the agent's next message (tools may run as side effects). */
  respond(ctx: AgentContext, history: Message[], event: AgentEvent): Promise<string>;
}
