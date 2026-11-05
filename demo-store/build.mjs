// Static build for hosting (e.g. a Render static site): HOLLABACK_API_URL=https://... node build.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FILES, render } from "./render.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const out = join(root, "dist");
const api = process.env.HOLLABACK_API_URL || "http://localhost:4000";

await mkdir(out, { recursive: true });
for (const name of FILES) {
  const body = await readFile(join(root, name), "utf8");
  await writeFile(join(out, name), render(name, body, api));
}
console.log(`demo store built to ${out} (Hollaback API ${api})`);
