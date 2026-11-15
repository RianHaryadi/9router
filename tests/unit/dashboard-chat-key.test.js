import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir;
let adapter;
const originalDataDir = process.env.DATA_DIR;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-dashboard-key-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  adapter?.close?.();
  delete global._dbAdapter;
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});
async function boot() {
  const repo = await import("@/lib/db/repos/apiKeysRepo.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  return repo;
}

describe("server-managed dashboard chat key", () => {
  it("creates one persistent key under concurrency, without reusing client keys", async () => {
    const repo = await boot();
    const client = await repo.createApiKey("Client key", "client-machine");
    const keys = await Promise.all(Array.from({ length: 20 }, () => repo.getDashboardChatApiKey()));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).not.toBe(client.key);
    expect(await repo.validateApiKey(keys[0])).toBe(true);
    expect((await repo.getApiKeys())).toHaveLength(2);
    const record = await repo.getApiKeyByKey(keys[0]);
    expect(record.name).toBe("Dashboard Basic Chat");
    expect(await repo.getDashboardChatApiKey()).toBe(keys[0]);
  });
  it("keeps the managed key's configured limits and does not replace a disabled key", async () => {
    const repo = await boot();
    const key = await repo.getDashboardChatApiKey();
    const record = await repo.getApiKeyByKey(key);
    await repo.updateApiKey(record.id, { rpmLimit: 9, budgetLimitCents: 100, isActive: false });
    expect(await repo.getDashboardChatApiKey()).toBeNull();
    expect((await repo.getApiKeys())).toHaveLength(1);
    expect(await repo.getApiKeyByKey(key)).toMatchObject({ rpmLimit: 9, budgetLimitCents: 100, isActive: false });
  });
});
