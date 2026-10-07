// npm run deploy [-- <extra wrangler deploy flags>]
// Deploys wrangler.local.jsonc (your ids, from `npm run setup`). Inside Workers
// Builds (the Deploy to Cloudflare button) it deploys the generic wrangler.jsonc,
// which auto-provisions the KV namespace. Anywhere else it refuses rather than
// deploy the template over an existing Worker with a fresh, empty namespace.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const local = `${root}wrangler.local.jsonc`;
const config = existsSync(local) ? ["--config", local] : process.env.WORKERS_CI === "1" ? [] : null;
if (!config) {
  console.error("No wrangler.local.jsonc yet. Run `npm run setup` first.");
  process.exit(1);
}
try {
  execFileSync(process.execPath, [`${root}node_modules/wrangler/bin/wrangler.js`, "deploy", ...config, ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
  });
} catch (e) {
  process.exit(e.status ?? 1);
}
