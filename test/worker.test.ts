import { describe, it, expect, afterEach, vi } from "vitest";
import app, { MAX_TTL_S, MAX_BLOB_BYTES } from "../src/worker/app.js";
import { makeEnv, json, clientEncrypt, clientDecrypt, MemoryKV } from "./helpers.js";

const CODE_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

/** Encrypt like the browser, then POST the ciphertext — the real create path. */
async function share(env: ReturnType<typeof makeEnv>, value: string, ttl?: number) {
  const { ct, iv, keyB64url } = await clientEncrypt(value);
  const res = await app.request("/", json({ ct, iv, ttl }), env);
  const data = (await res.json()) as { code: string; expiresAt: string; ttl: number };
  return { res, data, keyB64url, ct, iv };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("create", () => {
  it("returns a claim code and expiry, defaulting to 10 minutes", async () => {
    const env = makeEnv();
    const { res, data } = await share(env, "sk-test-123");
    expect(res.status).toBe(201);
    expect(data.code).toMatch(CODE_RE);
    expect(data.ttl).toBe(600);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a body without ciphertext", async () => {
    const env = makeEnv();
    const res = await app.request("/", json({ value: "sk-plaintext" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects a non-base64 ct", async () => {
    const env = makeEnv();
    const res = await app.request("/", json({ ct: "not base64!!", iv: "AAAA" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects an oversized payload", async () => {
    const env = makeEnv();
    const res = await app.request("/", json({ ct: "A".repeat(MAX_BLOB_BYTES + 1), iv: "AAAA" }), env);
    expect(res.status).toBe(413);
  });

  it("clamps ttl to the 24h hard max", async () => {
    const env = makeEnv();
    const { data } = await share(env, "v", 999_999_999);
    expect(data.ttl).toBe(MAX_TTL_S);
  });
});

describe("claim (single GET at /<code>, burns on read)", () => {
  it("full E2E round-trip: browser encrypt → store → claim → decrypt", async () => {
    const env = makeEnv();
    const { data, keyB64url } = await share(env, "sk-live-42");

    const first = await app.request(`/${data.code}`, undefined, env);
    expect(first.status).toBe(200);
    const { ct, iv } = (await first.json()) as { ct: string; iv: string };
    expect(await clientDecrypt(ct, iv, keyB64url)).toBe("sk-live-42");
  });

  it("is single-use: the second read is 410 already_claimed", async () => {
    const env = makeEnv();
    const { data } = await share(env, "v");
    expect((await app.request(`/${data.code}`, undefined, env)).status).toBe(200);
    const second = await app.request(`/${data.code}`, undefined, env);
    expect(second.status).toBe(410);
    expect(((await second.json()) as { error: string }).error).toBe("already_claimed");
  });

  it("404s on an unknown code", async () => {
    const env = makeEnv();
    const res = await app.request("/aaaa-bbbb", undefined, env);
    expect(res.status).toBe(404);
  });

  it("tolerates uppercase / missing-dash code input", async () => {
    const env = makeEnv();
    const { data } = await share(env, "v");
    const sloppy = data.code.replace("-", "").toUpperCase();
    expect((await app.request(`/${sloppy}`, undefined, env)).status).toBe(200);
  });

  it("410s after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00Z"));
    const env = makeEnv();
    const { data } = await share(env, "v", 60);

    vi.setSystemTime(new Date("2026-07-06T12:01:01Z"));
    const res = await app.request(`/${data.code}`, undefined, env);
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: string }).error).toBe("expired");
  });
});

describe("zero-knowledge guarantee", () => {
  it("KV holds only ciphertext — never the plaintext value", async () => {
    const env = makeEnv();
    const secret = "plaintext-should-not-appear";
    const { data } = await share(env, secret);
    const kv = env.SECRETS as MemoryKV;
    const stored = [...kv.map.entries()].map(([k, v]) => k + v.value).join("\n");
    expect(stored).toContain(data.code); // sanity: the record is there
    expect(stored).not.toContain(secret);
  });

  it("even the claim response is opaque without the key", async () => {
    const env = makeEnv();
    const { data } = await share(env, "top-secret-value");
    const body = await (await app.request(`/${data.code}`, undefined, env)).text();
    expect(body).not.toContain("top-secret-value");
  });
});

describe("meta", () => {
  it("reports lifecycle states and NEVER exposes ciphertext", async () => {
    const env = makeEnv();
    const { data, ct } = await share(env, "super-secret-value-xyz");

    const before = await app.request(`/${data.code}/meta`, undefined, env);
    expect(before.status).toBe(200);
    const beforeBody = await before.text();
    expect(JSON.parse(beforeBody)).toMatchObject({ exists: true, claimed: false });
    expect(beforeBody).not.toContain(ct);

    await app.request(`/${data.code}`, undefined, env);

    const after = await app.request(`/${data.code}/meta`, undefined, env);
    expect(JSON.parse(await after.text())).toMatchObject({ exists: true, claimed: true });

    const unknown = await app.request("/zzzz-zzzz/meta", undefined, env);
    expect(await unknown.json()).toEqual({ exists: false });
  });
});

describe("burn", () => {
  it("destroys the secret; later claims 404", async () => {
    const env = makeEnv();
    const { data } = await share(env, "v");

    const del = await app.request(`/${data.code}`, { method: "DELETE" }, env);
    expect(del.status).toBe(204);

    expect((await app.request(`/${data.code}`, undefined, env)).status).toBe(404);
    const meta = await app.request(`/${data.code}/meta`, undefined, env);
    expect(await meta.json()).toEqual({ exists: false });
  });
});

describe("form + rate limiting", () => {
  it("serves the form at / and never rate-limits it", async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: "1" });
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/", undefined, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    }
  });

  it("429s past the per-IP per-minute limit on claim paths", async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: "3" });
    const req = () => app.request("/aaaa-bbbb/meta", { headers: { "cf-connecting-ip": "1.2.3.4" } }, env);
    for (let i = 0; i < 3; i++) expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(429);

    const other = await app.request(
      "/aaaa-bbbb/meta",
      { headers: { "cf-connecting-ip": "5.6.7.8" } },
      env,
    );
    expect(other.status).toBe(200);
  });
});
