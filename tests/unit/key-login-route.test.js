import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// End-to-end of the key sign-in path through POST /api/auth/login.
//
// The teammate's identity IS the key: a valid key yields a member session
// bound to the key's fingerprint (so their chat requests are billed to that
// key), an unknown key is rejected, and the owner's password login keeps
// working unchanged.

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-keylogin-"));
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

async function loadRoute() {
  // Keep the DB adapter alive across the module reset: the route module and
  // the test share one database, and resetting the modules would otherwise
  // close it.
  const { POST } = await import("../../src/app/api/auth/login/route.js");
  return POST;
}

function post(body) {
  return new Request("https://router.example/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login with an API key", () => {
  it("signs a teammate in and binds the session to the key fingerprint", async () => {
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("andi", "m1");
    const POST = await loadRoute();

    const res = await POST(post({ apiKey: key.key }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe("member");
    expect(res.body.username).toBe("andi");

    // The cookie carries the fingerprint, NOT the raw key.
    const cookieCall = mocks.setCookie.mock.calls[0];
    const cookieName = cookieCall[0];
    const cookieValue = cookieCall[1];
    expect(cookieName).toBe("auth_token");
    expect(typeof cookieValue).toBe("string");
    expect(cookieValue).not.toContain(key.key);

    // The fingerprint is inside the signed token.
    const payload = JSON.parse(Buffer.from(cookieValue.split(".")[1], "base64url").toString("utf8"));
    expect(payload.role).toBe("member");
    expect(payload.keyRef).toMatch(/^[0-9a-f]{16}$/);
    expect(payload.keyRef).not.toBe(key.key);
    expect(payload.username).toBe("andi");
  });

  it("rejects an unknown key", async () => {
    const POST = await loadRoute();
    const res = await POST(post({ apiKey: "sk-does-not-exist" }));

    expect(res.status).toBe(401);
    expect(res.body.success).toBeUndefined();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("rejects a disabled key", async () => {
    const { createApiKey, updateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("budi", "m2");
    await updateApiKey(key.id, { isActive: false });
    const POST = await loadRoute();

    const res = await POST(post({ apiKey: key.key }));
    expect(res.status).toBe(401);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("keeps the owner's password login working and marks it as owner", async () => {
    const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const bcrypt = await import("bcryptjs");
    await updateSettings({ password: await bcrypt.hash("owner-secret", 10) });
    const POST = await loadRoute();

    const res = await POST(post({ password: "owner-secret" }));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("owner");

    const cookieValue = mocks.setCookie.mock.calls[0][1];
    const payload = JSON.parse(Buffer.from(cookieValue.split(".")[1], "base64url").toString("utf8"));
    expect(payload.role).toBe("owner");
    expect(payload.keyRef).toBeNull();
  });
});
