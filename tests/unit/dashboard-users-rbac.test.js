import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Teammate accounts: own username + own password, and nothing but Basic Chat.
//
// Covers:
//   1. a member's password is verified against their OWN hash (never the
//      owner's settings.password),
//   2. a member's chat requests are billed to the key assigned to them,
//   3. the guard keeps a member out of every owner-only API and dashboard
//      page, while letting them read the model picker metadata.

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const users = await import("@/lib/db/repos/dashboardUsersRepo.js");
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  await getAdapter();
  return { users, keys, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-members-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("dashboard users (teammates)", () => {
  it("verifies a member against their own password, not the owner's", async () => {
    const { users } = await boot();
    await users.createDashboardUser({ username: "andi", password: "andi-secret" });

    expect(await users.verifyDashboardUserPassword("andi", "andi-secret")).toBeTruthy();
    expect(await users.verifyDashboardUserPassword("andi", "wrong")).toBeNull();
    // The owner's dashboard password must never authenticate a member.
    expect(await users.verifyDashboardUserPassword("andi", "123456")).toBeNull();
    // Case-insensitive username.
    expect(await users.verifyDashboardUserPassword("ANDI", "andi-secret")).toBeTruthy();
  });

  it("never exposes the password hash", async () => {
    const { users } = await boot();
    const created = await users.createDashboardUser({ username: "budi", password: "budi-secret" });
    expect(created.passwordHash).toBeUndefined();
    const [listed] = await users.getDashboardUsers();
    expect(listed.passwordHash).toBeUndefined();
    expect(listed.role).toBe("member");
  });

  it("refuses a disabled member", async () => {
    const { users } = await boot();
    const created = await users.createDashboardUser({ username: "citra", password: "citra-secret" });
    await users.updateDashboardUser(created.id, { isActive: false });
    expect(await users.verifyDashboardUserPassword("citra", "citra-secret")).toBeNull();
  });

  it("resolves the member's assigned key, and only that one", async () => {
    const { users, keys } = await boot();
    const andiKey = await keys.createApiKey("andi-key", "m1");
    const budiKey = await keys.createApiKey("budi-key", "m2");

    const andi = await users.createDashboardUser({
      username: "andi",
      password: "andi-secret",
      apiKeyRef: andiKey.keyRef,
    });

    const resolved = await users.getDashboardUserApiKey({ id: andi.id });
    expect(resolved).toBe(andiKey.key);
    expect(resolved).not.toBe(budiKey.key);

    // A member without an assigned key resolves to nothing.
    const noKey = await users.createDashboardUser({ username: "noel", password: "noel-secret" });
    expect(await users.getDashboardUserApiKey({ id: noKey.id })).toBeNull();
  });
});

describe("member role gate", () => {
  it("keeps a member out of owner-only APIs and pages", async () => {
    const { __test__ } = await import("../../src/dashboardGuard.js");

    const allowed = __test__.MEMBER_ALLOWED_PATHS;
    expect(allowed).toContain("/api/dashboard/chat/completions");
    // /api/providers IS allowed — the chat model picker needs the connection
    // list — but only for read verbs; the guard blocks every other method.
    expect(allowed).toContain("/api/providers");
    // Owner-only surfaces must NOT be in the member allow-list.
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
