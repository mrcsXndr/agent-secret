// Agent-facing instructions, kept in one place: the web page, GET /llms.txt and
// the README all show these exact snippets (a test checks the README copy).
// No imports, so plain `node` can load this file to run the snippets for real.

/** curl + node (18+). Needs bash for the ${LINK%%#*} split. */
export const SNIPPET_SH = `LINK='PASTE-THE-LINK-HERE'   # https://<host>/<code>#<key>
NAME=OPENAI_API_KEY          # the variable the value should land in
curl -sS -A 'agent-secret-client/1.0' "\${LINK%%#*}" |
KEY="\${LINK#*#}" NAME="$NAME" node -e '
const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (!r.ct) throw new Error("claim failed: " + (r.error || "no ciphertext"));
const c = Buffer.from(r.ct, "base64");
const d = require("crypto").createDecipheriv("aes-256-gcm",
  Buffer.from(process.env.KEY, "base64url"), Buffer.from(r.iv, "base64"));
d.setAuthTag(c.subarray(-16));
const v = Buffer.concat([d.update(c.subarray(0, -16)), d.final()]).toString("utf8");
require("fs").appendFileSync(".env", process.env.NAME + "=" + v + "\\n");
console.log("saved " + process.env.NAME + " to .env");'`;

/** Python 3 + the \`cryptography\` package (the stdlib has no AES-GCM). */
export const SNIPPET_PY = `# pip install cryptography
import base64, json, urllib.request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

LINK = "PASTE-THE-LINK-HERE"   # https://<host>/<code>#<key>
NAME = "OPENAI_API_KEY"        # the variable the value should land in

url, key = LINK.split("#", 1)
req = urllib.request.Request(url, headers={"User-Agent": "agent-secret-client/1.0"})
with urllib.request.urlopen(req) as res:   # raises HTTPError on 403/404/410/429
    body = json.load(res)
value = AESGCM(base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))).decrypt(
    base64.b64decode(body["iv"]), base64.b64decode(body["ct"]), None
).decode("utf-8")
with open(".env", "a", encoding="utf-8") as f:
    f.write(f"{NAME}={value}\\n")
print(f"saved {NAME} to .env")`;

/** Plain-text spec served at GET /llms.txt. {{origin}} is filled per request. */
export const LLMS_TXT = `# agent-secret

> One-time, end-to-end encrypted secret handoff for AI agents. A human encrypts a
> secret in their browser at {{origin}} and gives you ONE link:
> {{origin}}/<code>#<key>
> The server stores only ciphertext. The key is the #fragment, which HTTP clients
> never send, so the server cannot decrypt anything.

## Claim a link (do exactly this)

1. Split the link at "#". URL = the part before it. KEY = the part after it.
   Never send KEY to any server, tool or log.
2. GET URL once, with a User-Agent of your own, e.g. "agent-secret-client/1.0".
   The first successful GET returns the ciphertext and burns the secret.
3. Decrypt with AES-256-GCM:
   key   = base64url-decode(KEY)      32 bytes
   nonce = base64-decode(iv)          12 bytes
   data  = base64-decode(ct)          ciphertext with the 16-byte tag appended
   The plaintext (UTF-8) is the secret value. Nothing else is wrapped around it.
4. Write the value straight to where secrets live: an environment variable, a
   gitignored .env file, or a secret manager.
5. Never print, log, echo or repeat the value in chat. Confirm by NAME only,
   e.g. "saved OPENAI_API_KEY to .env".

After the claim the link left in your transcript is dead: the server replaced
the ciphertext with a tombstone when you read it.

## Responses from GET <code>

200  {"ct": "<base64>", "iv": "<base64>"}  claimed; the secret is now burned
410  {"error": "already_claimed" | "expired"}  someone claimed it first, or it
     expired. Tell the human to rotate the secret and send a new link.
404  {"error": "not_found"}  wrong code, or it expired and was purged
403  "error code: 1010" (not JSON)  Cloudflare's Browser Integrity Check refused
     a library default User-Agent (Python-urllib is one) before the request
     reached the service. Nothing was claimed. Retry with your own User-Agent.
429  {"error": "rate_limited"}  wait a minute

Do not open the link in a browser or paste it into other tools: any plain GET
of the code claims it.

## Reference: curl + node (bash)

${SNIPPET_SH}

## Reference: Python

${SNIPPET_PY}

## Source

https://github.com/mrcsXndr/agent-secret
`;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
