import { describe, it, expect, afterEach, vi } from "vitest";
import app, { MAX_TTL_S, MAX_BLOB_BYTES } from "../src/worker/app.js";
import { makeEnv, json, clientEncrypt, clientDecrypt, MemoryKV } from "./helpers.js";

const CODE_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

/** Encrypt like the browser, then POST the ciphertext — the real create path. */
async function share(env: ReturnType<typeof makeEnv>, payload: { name?: string; value: string }, ttl?: number) {
  const { ct, iv, keyB64url } = await clientEncrypt(payload);
  const res = await app.request("/s", json({ ct, iv, ttl }), env);
  const data = (await res.json()) as { code: string; expiresAt: string; ttl: number };
  return { res, data, keyB64url, ct, iv };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("create", () => {
  it("returns a claim code and expiry, defaulting to 10 minutes", async () => {
    const env = makeEnv();
    const { res, data } = await share(env, { value: "sk-test-123", name: "OPENAI_API_KEY" });
    expect(res.status).toBe(201);
    expect(data.code).toMatch(CODE_RE);
    expect(data.ttl).toBe(600);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a body without ciphertext", async () => {
    const env = makeEnv();
    const res = await app.request("/s", json({ value: "sk-plaintext" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects a non-base64 ct", async () => {
    const env = makeEnv();
    const res = await app.request("/s", json({ ct: "not base64!!", iv: "AAAA" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects an oversized payload", async () => {
    const env = makeEnv();
    const res = await app.request("/s", json({ ct: "A".repeat(MAX_BLOB_BYTES + 1), iv: "AAAA" }), env);
    expect(res.status).toBe(413);
  });

  it("clamps ttl to the 24h hard max", async () => {
    const env = makeEnv();
    const { data } = await share(env, { value: "v" }, 999_999_999);
    expect(data.ttl).toBe(MAX_TTL_S);
  });
});

describe("claim (single GET, burns on read)", () => {
  it("full E2E round-trip: browser encrypt → store → claim → decrypt", async () => {
    const env = makeEnv();
    const { data, keyB64url } = await share(env, { value: "sk-live-42", name: "STRIPE_KEY" });

    const first = await app.request(`/s/${data.code}`, undefined, env);
    expect(first.status).toBe(200);
    const { ct, iv } = (await first.json()) as { ct: string; iv: string };
    expect(await clientDecrypt(ct, iv, keyB64url)).toEqual({ name: "STRIPE_KEY", value: "sk-live-42" });
  });

  it("is single-use: the second read is 410 already_claimed", async () => {
    const env = makeEnv();
    const { data } = await share(env, { value: "v" });
    expect((await app.request(`/s/${data.code}`, undefined, env)).status).toBe(200);
    const second = await app.request(`/s/${data.code}`, undefined, env);
    expect(second.status).toBe(410);
    expect(((await second.json()) as { error: string }).error).toBe("already_claimed");
  });

  it("404s on an unknown code", async () => {
    const env = makeEnv();
    const res = await app.request("/s/aaaa-bbbb", undefined, env);
    expect(res.status).toBe(404);
  });

  it("tolerates uppercase / missing-dash code input", async () => {
    const env = makeEnv();
    const { data } = await share(env, { value: "v" });
    const sloppy = data.code.replace("-", "").toUpperCase();
    expect((await app.request(`/s/${sloppy}`, undefined, env)).status).toBe(200);
  });

  it("410s after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00Z"));
    const env = makeEnv();
    const { data } = await share(env, { value: "v" }, 60);

    vi.setSystemTime(new Date("2026-07-06T12:01:01Z"));
    const res = await app.request(`/s/${data.code}`, undefined, env);
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: string }).error).toBe("expired");
  });
});

describe("zero-knowledge guarantee", () => {
  it("KV holds only ciphertext — never the plaintext value or name", async () => {
    const env = makeEnv();
    const secret = "plaintext-should-not-appear";
    const { data } = await share(env, { value: secret, name: "MY_VAR_NAME" });
    const kv = env.SECRETS as MemoryKV;
    const stored = [...kv.map.entries()].map(([k, v]) => k + v.value).join("\n");
    expect(stored).toContain(data.code); // sanity: the record is there
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("MY_VAR_NAME");
  });

  it("even the claim response is opaque without the key", async () => {
    const env = makeEnv();
    const { data } = await share(env, { value: "top-secret-value" });
    const body = await (await app.request(`/s/${data.code}`, undefined, env)).text();
    expect(body).not.toContain("top-secret-value");
  });
});

describe("meta", () => {
  it("reports lifecycle states and NEVER exposes ciphertext", async () => {
    const env = makeEnv();
    const { data, ct } = await share(env, { value: "super-secret-value-xyz" });

    const before = await app.request(`/s/${data.code}/meta`, undefined, env);
    expect(before.status).toBe(200);
    const beforeBody = await before.text();
    expect(JSON.parse(beforeBody)).toMatchObject({ exists: true, claimed: false });
    expect(beforeBody).not.toContain(ct);

    await app.request(`/s/${data.code}`, undefined, env);

    const after = await app.request(`/s/${data.code}/meta`, undefined, env);
    expect(JSON.parse(await after.text())).toMatchObject({ exists: true, claimed: true });

    const unknown = await app.request("/s/zzzz-zzzz/meta", undefined, env);
    expect(await unknown.json()).toEqual({ exists: false });
  });
});

describe("burn", () => {
  it("destroys the secret; later claims 404", async () => {
    const env = makeEnv();
    const { data } = await share(env, { value: "v" });

    const del = await app.request(`/s/${data.code}`, { method: "DELETE" }, env);
    expect(del.status).toBe(204);

    expect((await app.request(`/s/${data.code}`, undefined, env)).status).toBe(404);
    const meta = await app.request(`/s/${data.code}/meta`, undefined, env);
    expect(await meta.json()).toEqual({ exists: false });
  });
});

describe("rate limiting", () => {
  it("429s past the per-IP per-minute limit", async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: "3" });
    const req = () => app.request("/s/aaaa-bbbb/meta", { headers: { "cf-connecting-ip": "1.2.3.4" } }, env);
    for (let i = 0; i < 3; i++) expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(429);

    const other = await app.request(
      "/s/aaaa-bbbb/meta",
      { headers: { "cf-connecting-ip": "5.6.7.8" } },
      env,
    );
    expect(other.status).toBe(200);
  });
});
