import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const repo = await import("@/lib/db/repos/apiKeysRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { repo, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-tpm-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("per-key fixed-window token limits", () => {
  it("defaults tpmLimit to 0 on create and persists it on update", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("tpm", "machine-tpm");
    expect(key.tpmLimit).toBe(0);
    expect((await repo.getApiKeyById(key.id)).tpmLimit).toBe(0);
    expect((await repo.updateApiKey(key.id, { tpmLimit: 5000 })).tpmLimit).toBe(5000);
    expect((await repo.getApiKeyById(key.id)).tpmLimit).toBe(5000);
  });

  it("rejects invalid tpmLimit values", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("tpm-invalid", "machine-tpm-invalid");
    await expect(repo.updateApiKey(key.id, { tpmLimit: -1 })).rejects.toThrow(/tpmLimit/);
    await expect(repo.updateApiKey(key.id, { tpmLimit: 1.5 })).rejects.toThrow(/tpmLimit/);
    await expect(repo.updateApiKey(key.id, { tpmLimit: 1_000_000_001 })).rejects.toThrow(/tpmLimit/);
    expect((await repo.getApiKeyById(key.id)).tpmLimit).toBe(0);
  });

  it("admits tokens up to the configured limit and rejects excess until reset", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("limited", "machine-limited");
    const other = await repo.createApiKey("other", "machine-other");
    const opts = { limit: 100, windowMs: 60_000, tokens: 40, now: 120_001 };

    expect(await repo.consumeApiKeyTokenLimit(key.key, opts)).toEqual({ allowed: true, remaining: 60, resetAt: 180_000 });
    expect(await repo.consumeApiKeyTokenLimit(key.key, opts)).toEqual({ allowed: true, remaining: 20, resetAt: 180_000 });
    expect(await repo.consumeApiKeyTokenLimit(key.key, opts)).toEqual({ allowed: false, remaining: 0, resetAt: 180_000 });
    expect(await repo.consumeApiKeyTokenLimit(other.key, opts)).toMatchObject({ allowed: true });
    expect(await repo.consumeApiKeyTokenLimit(key.key, { ...opts, now: 180_000 })).toMatchObject({ allowed: true, resetAt: 240_000 });
  });

  it("resets the counter when the window rolls over", async () => {
    const { repo, adapter } = await boot();
    const key = await repo.createApiKey("window", "machine-window");
    await repo.consumeApiKeyTokenLimit(key.key, { limit: 100, windowMs: 60_000, tokens: 90, now: 60_000 });
    expect(adapter.get("SELECT tpmTokenCount FROM apiKeys WHERE key = ?", [key.key]).tpmTokenCount).toBe(90);
    await repo.consumeApiKeyTokenLimit(key.key, { limit: 100, windowMs: 60_000, tokens: 90, now: 120_000 });
    expect(adapter.get("SELECT tpmTokenCount FROM apiKeys WHERE key = ?", [key.key]).tpmTokenCount).toBe(90);
    expect(adapter.get("SELECT tpmWindowStart FROM apiKeys WHERE key = ?", [key.key]).tpmWindowStart).toBe(120_000);
  });

  it("allows unrestricted keys without creating a bucket", async () => {
    const { repo, adapter } = await boot();
    const key = await repo.createApiKey("unlimited", "machine-unlimited");
    expect(await repo.consumeApiKeyTokenLimit(key.key, { limit: 0, windowMs: 60_000, tokens: 10_000, now: 1 })).toEqual({ allowed: true, remaining: null, resetAt: null });
    expect(adapter.get("SELECT tpmTokenCount FROM apiKeys WHERE key = ?", [key.key]).tpmTokenCount).toBe(0);
    expect(await repo.enforceApiKeyTokenLimit(key.key, 10_000, 1)).toBeNull();
  });

  it("returns 429 with retry metadata after the configured tokens/minute", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("enforced", "machine-enforced");
    await repo.updateApiKey(key.id, { tpmLimit: 100 });
    expect(await repo.enforceApiKeyTokenLimit(key.key, 60, 1_000)).toBeNull();
    const blocked = await repo.enforceApiKeyTokenLimit(key.key, 60, 1_001);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("content-type")).toContain("application/json");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get("x-ratelimit-limit")).toBe("100");
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(blocked.headers.get("x-ratelimit-reset")).toBeTruthy();
    const body = await blocked.json();
    expect(body).toEqual({ error: { message: "API key token rate limit exceeded", type: "rate_limit_error" } });
  });

  it("atomically caps concurrent token consumption at the configured limit", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("burst", "machine-burst");
    const results = await Promise.all(Array.from({ length: 50 }, () => repo.consumeApiKeyTokenLimit(key.key, { limit: 8, windowMs: 60_000, tokens: 1, now: 1_000 })));
    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    expect(results.filter((result) => !result.allowed)).toHaveLength(42);
  });

  it("migrates the tpm columns idempotently", async () => {
    const { adapter } = await boot();
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    expect(latestVersion()).toBe(8);
    expect(SCHEMA_VERSION).toBe(8);
    const cols = adapter.all("PRAGMA table_info(apiKeys)").map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(["tpmLimit", "tpmWindowStart", "tpmTokenCount"]));
    const m003 = MIGRATIONS.find((m) => m.version === 8);
    expect(m003.name).toBe("tpm-limit");
    m003.up(adapter);
    m003.up(adapter);
    const colsAfter = adapter.all("PRAGMA table_info(apiKeys)").map((r) => r.name);
    expect(colsAfter.filter((c) => c.startsWith("tpm"))).toHaveLength(3);
  });
});
