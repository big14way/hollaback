import type { Logger } from "./abandonment.js";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function fmt(obj: unknown): string {
  if (!obj || typeof obj !== "object") return obj === undefined ? "" : String(obj);
  return Object.entries(obj as Record<string, unknown>)
    .map(([k, v]) => {
      if (v instanceof Error) return `${k}=${JSON.stringify(v.message)}`;
      if (v && typeof v === "object") return `${k}=${JSON.stringify(v)}`;
      return `${k}=${String(v)}`;
    })
    .join(" ");
}

/** Small human-readable logger; the demo is watched in a terminal. */
export function createLogger(level: string = process.env.LOG_LEVEL || "info"): Logger & { debug(obj: unknown, msg?: string): void } {
  const min = ORDER[(level as Level) in ORDER ? (level as Level) : "info"];
  const write = (lvl: Level) => (obj: unknown, msg?: string) => {
    if (ORDER[lvl] < min) return;
    const time = new Date().toISOString().slice(11, 19);
    const line = `${time} ${lvl.toUpperCase().padEnd(5)} ${msg ?? ""} ${fmt(obj)}`.trimEnd();
    (lvl === "error" || lvl === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
