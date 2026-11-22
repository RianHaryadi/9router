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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-rpm-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("per-key fixed-window request limits", () => {
  it("admits requests up to the configured limit and rejects excess until reset", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("limited", "machine-limited");
    const other = await repo.createApiKey("other", "machine-other");
    const opts = { limit: 2, windowMs: 60_000, now: 120_001 };

    expect(await repo.consumeApiKeyRateLimit(key.key, opts)).toEqual({ allowed: true, remaining: 1, resetAt: 180_000 });
    expect(await repo.consumeApiKeyRateLimit(key.key, opts)).toEqual({ allowed: true, remaining: 0, resetAt: 180_000 });
    expect(await repo.consumeApiKeyRateLimit(key.key, opts)).toEqual({ allowed: false, remaining: 0, resetAt: 180_000 });
    expect(await repo.consumeApiKeyRateLimit(other.key, opts)).toMatchObject({ allowed: true });
    expect(await repo.consumeApiKeyRateLimit(key.key, { ...opts, now: 180_000 })).toMatchObject({ allowed: true, resetAt: 240_000 });
  });

  it("persists a nonnegative RPM policy on the API key", async () => {
    const { repo } = await boot();
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("rpm", "machine-rpm");
    expect(key.rpmLimit).toBe(0);
    expect((await repo.updateApiKey(key.id, { rpmLimit: 12 })).rpmLimit).toBe(12);
    await expect(repo.updateApiKey(key.id, { rpmLimit: -1 })).rejects.toThrow(/rpmLimit/);
    await expect(repo.updateApiKey(key.id, { rpmLimit: 1.5 })).rejects.toThrow(/rpmLimit/);
  });

  it("atomically caps concurrent requests at the configured limit", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("burst", "machine-burst");
    const results = await Promise.all(Array.from({ length: 50 }, () => repo.consumeApiKeyRateLimit(key.key, { limit: 8, windowMs: 60_000, now: 1_000 })));
    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    expect(results.filter((result) => !result.allowed)).toHaveLength(42);
  });

  it("allows unrestricted keys without creating a bucket", async () => {
    const { repo, adapter } = await boot();
    const key = await repo.createApiKey("unlimited", "machine-unlimited");
    expect(await repo.consumeApiKeyRateLimit(key.key, { limit: 0, windowMs: 60_000, now: 1 })).toEqual({ allowed: true, remaining: null, resetAt: null });
    expect(adapter.get("SELECT rpmRequestCount FROM apiKeys WHERE key = ?", [key.key]).rpmRequestCount).toBe(0);
  });

  it("returns 429 with retry metadata after the configured requests/minute", async () => {
    const { repo } = await boot();
    const key = await repo.createApiKey("enforced", "machine-enforced");
    await repo.updateApiKey(key.id, { rpmLimit: 1 });
    expect(await repo.enforceApiKeyRateLimit(key.key, 1_000)).toBeNull();
    const blocked = await repo.enforceApiKeyRateLimit(key.key, 1_001);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get("x-ratelimit-limit")).toBe("1");
  });

});
