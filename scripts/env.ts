import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

/** Load .env from the repo root (and server/.env) for the CLI scripts. */
export function loadEnvFiles(): void {
  loadEnv({
    path: [fileURLToPath(new URL("../.env", import.meta.url)), fileURLToPath(new URL("../server/.env", import.meta.url))],
    quiet: true,
  });
}

export function requireEnv(...names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")}. Copy .env.example to .env and fill in your PayPal sandbox app credentials.`);
    process.exit(1);
  }
}
