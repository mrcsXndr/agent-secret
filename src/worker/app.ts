import { Hono } from "hono";
import { generateCode, normalizeCode } from "./codes.js";
import { FORM_CSS, FORM_HTML, FORM_JS } from "./form.js";
import { LLMS_TXT, escapeHtml } from "./agent-docs.js";

// Minimal structural subset of Cloudflare's KVNamespace — lets tests supply an
// in-memory implementation without depending on workers-types.
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Bindings {
  SECRETS: KV;
  RATE_LIMIT_PER_MIN?: string;
}

export const DEFAULT_TTL_S = 600; // 10 minutes
export const MIN_TTL_S = 60;
export const MAX_TTL_S = 86_400; // 24 hours
// The server stores only ciphertext. A 16 KiB plaintext becomes ~22 KiB of
// base64; 48 KiB leaves generous headroom without inviting KV abuse.
export const MAX_BLOB_BYTES = 49_152;

// A stored secret is opaque ciphertext + nonce. The encryption key lives ONLY
// in the sharer's link fragment and never reaches this server — so nothing
// here, nor a full KV dump, can recover a plaintext secret. That is the point.
interface LiveRecord {
  v: 2;
  claimed: false;
  ct: string; // base64 AES-256-GCM ciphertext (tag appended), encrypted client-side
  iv: string; // base64 12-byte nonce
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

interface Tombstone {
  v: 2;
  claimed: true;
  claimedAt: number;
  expiresAt: number;
}

type Record_ = LiveRecord | Tombstone;

const secretKey = (code: string) => `secret:${code}`;

/** KV expirationTtl must be >= 60s; add a buffer so the logical expiresAt check fires first. */
const kvTtl = (ttlSeconds: number) => Math.max(ttlSeconds, MIN_TTL_S) + 60;

// Loose base64 shape check (std or url-safe alphabet). Content is opaque to us.
const isB64 = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(s);

// Link unfurlers (Telegram/Slack/Discord/etc.) fetch a pasted URL to build a
// preview. Since claiming is a bare GET that burns the secret, an unfurl would
// destroy it before the agent ever reads it. We detect these crawlers and
// serve them a harmless note instead of touching the record.
const UNFURLERS =
  /TelegramBot|Slackbot|Discordbot|WhatsApp|facebookexternalhit|Twitterbot|LinkedInBot|Googlebot|Google-InspectionTool|bingbot|BingPreview|redditbot|Applebot|SkypeUriPreview|vkShare|Iframely|Embedly|Pinterest/i;

// Public documents served by the Worker itself (the page and /og.png etc. are
// covered elsewhere). Crawled freely, so they skip the rate limit.
const PUBLIC_DOCS = new Set(["/favicon.ico", "/robots.txt", "/llms.txt", "/sitemap.xml", "/.well-known/security.txt"]);
const REPO = "https://github.com/mrcsXndr/agent-secret";

const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------- rate limit
// Fixed-window per-IP counter in KV. Coarse and per-colo (KV is eventually
// consistent), so it is a soft speed bump against code enumeration, not a hard
// bound — the 31^8 code space is the real guard. Skips the form and incidental
// static probes so neither spends KV.
app.use("*", async (c, next) => {
  const p = c.req.path;
  if ((c.req.method === "GET" && p === "/") || PUBLIC_DOCS.has(p)) return next();
  const limit = Number.parseInt(c.env.RATE_LIMIT_PER_MIN ?? "30", 10) || 30;
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const windowKey = `rl:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const count = Number.parseInt((await c.env.SECRETS.get(windowKey)) ?? "0", 10);
  if (count >= limit) {
    return c.json({ error: "rate_limited", message: "Too many requests; try again in a minute." }, 429);
  }
  // Fail-open: KV caps writes at ~1/s per key; a burst that throws must not 500.
  try {
    await c.env.SECRETS.put(windowKey, String(count + 1), { expirationTtl: 120 });
  } catch {
    /* ignore — the counter is best-effort */
  }
  return next();
});

// ------------------------------------------------------------------- web form
const sha256b64 = async (s: string) =>
  btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))));

// Hashes of the page's one inline script and one inline style, computed once
// on the first request (digest is async, so not at module load).
let formHashes: { js: string; css: string } | undefined;

app.get("/", async (c) => {
  formHashes ??= { js: await sha256b64(FORM_JS), css: await sha256b64(FORM_CSS) };
  // The plaintext + key live in this page's DOM (all client-side). Lock it down:
  // only our own script and style run (by hash), no external anything,
  // un-framable, no referrer leakage.
  c.header(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'sha256-${formHashes.js}'; style-src 'sha256-${formHashes.css}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "public, max-age=300");
  const url = new URL(c.req.url);
  return c.html(
    FORM_HTML.replaceAll("{{origin}}", escapeHtml(url.origin))
      .replaceAll("{{host}}", escapeHtml(url.host))
      .replaceAll("{{scripthash}}", formHashes.js),
  );
});

app.get("/favicon.ico", (c) => c.body(null, 204));
// Link previews (LinkedIn, Slack, ...) honour robots.txt, so the landing page,
// its preview image, icons and public docs stay fetchable; claim links do not.
app.get("/robots.txt", (c) => {
  c.header("Cache-Control", "public, max-age=3600");
  const allow = ["/$", "/llms.txt", "/og.png", "/favicon.svg", "/apple-touch-icon.png", "/sitemap.xml", "/.well-known/security.txt"];
  return c.text(
    `User-agent: *\n${allow.map((p) => `Allow: ${p}\n`).join("")}Disallow: /\n\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`,
  );
});
// Only the public documents. Claim links are never listed anywhere.
app.get("/sitemap.xml", (c) => {
  const o = escapeHtml(new URL(c.req.url).origin);
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${o}/</loc></url>\n  <url><loc>${o}/llms.txt</loc></url>\n</urlset>\n`,
  );
});
// RFC 9116. Expires rolls forward with each request: the contact is the repo's
// advisory form, which stays valid as long as this code is deployed.
app.get("/.well-known/security.txt", (c) => {
  const day = 86_400_000;
  const expires = new Date(Math.floor(Date.now() / day) * day + 180 * day).toISOString();
  c.header("Cache-Control", "public, max-age=3600");
  return c.text(
    `Contact: ${REPO}/security/advisories/new\nExpires: ${expires}\nPolicy: ${REPO}/blob/main/SECURITY.md\n` +
      `Preferred-Languages: en\nCanonical: ${new URL(c.req.url).origin}/.well-known/security.txt\n`,
  );
});
// Plain-text protocol for agents (the llms.txt convention).
app.get("/llms.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(LLMS_TXT.replaceAll("{{origin}}", new URL(c.req.url).origin));
});

// --------------------------------------------------------------------- create
// Accepts ONLY ciphertext. The client encrypts before this call; the server
// never sees a plaintext secret or the key.
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !isB64(body.ct) || !isB64(body.iv)) {
    return c.json(
      { error: "bad_request", message: "Body must include base64 `ct` (ciphertext) and `iv` (nonce)." },
      400,
    );
  }
  if (body.ct.length + body.iv.length > MAX_BLOB_BYTES) {
    return c.json({ error: "too_large", message: `Encrypted payload exceeds ${MAX_BLOB_BYTES} bytes.` }, 413);
  }

  let ttl = DEFAULT_TTL_S;
  if (body.ttl !== undefined) {
    const t = Number(body.ttl);
    if (!Number.isFinite(t) || t <= 0) {
      return c.json({ error: "bad_request", message: "ttl must be a positive number of seconds." }, 400);
    }
    ttl = Math.min(Math.max(Math.floor(t), MIN_TTL_S), MAX_TTL_S);
  }

  // Collision-safe code pick (space is 31^8; collisions are effectively theoretical).
  let code = generateCode();
  for (let i = 0; i < 4 && (await c.env.SECRETS.get(secretKey(code))) !== null; i++) {
    code = generateCode();
  }

  const now = Date.now();
  const expiresAt = now + ttl * 1000;
  const record: LiveRecord = { v: 2, claimed: false, ct: body.ct, iv: body.iv, createdAt: now, expiresAt };
  await c.env.SECRETS.put(secretKey(code), JSON.stringify(record), { expirationTtl: kvTtl(ttl) });

  c.header("Cache-Control", "no-store");
  return c.json({ code, expiresAt: new Date(expiresAt).toISOString(), ttl }, 201);
});

// ----------------------------------------------------------------------- meta
// Lifecycle only — never any ciphertext. Safe to poll. Registered before the
// bare `/:code` claim so it wins for the two-segment path.
app.get("/:code/meta", async (c) => {
  c.header("Cache-Control", "no-store");
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "bad_request", message: "Malformed claim code." }, 400);

  const raw = await c.env.SECRETS.get(secretKey(code));
  if (raw === null) return c.json({ exists: false });
  const record = JSON.parse(raw) as Record_;
  if (record.claimed) {
    return c.json({
      exists: true,
      claimed: true,
      claimedAt: new Date(record.claimedAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
    });
  }
  if (Date.now() >= record.expiresAt) return c.json({ exists: false });
  return c.json({ exists: true, claimed: false, expiresAt: new Date(record.expiresAt).toISOString() });
});

// ---------------------------------------------------------------------- claim
// A single GET returns the ciphertext and burns the secret. The caller decrypts
// locally with the key from the link fragment — the server hands back only
// opaque bytes and can never assist decryption. URL is just /<code>.
app.get("/:code", async (c) => {
  c.header("Cache-Control", "no-store");
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "not_found", message: "No such secret." }, 404);

  // Serve link-preview crawlers a no-op — never mutate the record for them,
  // or the preview would burn the secret before the agent claims it.
  if (UNFURLERS.test(c.req.header("user-agent") ?? "")) {
    return c.json({
      note: "One-time agent-secret link. Your agent claims it with a direct GET, which reveals it once and destroys it.",
    });
  }

  const raw = await c.env.SECRETS.get(secretKey(code));
  if (raw === null) {
    return c.json({ error: "not_found", message: "No such secret. It may have expired." }, 404);
  }
  const record = JSON.parse(raw) as Record_;
  if (record.claimed) {
    return c.json({ error: "already_claimed", message: "This secret was already claimed (single-use)." }, 410);
  }
  if (Date.now() >= record.expiresAt) {
    await c.env.SECRETS.delete(secretKey(code));
    return c.json({ error: "expired", message: "This secret has expired." }, 410);
  }

  // Overwrite with a tombstone before returning the ciphertext. NOTE: this is
  // best-effort single-use — Workers KV is eventually consistent with no
  // compare-and-set, so two claims racing within KV's propagation window can
  // both read the live record. For strict once-only semantics, front this with
  // a Durable Object. Confidentiality is unaffected either way.
  const tombstone: Tombstone = { v: 2, claimed: true, claimedAt: Date.now(), expiresAt: record.expiresAt };
  const remainingTtl = Math.ceil((record.expiresAt - Date.now()) / 1000);
  await c.env.SECRETS.put(secretKey(code), JSON.stringify(tombstone), { expirationTtl: kvTtl(remainingTtl) });

  return c.json({ ct: record.ct, iv: record.iv });
});

// ---------------------------------------------------------------------- errors
// Hono's default handler logs the whole error, and a JSON.parse message quotes
// part of its input (a stored record). Log the error class only, and never
// echo anything back.
app.onError((err, c) => {
  console.error(`unhandled ${err.name}`);
  c.header("Cache-Control", "no-store");
  return c.json({ error: "internal", message: "Internal error." }, 500);
});

// ----------------------------------------------------------------------- burn
app.delete("/:code", async (c) => {
  c.header("Cache-Control", "no-store");
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "bad_request", message: "Malformed claim code." }, 400);
  await c.env.SECRETS.delete(secretKey(code));
  return c.body(null, 204);
});

export default app;
