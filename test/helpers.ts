import type { Bindings, KV } from "../src/worker/app.js";

/** In-memory KV honoring expirationTtl, structurally compatible with Cloudflare KV. */
export class MemoryKV implements KV {
  map = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.map.set(key, {
      value,
      expiresAt: opts?.expirationTtl !== undefined ? Date.now() + opts.expirationTtl * 1000 : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SECRETS: new MemoryKV(),
    RATE_LIMIT_PER_MIN: "10000", // effectively off unless a test overrides it
    ...overrides,
  };
}

export function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// --- client-side crypto mirror (what the browser form does) -----------------
// The real encryption lives in form.ts as inline browser JS; this reproduces it
// with the same WebCrypto primitives so tests can prove the full E2E round-trip
// (encrypt here → POST ciphertext → GET ciphertext → decrypt here).

const b64 = (buf: ArrayBuffer | Uint8Array): string =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64");

export async function clientEncrypt(
  payload: { name?: string; value: string },
): Promise<{ ct: string; iv: string; keyB64url: string }> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return { ct: b64(ct), iv: b64(iv), keyB64url: Buffer.from(rawKey).toString("base64url") };
}

export async function clientDecrypt(
  ct: string,
  iv: string,
  keyB64url: string,
): Promise<{ name?: string; value: string }> {
  const rawKey = Buffer.from(keyB64url, "base64url");
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    key,
    Buffer.from(ct, "base64"),
  );
  return JSON.parse(new TextDecoder().decode(pt));
}
