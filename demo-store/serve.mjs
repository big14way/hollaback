// Zero-dependency static server for the demo store (local dev).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FILES, render } from "./render.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.STORE_PORT || 5173);
const api = (process.env.HOLLABACK_API_URL || "http://localhost:4000").replace(/\/$/, "");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const path = new URL(req.url || "/", "http://localhost").pathname;
  const name = path === "/" ? "index.html" : path.slice(1);
  if (!FILES.includes(name)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  const body = await readFile(join(root, name), "utf8");
  res.writeHead(200, { "content-type": types[extname(name)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(render(name, body, api));
}).listen(port, () => {
  console.log(`Demo store on http://localhost:${port} (Hollaback API ${api})`);
});
