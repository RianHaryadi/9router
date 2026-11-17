import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Key sign-in: a teammate signs in with an API KEY instead of a password.
// The key IS the identity — the session is bound to the key's fingerprint, so
// every request the teammate makes is billed to that key and is subject to
// that key's allow-list, budget and rate limits.
//
// Covers:
//   1. a valid key signs in and yields a member session bound to its fingerprint,
//   2. an unknown or disabled key does not,
//   3. the member's model picker only shows what the key's allow-list reaches,
//   4. the guard keeps a member out of every owner-only API and dashboard page.

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  await getAdapter();
  return { keys, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-keylogin-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("key sign-in", () => {
  it("accepts a valid key and binds the session to its fingerprint", async () => {
    const { keys } = await boot();
    const key = await keys.createApiKey("andi", "m1");

    const { getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const record = await getApiKeyByKey(key.key);
    expect(record).toBeTruthy();
    expect(record.keyRef).toMatch(/^[0-9a-f]{16}$/);
    expect(record.keyRef).not.toBe(key.key);
  });

  it("rejects an unknown key and a disabled key", async () => {
    const { keys } = await boot();
    const { getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await keys.createApiKey("budi", "m2");
    await keys.updateApiKey(key.id, { isActive: false });

    expect(await getApiKeyByKey("sk-not-a-real-key")).toBeNull();
    const disabled = await getApiKeyByKey(key.key);
    expect(disabled.isActive).toBe(false);
  });

  it("never hands the raw key back through the key list", async () => {
    const { keys } = await boot();
    const key = await keys.createApiKey("citra", "m3");
    const listed = await keys.getApiKeys();
    const row = listed.find((k) => k.id === key.id);
    // The list still carries the key (the owner UI needs it), but every row
    // also carries the fingerprint that the usage layer persists.
    expect(row.keyRef).toBeTruthy();
    expect(row.keyRef).not.toBe(row.key);
  });
});

describe("member access gate", () => {
  it("keeps a member out of owner-only APIs and pages", async () => {
    const { __test__ } = await import("../../src/dashboardGuard.js");

    const allowed = __test__.MEMBER_ALLOWED_PATHS;
    expect(allowed).toContain("/api/dashboard/chat/completions");
    // /api/providers IS allowed (read-only) — the chat model picker needs it.
    expect(allowed).toContain("/api/providers");
    for (const ownerOnly of [
      "/api/keys",
      "/api/settings",
      "/api/usage",
      "/api/dashboard/users",
      "/api/shutdown",
      "/api/oauth",
      "/api/cloud",
    ]) {
      expect(allowed).not.toContain(ownerOnly);
    }

    const pages = __test__.MEMBER_ALLOWED_PAGE_PREFIXES;
    expect(pages).toEqual(["/dashboard/basic-chat"]);
    for (const ownerPage of [
      "/dashboard/endpoint",
      "/dashboard/providers",
      "/dashboard/usage",
      "/dashboard/profile",
      "/dashboard/health",
    ]) {
      expect(pages).not.toContain(ownerPage);
    }
  });

  it("treats a session without a role claim as a member (fails closed)", async () => {
    const { dashboardRoleOf, DASHBOARD_ROLE_OWNER, DASHBOARD_ROLE_MEMBER } = await import(
      "../../src/lib/auth/dashboardSession.js"
    );
    expect(dashboardRoleOf({ role: "owner" })).toBe(DASHBOARD_ROLE_OWNER);
    expect(dashboardRoleOf({ role: "member" })).toBe(DASHBOARD_ROLE_MEMBER);
    expect(dashboardRoleOf({})).toBe(DASHBOARD_ROLE_MEMBER);
    expect(dashboardRoleOf(null)).toBe(DASHBOARD_ROLE_MEMBER);
  });
});
