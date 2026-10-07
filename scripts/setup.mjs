// npm run setup [-- --domain secrets.example.com] [--kv-id <existing namespace id>] [--force]
// Creates the KV namespace with wrangler (or reuses --kv-id) and writes
// wrangler.local.jsonc (gitignored) from the wrangler.jsonc template.
// `npm run deploy` then deploys that file.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const LOCAL = `${root}wrangler.local.jsonc`;
const WRANGLER = `${root}node_modules/wrangler/bin/wrangler.js`;

const args = process.argv.slice(2);
const force = args.includes("--force");
const di = args.indexOf("--domain");
const domain = di >= 0 ? args[di + 1] : undefined;
if (di >= 0 && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain ?? "")) {
  console.error("--domain needs a hostname, e.g. --domain secrets.example.com");
  process.exit(1);
}
const ki = args.indexOf("--kv-id");
const existingId = ki >= 0 ? args[ki + 1] : undefined;
if (ki >= 0 && !/^[0-9a-f]{32}$/.test(existingId ?? "")) {
  console.error("--kv-id needs a 32-character namespace id (npx wrangler kv namespace list)");
  process.exit(1);
}
if (existsSync(LOCAL) && !force) {
  console.log("wrangler.local.jsonc already exists. Run `npm run deploy`, or `npm run setup -- --force` to redo it.");
  process.exit(0);
}

// The template has only whole-line // comments, so dropping those lines leaves JSON.
const template = JSON.parse(
  readFileSync(`${root}wrangler.jsonc`, "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n"),
);

function createNamespace() {
  console.log("Creating the KV namespace (wrangler may open a browser to log you in)...");
  // Wrangler fills the new id into an id-less SECRETS binding of whatever config it
  // reads, even with --no-update-config. Point it at a throwaway config so the
  // committed template is never touched.
  const tmp = mkdtempSync(join(tmpdir(), "agent-secret-setup-"));
  writeFileSync(join(tmp, "wrangler.jsonc"), JSON.stringify({ name: template.name, compatibility_date: template.compatibility_date }));
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [WRANGLER, "kv", "namespace", "create", "agent-secret", "--binding", "SECRETS", "--no-update-config", "--config", join(tmp, "wrangler.jsonc")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const id = /"id":\s*"([0-9a-f]{32})"/.exec(out)?.[1] ?? /\bid\s*=\s*"([0-9a-f]{32})"/.exec(out)?.[1];
  if (!id) {
    console.error(`Could not find the namespace id in wrangler's output:\n${out}`);
    process.exit(1);
  }
  return id;
}
const id = existingId ?? createNamespace();

const config = { ...template, kv_namespaces: [{ binding: "SECRETS", id }] };
if (process.env.CLOUDFLARE_ACCOUNT_ID) config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
if (domain) config.routes = [{ pattern: domain, custom_domain: true }];
writeFileSync(
  LOCAL,
  `// Written by \`npm run setup\`. Gitignored: it holds your account's resource ids.\n${JSON.stringify(config, null, 2)}\n`,
);
console.log(`Wrote wrangler.local.jsonc (KV ${id}${domain ? `, custom domain ${domain}` : ", workers.dev URL"}). Next: npm run deploy`);
