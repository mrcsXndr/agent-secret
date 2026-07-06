import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertEnvVar } from "../src/mcp/server.js";

function tmpEnvFile(initial?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-secret-test-"));
  const file = join(dir, ".env");
  if (initial !== undefined) writeFileSync(file, initial, "utf8");
  return file;
}

describe("upsertEnvVar (MCP save_to)", () => {
  it("creates the file when missing", () => {
    const file = tmpEnvFile();
    upsertEnvVar(file, "OPENAI_API_KEY", "sk-1");
    expect(readFileSync(file, "utf8")).toBe("OPENAI_API_KEY=sk-1\n");
  });

  it("appends to an existing file", () => {
    const file = tmpEnvFile("EXISTING=1\n");
    upsertEnvVar(file, "NEW_KEY", "v");
    expect(readFileSync(file, "utf8")).toBe("EXISTING=1\nNEW_KEY=v\n");
  });

  it("replaces an existing entry instead of duplicating it", () => {
    const file = tmpEnvFile("A=1\nOPENAI_API_KEY=old\nB=2\n");
    upsertEnvVar(file, "OPENAI_API_KEY", "new");
    expect(readFileSync(file, "utf8")).toBe("A=1\nOPENAI_API_KEY=new\nB=2\n");
  });
});
