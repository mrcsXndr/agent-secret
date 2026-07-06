// AES-256-GCM encryption at rest for secret payloads.
//
// Key derivation:
//   - no passphrase:   HKDF-SHA256(master, salt)                    — master key is already high-entropy
//   - with passphrase: PBKDF2-SHA256(master || passphrase, salt)    — stretched against offline brute force
//
// A wrong/missing passphrase produces a different key, so decryption fails
// GCM authentication — that failure IS the passphrase check (nothing else stored).

const PBKDF2_ITERATIONS = 100_000; // Cloudflare Workers caps PBKDF2 at 100k iterations

export interface EncryptedPayload {
  ct: string; // base64 ciphertext (includes GCM tag)
  iv: string; // base64 12-byte nonce
  salt: string; // base64 16-byte KDF salt
}

export function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// No explicit CryptoKey/KeyUsage annotations: those globals differ between the
// Workers and Node type worlds; inference keeps this file portable to both.
async function deriveKey(masterKeyB64: string, passphrase: string | undefined, salt: Uint8Array) {
  const master = b64decode(masterKeyB64);
  if (master.length < 32) throw new Error("MASTER_KEY must be at least 32 bytes (base64-encoded)");
  const aesParams = { name: "AES-GCM", length: 256 } as const;

  if (passphrase) {
    const pass = new TextEncoder().encode(passphrase);
    const ikm = new Uint8Array(master.length + pass.length);
    ikm.set(master);
    ikm.set(pass, master.length);
    const base = await crypto.subtle.importKey("raw", ikm, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      base,
      aesParams,
      false,
      ["encrypt", "decrypt"],
    );
  }

  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new Uint8Array(0) },
    base,
    aesParams,
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(
  masterKeyB64: string,
  plaintext: string,
  passphrase?: string,
): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterKeyB64, passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ct: b64encode(new Uint8Array(ct)), iv: b64encode(iv), salt: b64encode(salt) };
}

/** Throws on GCM auth failure (wrong passphrase or corrupt data). */
export async function decrypt(
  masterKeyB64: string,
  payload: EncryptedPayload,
  passphrase?: string,
): Promise<string> {
  const key = await deriveKey(masterKeyB64, passphrase, b64decode(payload.salt));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(payload.iv) },
    key,
    b64decode(payload.ct),
  );
  return new TextDecoder().decode(pt);
}
