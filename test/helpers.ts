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
  const master = crypto.getRandomValues(new Uint8Array(32));
  return {
    SECRETS: new MemoryKV(),
    MASTER_KEY: Buffer.from(master).toString("base64"),
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
