<div align="center">

<br>

```
    ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
    █                                                               █
    █    █████╗  ██████╗ ███████╗███╗   ██╗████████╗               █
    █   ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝               █
    █   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║      · secret ·   █
    █   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║                   █
    █   ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   zero-knowledge  █
    █   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   one-time share  █
    █                                                               █
    ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

<sub>v1.0.0</sub>

[![Cloudflare Workers](https://img.shields.io/badge/cloudflare-workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Zero-knowledge](https://img.shields.io/badge/crypto-AES--256--GCM-34d399?style=flat)](#-how-it-stays-zero-knowledge)
[![Agent needs just a fetch](https://img.shields.io/badge/agent%20needs-just%20a%20fetch-7c6cff?style=flat)](#-for-the-agent)
[![License](https://img.shields.io/badge/license-MIT-black?style=flat)](./LICENSE)

<br>

**encrypt in the browser · hand your agent a self-destructing link · the server never sees it**

<br>

[**▶ agent-secret.xndr.io**](https://agent-secret.xndr.io)

<br>

---

<br>

</div>

## ⚡ what it does

You need to get an API key into an AI agent. Paste it into the chat and it lives in the transcript, the logs, and the model context — forever. `agent-secret` fixes the handoff:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   [ YOU ]                    [ agent-secret ]              [ YOUR AGENT ] │
│                                                                          │
│   type secret   ──encrypt──▶  stores only        ──fetch──▶  fetches +   │
│   in browser     in browser   ciphertext + iv     one time   decrypts    │
│                               (never the key)                locally     │
│                                                                          │
│                          🔥 burns on first read                          │
└──────────────────────────────────────────────────────────────────────────┘
```

The encryption key is generated **in your browser** and lives **only** inside the instruction you hand your agent. It never touches the server. So a full database dump — or a subpoena, or a rogue operator reading the source — recovers **nothing but ciphertext**. That's the whole product.

<br>

## ✦ the flow

**1. You** open [agent-secret.xndr.io](https://agent-secret.xndr.io), type the secret + an optional name, hit **Encrypt**. One click copies a block that's deliberately tiny — one line and one link:

```
OPENAI_API_KEY — one-time secret (agent-secret). Single GET burns it; then AES-256-GCM
decrypt: response {ct,iv} base64, key = URL #fragment (base64url), ct = ciphertext+16-byte
tag, plaintext = the value.
https://s.xndr.io/k7f2-9m3q#Xy9…KEY
```

**2. You** paste that into your agent's chat.

**3. Your agent** `GET`s the link (curl and fetch drop the `#fragment`, so the server only sees `/k7f2-9m3q`), decrypts the returned `{ct,iv}` with the key from the fragment, and writes the value wherever it keeps secrets. The value never went through the model as something *you* typed, and the link is now dead.

> The **whole handoff is one short link**: `/<code>#<key>`. The key rides in the fragment — which browsers, `curl`, and `fetch` never transmit — so it reaches your agent but never the server.

<br>

## 🔒 how it stays zero-knowledge

```
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│  ◆ CLIENT-SIDE CRYPTO   AES-256-GCM in the browser (WebCrypto). Only     │
│                         ciphertext + a random nonce are ever POSTed.     │
│                                                                          │
│  ◆ KEY NEVER SENT       the 256-bit key is generated in-page and baked   │
│                         into the copy block. The server can't derive,    │
│                         log, or store it — it never arrives.             │
│                                                                          │
│  ◆ SINGLE-USE           the first GET returns the ciphertext and writes  │
│                         a tombstone in the same step. Read #2 → 410.     │
│                                                                          │
│  ◆ SHORT TTL            5 min – 24 h, auto-purged from KV on expiry.     │
│                                                                          │
│  ◆ RATE LIMITED         per-IP fixed window blunts code enumeration.     │
│                                                                          │
│  ◆ NO SERVER SECRETS    the Worker holds no keys of its own. Read the    │
│                         source — nothing there can read a stored secret. │
│                         Verifiable, not a promise.                       │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

**Threat model, honestly.** The claim code **and** the decryption key travel together inside the block you paste. Whoever holds that block can decrypt — exactly once — so treat it like the secret until your agent has claimed it. Because it's single-use, an interceptor who reads it first makes your agent's fetch fail: **tamper is loud, not silent.** What the server *cannot* do, by construction, is read your secret — at rest or in flight.

<br>

## 🤖 for the agent

No install, no MCP, no SDK. Given the link `https://s.xndr.io/<code>#<key>`, an agent needs **one HTTP GET and a standard AES-256-GCM decrypt**:

```
GET https://s.xndr.io/<code>        # send WITHOUT the #fragment (curl/fetch already drop it)
  → 200 {"ct":"<base64>","iv":"<base64>"}   (and the secret is now burned)
  → 410 already_claimed | expired
  → 404 not found

decrypt:  AES-256-GCM
  key    = base64url-decode(<the #fragment>)   # 32 bytes
  nonce  = base64-decode(iv)                    # 12 bytes
  tag    = last 16 bytes of base64-decode(ct)
  data   = base64-decode(ct) minus the tag
  plain  = the secret value (UTF-8)
```

<br>

## 🛰 api

| Method   | Path          | Purpose                                                          |
|----------|---------------|------------------------------------------------------------------|
| `GET`    | `/`           | The share form (all crypto runs here).                           |
| `POST`   | `/`           | Create. Body `{ ct, iv, ttl? }` (base64 ciphertext + nonce). → `{ code, expiresAt, ttl }` |
| `GET`    | `/:code`      | **Claim + burn.** → `{ ct, iv }` once, then `410`.               |
| `GET`    | `/:code/meta` | Lifecycle only — `{ exists, claimed?, expiresAt? }`. Never ciphertext. |
| `DELETE` | `/:code`      | Destroy immediately.                                             |

<br>

## 🚀 self-host

It's a single Cloudflare Worker + one KV namespace. **No secrets to configure** — the server is stateless about keys by design.

```console
$ git clone https://github.com/mrcsXndr/agent-secret && cd agent-secret
$ npm install

$ npx wrangler kv namespace create SECRETS      # paste the id into wrangler.toml
$ npx wrangler deploy                            # bind a custom domain in wrangler.toml

$ npm run dev                                    # local: http://localhost:8787
$ npm test                                       # vitest — incl. full E2E round-trip
```

`RATE_LIMIT_PER_MIN` (default `30`) is the only knob, in `wrangler.toml`.

<br>

## 🧱 stack

`Cloudflare Workers` · `Hono` · `Workers KV` · `WebCrypto (AES-256-GCM)` · `TypeScript` · `Vitest` — no runtime dependencies beyond Hono.

<br>

<div align="center">
<sub>built by <a href="https://xndr.io">XNDR</a> · MIT</sub>
</div>
