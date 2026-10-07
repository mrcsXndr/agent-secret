import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import app from "../src/worker/app.js";
import { FORM_HTML } from "../src/worker/form.js";
import { SNIPPET_PY, SNIPPET_SH } from "../src/worker/agent-docs.js";
import { makeEnv } from "./helpers.js";

const ORIGIN = "https://secret.example.com";
// Normalise CRLF so a Windows checkout (core.autocrlf) compares the same text.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

async function page() {
  const res = await app.request(`${ORIGIN}/`, undefined, makeEnv());
  return { res, html: await res.text(), csp: res.headers.get("content-security-policy") ?? "" };
}

describe("page CSP", () => {
  it("allows exactly the served inline script and style, by hash, and nothing inline otherwise", async () => {
    const { html, csp } = await page();
    expect(csp).not.toContain("unsafe-inline");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
    expect(scripts).toHaveLength(1);
    expect(styles).toHaveLength(1);
    expect(csp).toContain(`script-src 'sha256-${sha256(scripts[0]!)}'`);
    expect(csp).toContain(`style-src 'sha256-${sha256(styles[0]!)}'`);
    // Hashed CSP blocks inline handlers and style attributes; the page must not rely on them.
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'none'");
  });

  it("shows the same script hash on the page that the header enforces", async () => {
    const { html, csp } = await page();
    const hash = /script-src 'sha256-([^']+)'/.exec(csp)![1]!;
    expect(html).toContain(`sha256-${hash}`);
  });
});

describe("page content", () => {
  it("fills every placeholder and points the social preview at this origin", async () => {
    const { html } = await page();
    expect(html).not.toContain("{{");
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og.png">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("escapes a hostile Host before putting it in the page", async () => {
    const res = await app.request('http://a"b.example/', undefined, makeEnv());
    const html = await res.text();
    expect(html).not.toContain('a"b');
  });

  it("never names the secret inputs, so a native submit could not carry them", () => {
    expect(FORM_HTML).toMatch(/<textarea id="value"(?![^>]*\sname=)[^>]*>/);
    expect(FORM_HTML).toMatch(/<input id="name"(?![^>]*\sname=)[^>]*>/);
  });

  it("links to the source lines that really do the encryption and the POST", () => {
    const lines = read("../src/worker/form.ts").split("\n");
    const range = (anchor: string) => {
      const m = new RegExp(`form\\.ts#${anchor}`).exec(FORM_HTML);
      expect(m, anchor).not.toBeNull();
      const [, a, b] = /L(\d+)-L(\d+)/.exec(anchor)!;
      return lines.slice(Number(a) - 1, Number(b)).join("\n");
    };
    const enc = range("L20-L27");
    expect(enc).toContain("async function encrypt");
    expect(enc).toContain("crypto.getRandomValues(new Uint8Array(32))");
    expect(enc).toContain("crypto.subtle.encrypt({ name:'AES-GCM'");
    expect(enc.trimEnd().endsWith("}")).toBe(true);
    const post = range("L29-L32");
    expect(post).toContain("method:'POST'");
    expect(post).toContain("JSON.stringify({ ct: enc.ct, iv: enc.iv, ttl: ttl })");
  });
});

describe("agent instructions", () => {
  it("serves /llms.txt as plain text with this origin and both snippets, outside the rate limit", async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: "1" });
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`${ORIGIN}/llms.txt`, undefined, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const body = await res.text();
      expect(body).toContain(`${ORIGIN}/<code>#<key>`);
      expect(body).toContain(SNIPPET_SH);
      expect(body).toContain(SNIPPET_PY);
      expect(body).not.toContain("{{");
    }
  });

  it("README carries the exact same snippets", () => {
    const readme = read("../README.md");
    expect(readme).toContain(SNIPPET_SH);
    expect(readme).toContain(SNIPPET_PY);
  });

  it("robots.txt lets previews fetch the page and image but not claim links", async () => {
    const body = await (await app.request("/robots.txt", undefined, makeEnv())).text();
    expect(body).toContain("Allow: /$");
    expect(body).toContain("Allow: /og.png");
    expect(body).toContain("Disallow: /\n");
  });
});

describe("SEO and public documents", () => {
  const get = (path: string, env = makeEnv()) => app.request(`${ORIGIN}${path}`, undefined, env);

  it("robots.txt allows every public document, disallows the rest and names the sitemap", async () => {
    const body = await (await get("/robots.txt")).text();
    for (const p of ["/llms.txt", "/sitemap.xml", "/.well-known/security.txt", "/favicon.svg", "/apple-touch-icon.png"]) {
      expect(body).toContain(`Allow: ${p}\n`);
    }
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml\n`);
    // Every rule is an exact public path; nothing could match a claim code like /k7f2-9m3q.
    const allows = [...body.matchAll(/^Allow: (\S+)$/gm)].map((m) => m[1]!);
    expect(allows.every((p) => p === "/$" || /\.[a-z]+$/.test(p))).toBe(true);
  });

  it("sitemap.xml lists only the page and /llms.txt, never a claim link", async () => {
    const res = await get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`, `${ORIGIN}/llms.txt`]);
  });

  it("serves an RFC 9116 security.txt pointing at the private advisory form", async () => {
    const res = await get("/.well-known/security.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("Contact: https://github.com/mrcsXndr/agent-secret/security/advisories/new\n");
    expect(body).toContain(`Canonical: ${ORIGIN}/.well-known/security.txt\n`);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(body)![1]!);
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires).toBeLessThan(Date.now() + 365 * 86_400_000);
  });

  it("keeps the public documents outside the rate limit", async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: "1" });
    for (let i = 0; i < 3; i++) {
      for (const p of ["/robots.txt", "/sitemap.xml", "/.well-known/security.txt"]) {
        expect((await get(p, env)).status, p).toBe(200);
      }
    }
  });

  it("gives the page a canonical URL, icons, and valid JSON-LD for this origin", async () => {
    const { html } = await page();
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/og.png">`);
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!);
    expect(ld["@type"]).toContain("SoftwareApplication");
    expect(ld.url).toBe(`${ORIGIN}/`);
    expect(ld.applicationCategory).toBe("DeveloperApplication");
    expect(ld.offers.price).toBe("0");
    expect(ld.codeRepository).toBe("https://github.com/mrcsXndr/agent-secret");
  });

  it("keeps a hostile Host from breaking the JSON-LD block", async () => {
    const res = await app.request('http://a"b.example/', undefined, makeEnv());
    const html = await res.text();
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(() => JSON.parse(ld)).not.toThrow();
  });

  it("ships the icons and the static cache rules it links to", () => {
    expect(read("../public/favicon.svg")).toContain("<svg");
    expect(readFileSync(new URL("../public/apple-touch-icon.png", import.meta.url)).subarray(1, 4).toString()).toBe("PNG");
    const headers = read("../public/_headers");
    for (const p of ["/og.png", "/favicon.svg", "/apple-touch-icon.png"]) {
      expect(headers).toMatch(new RegExp(`^${p.replace(".", "\\.")}\\n  Cache-Control: public, max-age=\\d+`, "m"));
    }
  });

  it("caches public responses and never caches secret ones", async () => {
    const env = makeEnv();
    expect((await get("/", env)).headers.get("cache-control")).toMatch(/^public/);
    expect((await get("/llms.txt", env)).headers.get("cache-control")).toMatch(/^public/);
    const created = await app.request(`${ORIGIN}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ct: "AAAA", iv: "AAAA" }) }, env);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { code } = (await created.json()) as { code: string };
    expect((await get(`/${code}/meta`, env)).headers.get("cache-control")).toBe("no-store");
    expect((await get(`/${code}`, env)).headers.get("cache-control")).toBe("no-store");
    expect((await app.request(`${ORIGIN}/${code}`, { method: "DELETE" }, env)).headers.get("cache-control")).toBe("no-store");
  });
});
