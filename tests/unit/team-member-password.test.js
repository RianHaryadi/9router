import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Teammates sign in with a PASSWORD the owner chose — one field, no
// username, no key to copy. The key that bills their requests stays
// server-side.
//
// Covers:
//   1. the owner's password still identifies the owner,
//   2. a teammate's password identifies THAT teammate (and only them),
//   3. a disabled teammate cannot sign in,
//   4. the member's key is resolved from their row, never exposed,
//   5. the password hash never leaves the server.

let tempDir;
const originalDataDir = process.env.DATA_DIR;

const mocks = vi.hoisted(() => ({
  setCookie: vi.fn(),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.setCookie })),
}));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: () => false }));
vi.mock("@/lib/auth/saml.js", () => ({ isSamlConfigured: () => false }));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: () => ({ locked: false }),
  recordFail: () => ({ remainingBeforeLock: 4 }),
  recordSuccess: vi.fn(),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: () => true }));

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-teammembers-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function post(body) {
  return new Request("https://router.example/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function payloadOfCookie() {
  const value = mocks.setCookie.mock.calls[0][1];
  return JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
}

describe("teammate password sign-in", () => {
  it("signs a teammate in with their password and binds the session to their key", async () => {
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { createTeamMember } = await import("@/lib/db/repos/teamMembersRepo.js");
    const key = await createApiKey("andi-key", "m1");
    await createTeamMember({ name: "Andi", password: "teh-pw", apiKeyRef: key.keyRef });

    const { POST } = await import("../../src/app/api/auth/login/route.js");
    const res = await POST(post({ password: "teh-pw" }));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("member");
    expect(res.body.username).toBe("Andi");

    const payload = payloadOfCookie();
    expect(payload.role).toBe("member");
    expect(payload.keyRef).toBe(key.keyRef);
    expect(payload.keyRef).not.toBe(key.key);
  });

  it("rejects a wrong password", async () => {
    const { createTeamMember } = await import("@/lib/db/repos/teamMembersRepo.js");
    await createTeamMember({ name: "Budi", password: "teh-pw" });

    const { POST } = await import("../../src/app/api/auth/login/route.js");
    const res = await POST(post({ password: "nope" }));

    expect(res.status).toBe(401);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("refuses a disabled teammate", async () => {
    const { createTeamMember, updateTeamMember } = await import("@/lib/db/repos/teamMembersRepo.js");
    const member = await createTeamMember({ name: "Citra", password: "teh-pw" });
    await updateTeamMember(member.id, { isActive: false });

    const { POST } = await import("../../src/app/api/auth/login/route.js");
    const res = await POST(post({ password: "teh-pw" }));

    expect(res.status).toBe(401);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("keeps the owner's password identifying the owner", async () => {
    const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const bcrypt = await import("bcryptjs");
    await updateSettings({ password: await bcrypt.hash("owner-secret", 10) });

    const { POST } = await import("../../src/app/api/auth/login/route.js");
    const res = await POST(post({ password: "owner-secret" }));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("owner");
    expect(payloadOfCookie().keyRef).toBeNull();
  });

  it("never exposes the password hash", async () => {
    const { createTeamMember, getTeamMembers } = await import("@/lib/db/repos/teamMembersRepo.js");
    const created = await createTeamMember({ name: "Dewi", password: "teh-pw" });
    expect(created.passwordHash).toBeUndefined();
    const [listed] = await getTeamMembers();
    expect(listed.passwordHash).toBeUndefined();
  });

  it("resolves the member's key from their row, server-side only", async () => {
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { createTeamMember, getTeamMemberApiKey } = await import("@/lib/db/repos/teamMembersRepo.js");
    const key = await createApiKey("dewi-key", "m2");
    const member = await createTeamMember({ name: "Dewi", password: "teh-pw", apiKeyRef: key.keyRef });

    expect(await getTeamMemberApiKey(member)).toBe(key.key);

    // A member without an assigned key resolves to nothing.
    const noKey = await createTeamMember({ name: "Eka", password: "teh-pw" });
    expect(await getTeamMemberApiKey(noKey)).toBeNull();
  });
});
