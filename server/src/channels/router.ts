import type { Channel } from "../store/types.js";
import type { ChannelAdapter } from "./types.js";

/**
 * Picks the channel per shopper. Numbers on the console list (by default the demo store's
 * made-up shopper) stay on the console channel, so their conversation runs in the dashboard
 * even when the main channel is WhatsApp. Every other number uses the main channel.
 */
export class ChannelRouter {
  private readonly consoleNumbers: ReadonlySet<string>;

  constructor(
    readonly main: ChannelAdapter,
    private readonly console: ChannelAdapter,
    consoleNumbers: readonly string[],
  ) {
    this.consoleNumbers = new Set(consoleNumbers);
  }

  /** Channel for a new conversation with this normalized phone number. */
  forAddress(address: string): ChannelAdapter {
    return this.consoleNumbers.has(address) ? this.console : this.main;
  }

  /** Adapter for a conversation's stored channel. */
  byName(name: Channel): ChannelAdapter {
    return name === "console" ? this.console : this.main;
  }
}
