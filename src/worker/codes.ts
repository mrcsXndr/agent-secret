// Claim codes: 8 chars in xxxx-xxxx form, from a confusable-free alphabet
// (no 0/O, 1/l/i). 31^8 ≈ 2^39.6 — plenty against online guessing given
// rate limiting and short TTLs.

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateCode(): string {
  const chars: string[] = [];
  while (chars.length < 8) {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of buf) {
      // rejection sampling to avoid modulo bias (31 * 8 = 248)
      if (byte < 248) chars.push(ALPHABET[byte % ALPHABET.length]!);
      if (chars.length === 8) break;
    }
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Normalize user input: trim, lowercase, tolerate a missing dash. */
export function normalizeCode(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
