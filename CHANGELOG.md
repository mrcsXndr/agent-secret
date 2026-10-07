# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-07

The protocol and API are unchanged; links made with 1.0.0 claim the same way.

### Added
- Redesigned page: one form, a copy block with the link's key half highlighted, light and dark themes.
- **How it works** section: the two halves of a link, the whole trip with links to the exact encryption and POST source lines, who sees what, and what it does not protect against.
- **For agents** section with the claim protocol, response codes and copyable curl + node and Python snippets.
- `GET /llms.txt`: the agent protocol as plain text. The page, `/llms.txt` and the README carry the same snippets, checked by a test.
- SEO and sharing: canonical URL, Open Graph and Twitter card tags, a 1200x630 social image (`/og.png`), JSON-LD `SoftwareApplication`, `/sitemap.xml`, `/favicon.svg` and `/apple-touch-icon.png`.
- `/.well-known/security.txt` (RFC 9116) pointing at private GitHub security advisories, and `SECURITY.md`.

### Changed
- The page's Content-Security-Policy pins its one inline script and one inline style by SHA-256 hash (was `'unsafe-inline'`) and shows the script hash on the page.
- `robots.txt` allows only the page and the public documents and names the sitemap; claim links stay disallowed.
- Cache headers: static assets and public documents are cacheable; every secret route answers `Cache-Control: no-store`, including `DELETE`.
- README rewritten around the handoff, the threat model and self-hosting.

## [1.0.0] - 2026-07-07

First release.

- Zero-knowledge one-time secret links: the browser encrypts with AES-256-GCM (WebCrypto), the server stores only ciphertext and the key rides in the link's `#fragment`.
- One copy block per secret: a spec line and one link `/<code>#<key>`.
- Claim with a single `GET /:code`, which returns `{ct, iv}` once and leaves a tombstone (`410` afterwards). `GET /:code/meta` for lifecycle, `DELETE /:code` to destroy.
- Link-preview bots (Telegram, Slack, Discord, LinkedIn and others) get a note instead of burning the link.
- Expiry from 5 minutes to 24 hours, soft per-IP rate limit, a CSP that allows no external sources, and `no-store` on secret responses.
- Cloudflare Worker (Hono) + Workers KV, no server secrets.

[1.1.0]: https://github.com/mrcsXndr/agent-secret/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mrcsXndr/agent-secret/releases/tag/v1.0.0
