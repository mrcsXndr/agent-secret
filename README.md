# agent-secret

**One-time secret share, built for AI agents.**

You need to get an API key into your AI agent's environment. Pasting it into the chat means it lives in the transcript, the logs, and the model context — forever. `agent-secret` fixes the handoff:

- **You** get a short **claim code** like `k7f2-9m3q`. The code is a pointer, not the secret — **safe to paste into any chat**.
- **Your agent** exchanges the code for the secret **programmatically** (via an MCP tool) and writes it straight to `.env`. The value never appears in the conversation.
- The secret is **single-use** (burns on claim) and **expires** fast (10 min by default).

> The claim code is safe to share. The secret is not. That asymmetry is the whole product.

## 30-second happy path

**1. Human** — store the secret, get a code:

```console
$ npx agent-secret put OPENAI_API_KEY=sk-abc123...

  Claim code:  k7f2-9m3q
  Expires:     2026-07-06T17:27:57Z (10m)
  Single-use:  burns on first claim

  Paste this into your agent chat (the code is safe to share — it is not the secret):

    Claim secret k7f2-9m3q with agent-secret and save it to .env as OPENAI_API_KEY
```

**2. Human** — paste that one line into the agent chat.

**3. Agent** — calls the `claim_secret` MCP tool with `save_to: ".env"`. The MCP server writes `OPENAI_API_KEY=sk-abc123...` into `.env` and tells the agent only:

```
Claimed k7f2-9m3q: wrote OPENAI_API_KEY to /project/.env. The secret is burned
server-side and its value was not shown.
```

Done. The secret went human → encrypted store → agent's env file. The chat only ever saw `k7f2-9m3q`.

## Why not just paste it in chat?

| | Paste the key in chat | Paste a claim code |
|---|---|---|
| Lands in the transcript / logs | forever | just a dead pointer |
| Enters the model context | yes | code only |
| Reusable if leaked | yes, until you rotate | no — single-use + TTL |
| Revocable | no | yes (`burn`, or wait out the TTL) |

A leaked claim code is worthless after the agent claims it (or after ~10 minutes). A leaked API key is an incident.

## Setup

### 1. Deploy the Worker (self-host, ~2 minutes)

The backend is a single Cloudflare Worker + KV namespace. Free tier is fine.

```bash
git clone <this repo> && cd agent-secret && npm install
npx wrangler kv namespace create SECRETS   # paste the returned id into wrangler.toml
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
npx wrangler secret put MASTER_KEY         # paste the generated key when prompted
npx wrangler deploy
```

Your endpoint is `https://agent-secret.<your-subdomain>.workers.dev`. It also serves a tiny web form at `/` for putting secrets from a browser.

Local dev: copy `.dev.vars.example` to `.dev.vars`, fill in a key, then `npm run dev`.

### 2. Point the human tools at it

```bash
export AGENT_SECRET_URL=https://agent-secret.<you>.workers.dev
npx agent-secret put MY_KEY=value        # or:  npx agent-secret put MY_KEY - < key.txt
```

Tip: the `put NAME - < file` / pipe form keeps the value out of your shell history.

### 3. Add the MCP server to your agent

> **Not on npm yet.** Until `agent-secret` is published, run the MCP server from your built checkout: `npm run build` once, then point the command at `dist/mcp/server.js` (absolute path). The npm/`npx` forms below light up the moment it's published.

**From your checkout (works today):**

```json
{
  "mcpServers": {
    "agent-secret": {
      "command": "node",
      "args": ["/absolute/path/to/agent-secret/dist/mcp/server.js"],
      "env": { "AGENT_SECRET_URL": "https://agent-secret.<you>.workers.dev" }
    }
  }
}
```

**Once published to npm** — Claude Code:

```bash
claude mcp add agent-secret \
  -e AGENT_SECRET_URL=https://agent-secret.<you>.workers.dev \
  -- npx -y --package agent-secret agent-secret-mcp
```

Claude Desktop / any MCP client (`mcpServers` config):

```json
{
  "mcpServers": {
    "agent-secret": {
      "command": "npx",
      "args": ["-y", "--package", "agent-secret", "agent-secret-mcp"],
      "env": { "AGENT_SECRET_URL": "https://agent-secret.<you>.workers.dev" }
    }
  }
}
```

The server exposes two tools:

- **`claim_secret(code, passphrase?, save_to?, env_name?)`** — claims and burns. With `save_to` (e.g. `".env"`) the MCP server writes `NAME=value` into that file itself and **the value never enters the model context**. Without `save_to` the value is returned inline (with a warning). Always prefer `save_to`.
- **`put_secret(name?, value, ttl_seconds?, passphrase?)`** — the reverse direction: the agent stores a secret and hands back a chat-safe claim code.

## CLI reference

```
agent-secret put [NAME=]VALUE [--ttl 10m] [--passphrase X]   create, print claim code
agent-secret put NAME - < file                               value from stdin
agent-secret claim CODE [--passphrase X]                     claim (burns); value on stdout
agent-secret meta CODE                                       status — never shows the value
agent-secret burn CODE                                       destroy without claiming
```

`--url` overrides `AGENT_SECRET_URL`. TTL accepts `90s / 10m / 2h / 1d` (default 10m, min 60s, hard max 24h). `meta` is handy for the human: it flips to "Claimed at …" the moment the agent picks the secret up.

## API

| Route | Body | Returns |
|---|---|---|
| `POST /secret` | `{value, name?, ttl?, passphrase?}` | `201 {code, expiresAt, ttl}` |
| `POST /secret/:code/claim` | `{passphrase?}` | `200 {name?, value}` **once**; `401` wrong/missing passphrase; `404` unknown; `410` claimed/expired |
| `GET /secret/:code/meta` | — | `{exists, claimed?, hasPassphrase?, expiresAt?}` — never the value |
| `DELETE /secret/:code` | — | `204` |

## Security model

- **Encrypted at rest** — AES-256-GCM via Web Crypto before the value touches KV. Key derived per-secret (random salt + IV) from a `MASTER_KEY` that lives only in Worker secrets, so a KV data leak alone exposes nothing. The stored name is encrypted too.
- **Optional passphrase (you rarely need it)** — off by default and safe to ignore. Single-use + a short TTL already make an intercepted code near-worthless, so a passphrase only earns its keep in one case: the claim code leaks *and* an attacker claims it inside the TTL window before your agent does (e.g. a shared chat log claimed within minutes). When you do use it, it's mixed into the key derivation (PBKDF2-SHA256, 100k iterations) — a wrong passphrase just fails decryption; nothing passphrase-derived is stored, and five wrong attempts destroy the secret. Share it out-of-band, not in the same chat as the code.
- **Single-use + TTL** — burns on first claim; expires at TTL (default 10 min, max 24h) regardless.
- **Rate limiting** — per-IP, per-minute across all `/secret*` routes (default 30/min, `RATE_LIMIT_PER_MIN` var) against code enumeration and passphrase guessing.
- **Codes** — 8 chars from a confusable-free alphabet ≈ 2^39 space; combined with rate limits and short TTLs, online guessing is not practical.

### Honest limitations (v1)

- **The server sees plaintext at put/claim time.** Encryption protects data at rest in KV; it is not end-to-end. Self-host so the operator is you. E2E (client-side encryption, passphrase-only keys) is a natural v2.
- **Strict single-use vs. agent retries.** A retry after a successful claim gets `410 already_claimed` — the MCP client must use the value from the first response (the tool description says so; the `save_to` flow makes retries moot since the file is already written). KV is also eventually consistent, so two *simultaneous* claims racing across edge locations could, in a narrow window, both succeed; a Durable-Object-backed strict burn is the v2 fix if that matters to you.
- **`put NAME=VALUE` as a CLI arg can land in shell history** — use the stdin form (`put NAME - < file`) or the web form for high-value keys.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest — create/claim/burn/expiry/passphrase/meta/rate-limit/crypto
npm run dev         # wrangler dev (needs .dev.vars, see .dev.vars.example)
npm run build       # emit dist/ (CLI + MCP bins)
```

Layout: single package — `src/worker` (Hono app + crypto), `src/mcp` (stdio MCP server), `src/cli`, `src/shared` (HTTP client used by both).

## Naming

Shipping as `agent-secret` for now. Candidate brand names if this grows up: **Claimcode**, **Burnbox**, **Keydrop**, **Deadrop**.

## License

MIT
