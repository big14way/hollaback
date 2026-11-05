import { randomUUID } from "node:crypto";
import type { ChannelAdapter } from "./types.js";

/**
 * Local channel: prints outbound messages to the server log so the full recovery loop
 * runs without Twilio. Shopper replies come in via POST /channels/console/inbound
 * (or the "reply as shopper" box on the dashboard transcript page).
 */
export class ConsoleChannel implements ChannelAdapter {
  readonly name = "console" as const;
  readonly outbox: Array<{ to: string; body: string; at: string }> = [];

  constructor(private readonly opts: { quiet?: boolean } = {}) {}

  async send(to: string, body: string): Promise<{ id: string }> {
    this.outbox.push({ to, body, at: new Date().toISOString() });
    if (!this.opts.quiet) {
      const lines = body.split("\n").flatMap((l) => wrap(l, 72));
      const width = Math.max(24, ...lines.map((l) => l.length));
      const bar = "─".repeat(width + 2);
      const out = [
        `\n┌${bar}┐  WhatsApp (console) → ${to}`,
        ...lines.map((l) => `│ ${l.padEnd(width)} │`),
        `└${bar}┘\n`,
      ].join("\n");
      process.stdout.write(`${out}\n`);
    }
    return { id: `console-${randomUUID()}` };
  }
}

/** Word-wrap for the console box; long tokens such as URLs stay whole. */
function wrap(line: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(" ")) {
    if (cur && (cur + " " + word).length > width) {
      out.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  out.push(cur);
  return out;
}
