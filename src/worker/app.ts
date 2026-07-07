import { Hono } from "hono";
import { generateCode, normalizeCode } from "./codes.js";
import { FORM_HTML } from "./form.js";

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
// in the sharer's copy block and never reaches this server — so nothing here,
// nor a full KV dump, can recover a plaintext secret. That is the whole point.
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

const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------- rate limit
// Fixed-window per-IP counter in KV. Coarse but effective against code
// enumeration; applies to all /s* routes.
app.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/s")) return next();
  const limit = Number.parseInt(c.env.RATE_LIMIT_PER_MIN ?? "30", 10) || 30;
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const windowKey = `rl:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const count = Number.parseInt((await c.env.SECRETS.get(windowKey)) ?? "0", 10);
  if (count >= limit) {
    return c.json({ error: "rate_limited", message: "Too many requests; try again in a minute." }, 429);
  }
  await c.env.SECRETS.put(windowKey, String(count + 1), { expirationTtl: 120 });
  return next();
});

// --------------------------------------------------------------------- create
// Accepts ONLY ciphertext. The client encrypts before this call; the server
// never sees a plaintext secret, a name, or the key.
app.post("/s", async (c) => {
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
  const record: LiveRecord = {
    v: 2,
    claimed: false,
    ct: body.ct,
    iv: body.iv,
    createdAt: now,
    expiresAt,
  };
  await c.env.SECRETS.put(secretKey(code), JSON.stringify(record), { expirationTtl: kvTtl(ttl) });

  return c.json({ code, expiresAt: new Date(expiresAt).toISOString(), ttl }, 201);
});

// ---------------------------------------------------------------------- claim
// A single GET returns the ciphertext and burns the secret. The caller decrypts
// locally with the key from the copy block — the server hands back only opaque
// bytes and can never assist decryption.
app.get("/s/:code", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "bad_request", message: "Malformed claim code." }, 400);

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

  // Burn first: replace with a tombstone before returning, so a duplicate
  // in-flight request cannot read the same ciphertext twice.
  const tombstone: Tombstone = { v: 2, claimed: true, claimedAt: Date.now(), expiresAt: record.expiresAt };
  const remainingTtl = Math.ceil((record.expiresAt - Date.now()) / 1000);
  await c.env.SECRETS.put(secretKey(code), JSON.stringify(tombstone), { expirationTtl: kvTtl(remainingTtl) });

  return c.json({ ct: record.ct, iv: record.iv });
});

// ----------------------------------------------------------------------- meta
// Lifecycle only — never any ciphertext. Safe to poll.
app.get("/s/:code/meta", async (c) => {
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
  return c.json({
    exists: true,
    claimed: false,
    expiresAt: new Date(record.expiresAt).toISOString(),
  });
});

// ----------------------------------------------------------------------- burn
app.delete("/s/:code", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "bad_request", message: "Malformed claim code." }, 400);
  await c.env.SECRETS.delete(secretKey(code));
  return c.body(null, 204);
});

// ------------------------------------------------------------------- web form
app.get("/", (c) => c.html(FORM_HTML));

export default app;
