import { describe, it, expect, afterEach, vi } from "vitest";
import app, { MAX_PASSPHRASE_ATTEMPTS, MAX_TTL_S } from "../src/worker/app.js";
import { makeEnv, json } from "./helpers.js";

const CODE_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

async function create(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>) {
  const res = await app.request("/secret", json(body), env);
  return { res, data: (await res.json()) as { code: string; expiresAt: string; ttl: number } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("create", () => {
  it("returns a claim code and expiry, defaulting to 10 minutes", async () => {
    const env = makeEnv();
    const { res, data } = await create(env, { value: "sk-test-123", name: "OPENAI_API_KEY" });
    expect(res.status).toBe(201);
    expect(data.code).toMatch(CODE_RE);
    expect(data.ttl).toBe(600);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a missing value", async () => {
    const env = makeEnv();
    const res = await app.request("/secret", json({}), env);
    expect(res.status).toBe(400);
  });

  it("rejects oversized values", async () => {
    const env = makeEnv();
    const res = await app.request("/secret", json({ value: "x".repeat(20_000) }), env);
    expect(res.status).toBe(413);
  });

  it("clamps ttl to the 24h hard max", async () => {
    const env = makeEnv();
    const { data } = await create(env, { value: "v", ttl: 999_999_999 });
    expect(data.ttl).toBe(MAX_TTL_S);
  });

  it("500s with a clear error when MASTER_KEY is unset", async () => {
    const env = makeEnv({ MASTER_KEY: "" });
    const res = await app.request("/secret", json({ value: "v" }), env);
    expect(res.status).toBe(500);
  });
});

describe("claim", () => {
  it("returns the value and name exactly once, then 410", async () => {
    const env = makeEnv();
    const { data } = await create(env, { value: "sk-live-42", name: "STRIPE_KEY" });

    const first = await app.request(`/secret/${data.code}/claim`, json({}), env);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ name: "STRIPE_KEY", value: "sk-live-42" });

    const second = await app.request(`/secret/${data.code}/claim`, json({}), env);
    expect(second.status).toBe(410);
    expect(((await second.json()) as { error: string }).error).toBe("already_claimed");
  });

  it("404s on an unknown code", async () => {
    const env = makeEnv();
    const res = await app.request("/secret/aaaa-bbbb/claim", json({}), env);
    expect(res.status).toBe(404);
  });

  it("tolerates uppercase / missing-dash code input", async () => {
    const env = makeEnv();
    const { data } = await create(env, { value: "v" });
    const sloppy = data.code.replace("-", "").toUpperCase();
    const res = await app.request(`/secret/${sloppy}/claim`, json({}), env);
    expect(res.status).toBe(200);
  });

  it("410s after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00Z"));
    const env = makeEnv();
    const { data } = await create(env, { value: "v", ttl: 60 });

    vi.setSystemTime(new Date("2026-07-06T12:01:01Z"));
    const res = await app.request(`/secret/${data.code}/claim`, json({}), env);
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: string }).error).toBe("expired");
  });
});

describe("passphrase", () => {
  it("401s without or with a wrong passphrase; claims with the right one", async () => {
    const env = makeEnv();
    const { data } = await create(env, { value: "v", passphrase: "hunter2" });

    const missing = await app.request(`/secret/${data.code}/claim`, json({}), env);
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: string }).error).toBe("passphrase_required");

    const wrong = await app.request(`/secret/${data.code}/claim`, json({ passphrase: "nope" }), env);
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: string }).error).toBe("wrong_passphrase");

    const right = await app.request(`/secret/${data.code}/claim`, json({ passphrase: "hunter2" }), env);
    expect(right.status).toBe(200);
    expect(((await right.json()) as { value: string }).value).toBe("v");
  });

  it("burns the secret after too many wrong attempts", async () => {
    const env = makeEnv();
    const { data } = await create(env, { value: "v", passphrase: "right" });

    for (let i = 0; i < MAX_PASSPHRASE_ATTEMPTS; i++) {
      const res = await app.request(`/secret/${data.code}/claim`, json({ passphrase: "wrong" }), env);
      expect(res.status).toBe(401);
    }
    // even the correct passphrase is too late now
    const res = await app.request(`/secret/${data.code}/claim`, json({ passphrase: "right" }), env);
    expect(res.status).toBe(404);
  });

  it("ignores a passphrase supplied for a secret that has none", async () => {
    const env = makeEnv();
    const { data } = await create(env, { value: "v" });
    const res = await app.request(`/secret/${data.code}/claim`, json({ passphrase: "extra" }), env);
    expect(res.status).toBe(200);
  });
});

describe("meta", () => {
  it("reports lifecycle states and NEVER exposes the value", async () => {
    const env = makeEnv();
    const secret = "super-secret-value-xyz";
    const { data } = await create(env, { value: secret, passphrase: "pw" });

    const before = await app.request(`/secret/${data.code}/meta`, undefined, env);
    expect(before.status).toBe(200);
    const beforeBody = await before.text();
    expect(JSON.parse(beforeBody)).toMatchObject({ exists: true, claimed: false, hasPassphrase: true });
    expect(beforeBody).not.toContain(secret);

    await app.request(`/secret/${data.code}/claim`, json({ passphrase: "pw" }), env);

    const after = await app.request(`/secret/${data.code}/meta`, undefined, env);
    const afterBody = await after.text();
    expect(JSON.parse(afterBody)).toMatchObject({ exists: true, claimed: true });
    expect(afterBody).not.toContain(secret);

    const unknown = await app.request("/secret/zzzz-zzzz/meta", undefined, env);
    expect(await unknown.json()).toEqual({ exists: false });
  });
});

describe("burn", () => {
  it("destroys the secret; later claims 404", async () => {
    const env = makeEnv();
    const { data } = await create(env, { value: "v" });

    const del = await app.request(`/secret/${data.code}`, { method: "DELETE" }, env);
    expect(del.status).toBe(204);

    const claim = await app.request(`/secret/${data.code}/claim`, json({}), env);
    expect(claim.status).toBe(404);
    const meta = await app.request(`/secret/${data.code}/meta`, undefined, env);
    expect(await meta.json()).toEqual({ exists: false });
  });
});

describe("rate limiting", () => {
  it("429s past the per-IP per-minute limit", async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: "3" });
    const req = () =>
      app.request("/secret/aaaa-bbbb/meta", { headers: { "cf-connecting-ip": "1.2.3.4" } }, env);
    for (let i = 0; i < 3; i++) expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(429);

    // a different IP is unaffected
    const other = await app.request(
      "/secret/aaaa-bbbb/meta",
      { headers: { "cf-connecting-ip": "5.6.7.8" } },
      env,
    );
    expect(other.status).toBe(200);
  });
});

describe("encryption at rest", () => {
  it("stores neither the plaintext value nor the name in KV", async () => {
    const env = makeEnv();
    const secret = "plaintext-should-not-appear";
    const { data } = await create(env, { value: secret, name: "MY_VAR_NAME" });
    const kv = env.SECRETS as import("./helpers.js").MemoryKV;
    const stored = [...kv.map.entries()].map(([k, v]) => k + v.value).join("\n");
    expect(stored).toContain(data.code); // sanity: the record is there
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("MY_VAR_NAME");
  });
});
