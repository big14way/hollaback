import { build } from "esbuild";
import { statSync } from "node:fs";

const MAX_BYTES = 15 * 1024;
const outfile = new URL("./dist/hb.js", import.meta.url).pathname;

await build({
  entryPoints: [new URL("./src/index.ts", import.meta.url).pathname],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018"],
  legalComments: "none",
  banner: { js: "/* Hollaback snippet | MIT */" },
});

const size = statSync(outfile).size;
console.log(`hb.js built: ${size} bytes (${(size / 1024).toFixed(1)} KB, limit 15 KB)`);
if (size > MAX_BYTES) {
  console.error("hb.js exceeds the 15 KB budget");
  process.exit(1);
}
