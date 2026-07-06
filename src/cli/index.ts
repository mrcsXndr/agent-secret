#!/usr/bin/env node
// agent-secret CLI — put / claim / meta / burn
//
//   npx agent-secret put OPENAI_API_KEY=sk-...      -> prints a claim code
//   npx agent-secret claim k7f2-9m3q                -> prints the secret (once)
//   npx agent-secret meta  k7f2-9m3q                -> did the agent pick it up?
//   npx agent-secret burn  k7f2-9m3q                -> destroy without claiming

import { parseArgs } from "node:util";
import { stdin } from "node:process";
import { putSecret, claimSecret, getMeta, burnSecret, resolveBaseUrl, ApiError } from "../shared/client.js";

const USAGE = `agent-secret — one-time secret share for AI agents

Usage:
  agent-secret put [NAME=]VALUE [--ttl 10m] [--passphrase X]   create a secret, get a claim code
  agent-secret put NAME - < file                               read the value from stdin
  agent-secret claim CODE [--passphrase X]                     claim (burns the secret)
  agent-secret meta CODE                                       check status (never shows the value)
  agent-secret burn CODE                                       destroy without claiming

Options:
  --url URL          API endpoint (or set AGENT_SECRET_URL)
  --ttl DURATION     time to live: 90s / 10m / 2h / 1d (default 10m, max 24h)
  --passphrase, -p   optional passphrase (second factor required at claim time)
  --name NAME        secret name (alternative to NAME=VALUE syntax)
  --help, -h         show this help

Tip: piping the value (put NAME - < key.txt) keeps the secret out of shell history.`;

function parseTtl(s: string): number {
  const m = /^(\d+)\s*(s|m|h|d)?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid --ttl "${s}" (use e.g. 90s, 10m, 2h, 1d)`);
  const mult = { s: 1, m: 60, h: 3600, d: 86_400 }[m[2] ?? "s"]!;
  return Number(m[1]) * mult;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
  const { values: flags, positionals } = parseArgs({
    options: {
      url: { type: "string" },
      ttl: { type: "string" },
      passphrase: { type: "string", short: "p" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  const [command, arg] = positionals;
  if (flags.help || !command) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const baseUrl = resolveBaseUrl(flags.url);

  switch (command) {
    case "put": {
      let name = flags.name;
      let value: string | undefined;
      if (arg !== undefined && arg !== "-") {
        const eq = arg.indexOf("=");
        if (eq > 0) {
          name = name ?? arg.slice(0, eq);
          value = arg.slice(eq + 1);
        } else if (!stdin.isTTY) {
          name = name ?? arg; // `put NAME` with piped value
        } else {
          value = arg; // bare value, no name
        }
      }
      if (value === undefined) {
        if (stdin.isTTY) throw new Error("No value given. Use NAME=VALUE or pipe the value on stdin.");
        value = await readStdin();
      }
      if (!value) throw new Error("Empty secret value.");

      const res = await putSecret(baseUrl, {
        value,
        name,
        ttlSeconds: flags.ttl ? parseTtl(flags.ttl) : undefined,
        passphrase: flags.passphrase,
      });

      const mins = Math.round(res.ttl / 60);
      console.log("");
      console.log(`  Claim code:  ${res.code}`);
      console.log(`  Expires:     ${res.expiresAt} (${mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`})`);
      console.log(`  Single-use:  burns on first claim${flags.passphrase ? "; passphrase required" : ""}`);
      console.log("");
      console.log("  Paste this into your agent chat (the code is safe to share — it is not the secret):");
      console.log("");
      console.log(
        `    Claim secret ${res.code} with agent-secret and save it to .env${name ? ` as ${name}` : ""}` +
          `${flags.passphrase ? " (I will give you the passphrase separately)" : ""}`,
      );
      console.log("");
      break;
    }

    case "claim": {
      if (!arg) throw new Error("Usage: agent-secret claim CODE");
      const res = await claimSecret(baseUrl, arg, flags.passphrase);
      // stdout gets ONLY the secret (pipe-friendly); context goes to stderr.
      console.error(`Claimed ${arg} — the secret is now burned server-side.`);
      console.log(res.name ? `${res.name}=${res.value}` : res.value);
      break;
    }

    case "meta": {
      if (!arg) throw new Error("Usage: agent-secret meta CODE");
      const meta = await getMeta(baseUrl, arg);
      if (!meta.exists) console.log("Not found (never existed, expired, or burned).");
      else if (meta.claimed) console.log(`Claimed at ${meta.claimedAt} — the agent picked it up.`);
      else
        console.log(
          `Unclaimed. Expires ${meta.expiresAt}.${meta.hasPassphrase ? " Passphrase required." : ""}`,
        );
      break;
    }

    case "burn": {
      if (!arg) throw new Error("Usage: agent-secret burn CODE");
      await burnSecret(baseUrl, arg);
      console.log(`Burned ${arg}.`);
      break;
    }

    default:
      console.log(USAGE);
      throw new Error(`Unknown command "${command}"`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof ApiError ? `${err.message} (${err.code})` : err instanceof Error ? err.message : String(err);
  console.error(`error: ${msg}`);
  process.exit(1);
});
