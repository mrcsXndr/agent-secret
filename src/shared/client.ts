// Tiny HTTP client for the agent-secret API — shared by the CLI and MCP server.

export interface PutOptions {
  value: string;
  name?: string;
  ttlSeconds?: number;
  passphrase?: string;
}

export interface PutResult {
  code: string;
  expiresAt: string;
  ttl: number;
}

export interface ClaimResult {
  name?: string;
  value: string;
}

export interface MetaResult {
  exists: boolean;
  claimed?: boolean;
  hasPassphrase?: boolean;
  expiresAt?: string;
  claimedAt?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(baseUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(data.error ?? "http_error"),
      String(data.message ?? `HTTP ${res.status}`),
    );
  }
  return data as T;
}

export function putSecret(baseUrl: string, opts: PutOptions): Promise<PutResult> {
  return request<PutResult>(baseUrl, "POST", "/secret", {
    value: opts.value,
    name: opts.name,
    ttl: opts.ttlSeconds,
    passphrase: opts.passphrase,
  });
}

export function claimSecret(baseUrl: string, code: string, passphrase?: string): Promise<ClaimResult> {
  return request<ClaimResult>(baseUrl, "POST", `/secret/${encodeURIComponent(code)}/claim`, {
    passphrase,
  });
}

export function getMeta(baseUrl: string, code: string): Promise<MetaResult> {
  return request<MetaResult>(baseUrl, "GET", `/secret/${encodeURIComponent(code)}/meta`);
}

export function burnSecret(baseUrl: string, code: string): Promise<void> {
  return request<void>(baseUrl, "DELETE", `/secret/${encodeURIComponent(code)}`);
}

/** Resolve the API endpoint from an explicit flag or the AGENT_SECRET_URL env var. */
export function resolveBaseUrl(explicit?: string): string {
  const url = explicit ?? process.env.AGENT_SECRET_URL;
  if (!url) {
    throw new Error(
      "No endpoint configured. Set AGENT_SECRET_URL (e.g. https://agent-secret.<you>.workers.dev) or pass --url.",
    );
  }
  return url;
}
