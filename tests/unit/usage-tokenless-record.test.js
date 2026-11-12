import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextResponse } from "next/server";

// Fork (T8): a request that reports no tokens must still be recorded.
//
// Before this change saveUsageStats() returned early when the provider sent
// no usage frame, so the request vanished from usageHistory — and with it the
// latency, ttft, project attribution and fallback count that the Health &
// Spend dashboard reads. The request happened; it must stay visible.

const db = {
  get: vi.fn(() => undefined),
  run: vi.fn(),
  transaction: vi.fn((fn) => fn()),
  all: vi.fn(() => []),
};

// saveUsageStats() reaches the DB through @/lib/usageDb.js -> @/lib/db/index.js
// -> usageRepo.js -> driver.js. Mocking the driver is enough: the insert
// becomes observable without a real SQLite file.
vi.mock("@/lib/db/driver.js", async () => {
  const actual = await vi.importActual("@/lib/db/driver.js");
  return { ...actual, getAdapter: vi.fn(async () => db) };
});

vi.mock("open-sse/providers/pricing.js", () => ({
  calculateCostFromTokens: vi.fn(async () => 0),
}));

const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

let insertArgs;

// saveUsageStats() persists through a fire-and-forget promise chain, so the
// insert lands a few microtasks later.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  insertArgs = undefined;
  db.get.mockReturnValue(undefined); // no existing row
  db.all.mockReturnValue([]);
  db.run.mockImplementation((sql, args) => {
    if (String(sql).includes("INSERT INTO usageHistory")) insertArgs = args;
  });
  db.transaction.mockImplementation((fn) => fn());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("T8 — a tokenless request is still recorded", () => {
  it("writes a usage row even when the provider reported no tokens", async () => {
    saveUsageStats({
      provider: "some-provider",
      model: "some-model",
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      connectionId: "conn-1",
      apiKey: "key-1",
      endpoint: "/v1/chat/completions",
      silent: true,
      latency: { ttft: 120, total: 480 },
      projectName: "my-project",
      fallbackCount: 2,
      requestId: "req-abc",
    });
    await flush();

    expect(insertArgs).toBeDefined();
    // columns: timestamp, provider, model, connectionId, apiKey, endpoint,
    // promptTokens, completionTokens, cost, status, tokens, meta,
    // latencyMs, ttftMs, projectName, fallbackCount, requestId
    expect(insertArgs[12]).toBe(480); // latencyMs
    expect(insertArgs[13]).toBe(120); // ttftMs
    expect(insertArgs[14]).toBe("my-project");
    expect(insertArgs[15]).toBe(2); // fallbackCount
    expect(insertArgs[16]).toBe("req-abc"); // requestId
  });

  it("still records a request whose tokens are present", async () => {
    saveUsageStats({
      provider: "p",
      model: "m",
      tokens: { prompt_tokens: 100, completion_tokens: 20 },
      silent: true,
      latency: { ttft: 10, total: 50 },
      requestId: "req-xyz",
    });
    await flush();

    expect(insertArgs).toBeDefined();
    expect(insertArgs[6]).toBe(100);
    expect(insertArgs[7]).toBe(20);
    expect(insertArgs[16]).toBe("req-xyz");
  });

  it("ignores a call without any tokens object at all", async () => {
    saveUsageStats({ provider: "p", model: "m", tokens: null, silent: true });
    await flush();
    expect(insertArgs).toBeUndefined();
  });
});

describe("T8 — usageHistory gained a requestId column", () => {
  it("declares requestId and an index for it", async () => {
    const { TABLES } = await import("../../src/lib/db/schema.js");
    expect(TABLES.usageHistory.columns.requestId).toBe("TEXT");
    expect(TABLES.usageHistory.indexes).toContain("CREATE INDEX IF NOT EXISTS idx_uh_request ON usageHistory(requestId)");
  });

  it("the schema version is bumped so existing databases pick the column up", async () => {
    const { SCHEMA_VERSION } = await import("../../src/lib/db/schema.js");
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
  });
});
