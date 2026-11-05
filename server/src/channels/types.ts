import type { Channel } from "../store/types.js";

/** Outbound messaging channel. Inbound messages arrive through HTTP routes. */
export interface ChannelAdapter {
  readonly name: Channel;
  send(to: string, body: string): Promise<{ id: string }>;
}
