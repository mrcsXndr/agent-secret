import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/worker/crypto.js";
import { generateCode, normalizeCode } from "../src/worker/codes.js";

const master = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

describe("crypto", () => {
  it("round-trips without a passphrase", async () => {
    const enc = await encrypt(master, "hello");
    expect(await decrypt(master, enc)).toBe("hello");
  });

  it("round-trips with a passphrase; wrong/missing passphrase fails auth", async () => {
    const enc = await encrypt(master, "hello", "pw");
    expect(await decrypt(master, enc, "pw")).toBe("hello");
    await expect(decrypt(master, enc, "wrong")).rejects.toThrow();
    await expect(decrypt(master, enc)).rejects.toThrow();
  });

  it("fails with a different master key", async () => {
    const enc = await encrypt(master, "hello");
    const otherMaster = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    await expect(decrypt(otherMaster, enc)).rejects.toThrow();
  });

  it("uses a fresh iv/salt per encryption (no ciphertext reuse)", async () => {
    const a = await encrypt(master, "same");
    const b = await encrypt(master, "same");
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
  });

  it("rejects a short master key", async () => {
    await expect(encrypt(Buffer.from("short").toString("base64"), "x")).rejects.toThrow(/MASTER_KEY/);
  });
});

describe("claim codes", () => {
  it("generates xxxx-xxxx codes from the safe alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/);
    }
  });

  it("normalizes sloppy input and rejects garbage", () => {
    expect(normalizeCode(" K7F2-9M3Q ")).toBe("k7f2-9m3q");
    expect(normalizeCode("k7f29m3q")).toBe("k7f2-9m3q");
    expect(normalizeCode("abc-def")).toBe(null); // too short after stripping
    expect(normalizeCode("way-too-long-code")).toBe(null);
    expect(normalizeCode("")).toBe(null);
  });
});
