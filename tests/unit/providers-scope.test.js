import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The Providers page shows the owner's WHOLE setup to a teammate (names
// only, never the account identity), while the chat picker shows only what
// the caller's key may reach.
//
// Two scopes, two rules:
//   default — filtered by the caller's key allow-list (the picker agrees
//             with the router on what may be called),
//   shared  — the whole setup, but only for a member that holds the
//             "providers" area.
//
// A member without that area must not be able to enumerate the setup by
// adding ?scope=shared to the URL.

const originalDataDir = process.env.DATA_DIR;

const mocks = vi.hoisted(() => ({
  isMemberSession: vi.fn(),
  getSession: vi.fn(),
  liveAreasOf: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isMemberSession: mocks.isMemberSession,
  getSession: mocks.getSession,
  liveAreasOf: mocks.liveAreasOf,
}));

function request(query = "") {
  return {
    nextUrl: {
      pathname: "/api/providers",
      searchParams: new URLSearchParams(query),
    },
    headers: new Headers(),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost/api/providers${query ? `?${query}` : ""}`,
  };
}

async function boot() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-providers-scope-"));
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
  const { GET } = await import("@/app/api/providers/route.js");
  const { createProviderConnection } = await import("@/models/index.js");
  return { GET, createProviderConnection, tempDir };
}

beforeEach(() => {
  mocks.isMemberSession.mockReset();
  mocks.getSession.mockReset();
  mocks.liveAreasOf.mockReset();
  mocks.isMemberSession.mockResolvedValue(false);
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  try { global._dbAdapter?.instance?.close?.(); } catch { /* ignore */ }
  delete global._dbAdapter;
});

describe("GET /api/providers scopes", () => {
  it("gives the owner the whole list in both scopes", async () => {
    const { GET, createProviderConnection, tempDir } = await boot();
    try {
      await createProviderConnection({
        provider: "claude",
        authType: "oauth",
        name: "[REDACTED_EMAIL]",
        apiKey: "sk-x",
      });

      const plain = await (await GET(request())).json();
      const shared = await (await GET(request("scope=shared"))).json();
      expect(plain.connections.length).toBe(1);
      expect(shared.connections.length).toBe(1);
      // The owner sees the account identity — it is their own account.
      expect(plain.connections[0].name).toBe("[REDACTED_EMAIL]");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses scope=shared to a member without the providers area", async () => {
    const { GET, createProviderConnection, tempDir } = await boot();
    try {
      await createProviderConnection({
        provider: "claude",
        authType: "oauth",
        name: "[REDACTED_EMAIL]",
        apiKey: "sk-x",
      });
      mocks.isMemberSession.mockResolvedValue(true);
      mocks.liveAreasOf.mockResolvedValue(new Set(["basic-chat"]));

      const res = await GET(request("scope=shared"));
      expect(res.status).toBe(403);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("gives scope=shared to a member with the providers area, names only", async () => {
    const { GET, createProviderConnection, tempDir } = await boot();
    try {
      await createProviderConnection({
        provider: "claude",
        authType: "oauth",
        name: "[REDACTED_EMAIL]",
        apiKey: "sk-x",
      });
      mocks.isMemberSession.mockResolvedValue(true);
      mocks.liveAreasOf.mockResolvedValue(new Set(["basic-chat", "providers"]));

      const res = await GET(request("scope=shared"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connections.length).toBe(1);
      // The account identity is gone.
      expect(body.connections[0].name).not.toContain("@");
      expect(body.connections[0].email).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("[REDACTED_EMAIL]");
      // The secret is gone.
      expect(body.connections[0].apiKey).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the default scope limited to the caller's key", async () => {
    const { GET, createProviderConnection, tempDir } = await boot();
    try {
      await createProviderConnection({
        provider: "claude",
        authType: "oauth",
        name: "[REDACTED_EMAIL]",
        apiKey: "sk-x",
      });
      mocks.isMemberSession.mockResolvedValue(true);
      mocks.liveAreasOf.mockResolvedValue(new Set(["basic-chat"]));
      // A member signed in with an API key: the session carries its ref.
      mocks.getSession.mockResolvedValue({ role: "member", keyRef: "unknown-ref" });

      const res = await GET(request());
      expect(res.status).toBe(200);
      const body = await res.json();
      // The key is unknown → no allow-list → nothing is reachable through it.
      expect(body.connections.length).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
