import { Hono } from "hono";
import { encrypt, decrypt, type EncryptedPayload } from "./crypto.js";
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
  MASTER_KEY: string;
  RATE_LIMIT_PER_MIN?: string;
}

export const DEFAULT_TTL_S = 600; // 10 minutes
export const MIN_TTL_S = 60;
export const MAX_TTL_S = 86_400; // 24 hours
export const MAX_VALUE_BYTES = 16_384;
export const MAX_PASSPHRASE_ATTEMPTS = 5;

interface LiveRecord {
  v: 1;
  claimed: false;
  enc: EncryptedPayload;
  hasPassphrase: boolean;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  attempts: number;
}

interface Tombstone {
  v: 1;
  claimed: true;
  claimedAt: number;
  expiresAt: number;
}

type Record_ = LiveRecord | Tombstone;

const secretKey = (code: string) => `secret:${code}`;

/** KV expirationTtl must be >= 60s; add a buffer so the logical expiresAt check fires first. */
const kvTtl = (ttlSeconds: number) => Math.max(ttlSeconds, MIN_TTL_S) + 60;

const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------- rate limit
// Fixed-window per-IP counter in KV. Coarse but effective against code
// enumeration and passphrase brute force; applies to all /secret* routes.
app.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/secret")) return next();
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
app.post("/secret", async (c) => {
  if (!c.env.MASTER_KEY) {
    return c.json({ error: "server_misconfigured", message: "MASTER_KEY secret is not set." }, 500);
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.value !== "string" || body.value.length === 0) {
    return c.json({ error: "bad_request", message: "Body must include a non-empty string `value`." }, 400);
  }
  if (new TextEncoder().encode(body.value).length > MAX_VALUE_BYTES) {
    return c.json({ error: "too_large", message: `value exceeds ${MAX_VALUE_BYTES} bytes.` }, 413);
  }
  const name = typeof body.name === "string" && body.name.length > 0 ? body.name.slice(0, 128) : undefined;
  const passphrase =
    typeof body.passphrase === "string" && body.passphrase.length > 0 ? body.passphrase : undefined;

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
  const enc = await encrypt(c.env.MASTER_KEY, JSON.stringify({ name, value: body.value }), passphrase);
  const record: LiveRecord = {
    v: 1,
    claimed: false,
    enc,
    hasPassphrase: passphrase !== undefined,
    createdAt: now,
    expiresAt,
    attempts: 0,
  };
  await c.env.SECRETS.put(secretKey(code), JSON.stringify(record), { expirationTtl: kvTtl(ttl) });

  return c.json({ code, expiresAt: new Date(expiresAt).toISOString(), ttl }, 201);
});

// ---------------------------------------------------------------------- claim
app.post("/secret/:code/claim", async (c) => {
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

  const body = (await c.req.json().catch(() => null)) ?? {};
  const passphrase =
    typeof body.passphrase === "string" && body.passphrase.length > 0 ? body.passphrase : undefined;

  if (record.hasPassphrase && !passphrase) {
    return c.json({ error: "passphrase_required", message: "This secret requires a passphrase." }, 401);
  }

  let plaintext: string;
  try {
    plaintext = await decrypt(c.env.MASTER_KEY, record.enc, record.hasPassphrase ? passphrase : undefined);
  } catch {
    record.attempts += 1;
    if (record.attempts >= MAX_PASSPHRASE_ATTEMPTS) {
      await c.env.SECRETS.delete(secretKey(code));
      return c.json(
        { error: "burned", message: "Too many wrong passphrase attempts; the secret has been destroyed." },
        401,
      );
    }
    const remainingTtl = Math.ceil((record.expiresAt - Date.now()) / 1000);
    await c.env.SECRETS.put(secretKey(code), JSON.stringify(record), { expirationTtl: kvTtl(remainingTtl) });
    return c.json(
      {
        error: "wrong_passphrase",
        message: `Wrong passphrase (${MAX_PASSPHRASE_ATTEMPTS - record.attempts} attempts left).`,
      },
      401,
    );
  }

  // Burn: replace with a tombstone so meta can report claimed=true until the original expiry.
  const tombstone: Tombstone = { v: 1, claimed: true, claimedAt: Date.now(), expiresAt: record.expiresAt };
  const remainingTtl = Math.ceil((record.expiresAt - Date.now()) / 1000);
  await c.env.SECRETS.put(secretKey(code), JSON.stringify(tombstone), { expirationTtl: kvTtl(remainingTtl) });

  const payload = JSON.parse(plaintext) as { name?: string; value: string };
  return c.json({ name: payload.name, value: payload.value });
});

// ----------------------------------------------------------------------- meta
app.get("/secret/:code/meta", async (c) => {
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
    hasPassphrase: record.hasPassphrase,
    expiresAt: new Date(record.expiresAt).toISOString(),
  });
});

// ----------------------------------------------------------------------- burn
app.delete("/secret/:code", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "bad_request", message: "Malformed claim code." }, 400);
  await c.env.SECRETS.delete(secretKey(code));
  return c.body(null, 204);
});

// ------------------------------------------------------------------- web form
app.get("/", (c) => c.html(FORM_HTML));

export default app;
