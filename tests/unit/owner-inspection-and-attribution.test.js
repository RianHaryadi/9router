import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Owner-only inspection of stored prompts, and the "who is using it right now"
// attribution, both ride on the usage layer.
//
// This file covers:
//   1. the API key is never persisted in plain text (usage history / daily
//      rollup / fallback events hold a non-reversible fingerprint),
//   2. the live attribution maps a fingerprint back to the key's NAME,
//   3. GET /api/usage/request-details only returns the stored content when
//      BOTH the owner setting and the dashboard session are present.

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const usage = await import("@/lib/db/repos/usageRepo.js");
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  await getAdapter();
  return { usage, keys, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-inspect-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key fingerprint persistence", () => {
  it("stores a non-reversible fingerprint instead of the raw key", async () => {
    const { usage, keys, adapter } = await boot();
    const key = await keys.createApiKey("andi", "machine-andi");

    await usage.saveRequestUsage({
      provider: "openai",
      model: "gpt-5",
      connectionId: "c1",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    const row = adapter.get(`SELECT apiKey FROM usageHistory WHERE provider = 'openai'`);
    expect(row.apiKey).not.toBe(key.key);
    expect(row.apiKey).toMatch(/^[0-9a-f]{16}$/);

    // The daily rollup carries the fingerprint too — never the secret.
    const day = adapter.get(`SELECT data FROM usageDaily LIMIT 1`);
    expect(day.data).not.toContain(key.key);
  });

  it("resolves the key NAME back from the fingerprint in the usage stats", async () => {
    const { usage, keys } = await boot();
    const key = await keys.createApiKey("budi", "machine-budi");

    await usage.saveRequestUsage({
      provider: "openai",
      model: "gpt-5",
      connectionId: "c1",
      apiKey: key.key,
      tokens: { prompt_tokens: 7, completion_tokens: 3 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    const stats = await usage.getUsageStats("24h");
    const entries = Object.values(stats.byApiKey);
    expect(entries).toHaveLength(1);
    expect(entries[0].keyName).toBe("budi");
    expect(entries[0].apiKeyMasked).not.toContain(key.key);
  });

  it("attributes in-flight requests to the key that made them", async () => {
    const { usage, keys } = await boot();
    const key = await keys.createApiKey("citra", "machine-citra");

    usage.trackPendingRequest("gpt-5", "openai", "c1", true, false, key.key);
    const active = await usage.getActiveRequests();

    expect(active.activeByKey).toHaveLength(1);
    expect(active.activeByKey[0].keyName).toBe("citra");
    expect(active.activeByKey[0].model).toBe("gpt-5");
    expect(active.activeByKey[0].count).toBe(1);
    // The raw key never leaves the process.
    expect(JSON.stringify(active.activeByKey)).not.toContain(key.key);

    usage.trackPendingRequest("gpt-5", "openai", "c1", false, false, key.key);
    const after = await usage.getActiveRequests();
    expect(after.activeByKey).toHaveLength(0);
  });
});

describe("GET /api/usage/request-details content gate", () => {
  async function loadRoute({ authenticated, promptInspectionEnabled }) {
    // Fresh module registry: the route is imported per case, so the previous
    // case's mocks must not be cached.
    vi.resetModules();
    const mocks = {
      json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
      getRequestDetails: vi.fn(),
      getSettings: vi.fn(),
      isAuthenticated: vi.fn(),
    };

    vi.doMock("next/server", () => ({ NextResponse: { json: mocks.json } }));
    vi.doMock("@/lib/usageDb", () => ({ getRequestDetails: mocks.getRequestDetails }));
    vi.doMock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
    vi.doMock("@/dashboardGuard", () => ({ isAuthenticated: mocks.isAuthenticated }));

    mocks.getRequestDetails.mockResolvedValue({
      details: [{ id: "d1", request: { messages: [{ role: "user", content: "secret prompt" }] } }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    mocks.getSettings.mockResolvedValue({ promptInspectionEnabled });
    mocks.isAuthenticated.mockResolvedValue(authenticated);

    const mod = await import("../../src/app/api/usage/request-details/route.js");
    return { GET: mod.GET, mocks };
  }

  const req = (url) => new Request(`https://router.example${url}`);

  it("redacts the content by default", async () => {
    const { GET } = await loadRoute({ authenticated: true, promptInspectionEnabled: true });
    const res = await GET(req("/api/usage/request-details"));
    expect(res.body.details[0].request).toEqual({ redacted: true });
    expect(res.body.contentIncluded).toBe(false);
  });

  it("returns the content for an authenticated owner when the setting is on", async () => {
    const { GET } = await loadRoute({ authenticated: true, promptInspectionEnabled: true });
    const res = await GET(req("/api/usage/request-details?includeContent=1"));
    expect(res.body.details[0].request.messages[0].content).toBe("secret prompt");
    expect(res.body.contentIncluded).toBe(true);
  });

  it("keeps the content redacted when the owner setting is off", async () => {
    const { GET } = await loadRoute({ authenticated: true, promptInspectionEnabled: false });
    const res = await GET(req("/api/usage/request-details?includeContent=1"));
    expect(res.body.details[0].request).toEqual({ redacted: true });
    expect(res.body.contentIncluded).toBe(false);
  });

  it("keeps the content redacted without a dashboard session", async () => {
    const { GET } = await loadRoute({ authenticated: false, promptInspectionEnabled: true });
    const res = await GET(req("/api/usage/request-details?includeContent=1"));
    expect(res.body.details[0].request).toEqual({ redacted: true });
    expect(res.body.contentIncluded).toBe(false);
  });
});
