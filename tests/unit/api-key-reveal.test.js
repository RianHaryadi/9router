import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A key value is a bearer secret. The list never carries it over the network;
// the OWNER fetches one value with the dashboard password
// (POST /api/keys/[id]/reveal). A teammate never gets one.

const originalDataDir = process.env.DATA_DIR;

const mocks = vi.hoisted(() => ({
  isLocalRequest: vi.fn(),
  isMemberSession: vi.fn(),
  verifyDashboardPassword: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.isLocalRequest,
  isMemberSession: mocks.isMemberSession,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardPassword: mocks.verifyDashboardPassword,
}));

function request(headers = {}) {
  return {
    nextUrl: { pathname: "/api/keys/k1/reveal", searchParams: new URLSearchParams() },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: "http://localhost/api/keys/k1/reveal",
  };
}

async function boot() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-reveal-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  const { POST } = await import("@/app/api/keys/[id]/reveal/route.js");
  const { createApiKey } = await import("@/lib/localDb");
  return { POST, createApiKey, tempDir };
}

beforeEach(() => {
  mocks.isLocalRequest.mockReset();
  mocks.isMemberSession.mockReset();
  mocks.verifyDashboardPassword.mockReset();
  mocks.isLocalRequest.mockReturnValue(false);
  mocks.isMemberSession.mockResolvedValue(false);
  mocks.verifyDashboardPassword.mockResolvedValue(false);
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  try { global._dbAdapter?.instance?.close?.(); } catch { /* ignore */ }
  delete global._dbAdapter;
});

describe("POST /api/keys/[id]/reveal", () => {
  it("refuses a teammate, even on the host", async () => {
    const { POST, createApiKey, tempDir } = await boot();
    try {
      await createApiKey("Default Key", "m1");
      mocks.isLocalRequest.mockReturnValue(true);
      mocks.isMemberSession.mockResolvedValue(true);

      const res = await POST(request(), { params: Promise.resolve({ id: "any" }) });
      expect(res.status).toBe(403);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses a remote owner without the dashboard password", async () => {
    const { POST, createApiKey, tempDir } = await boot();
    try {
      await createApiKey("Default Key", "m1");
      mocks.verifyDashboardPassword.mockResolvedValue(false);

      const res = await POST(request(), { params: Promise.resolve({ id: "any" }) });
      expect(res.status).toBe(401);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("gives the raw value to a remote owner with the right password", async () => {
    const { POST, createApiKey, tempDir } = await boot();
    try {
      const created = await createApiKey("Default Key", "m1");
      mocks.verifyDashboardPassword.mockResolvedValue(true);

      const res = await POST(
        request({ "x-9r-password": "hunter2" }),
        { params: Promise.resolve({ id: created.id }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.key).toBe(created.key);
      expect(body.key).not.toContain("***");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("gives the raw value to a local owner without a password", async () => {
    const { POST, createApiKey, tempDir } = await boot();
    try {
      const created = await createApiKey("Default Key", "m1");
      mocks.isLocalRequest.mockReturnValue(true);

      const res = await POST(request(), { params: Promise.resolve({ id: created.id }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.key).toBe(created.key);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("404s an unknown key", async () => {
    const { POST, tempDir } = await boot();
    try {
      mocks.verifyDashboardPassword.mockResolvedValue(true);
      const res = await POST(request({ "x-9r-password": "x" }), {
        params: Promise.resolve({ id: "missing" }),
      });
      expect(res.status).toBe(404);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
