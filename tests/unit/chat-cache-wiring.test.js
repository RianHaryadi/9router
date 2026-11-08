import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChatCore: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));

vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: async () => null,
  getApiKeyBudget: async () => null,
}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(async () => ({ connectionId: "c1", connectionName: "acc-1" })),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

describe("Chat request caching wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      semanticCacheEnabled: false,
    });
    mocks.handleChatCore.mockImplementation(async () => ({
      success: true,
      response: new Response("upstream-result", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    }));
  });

  it("replays cached response when identical Idempotency-Key is provided", async () => {
    const makeReq = () =>
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "test-key-123",
        },
        body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }),
      });

    // 1st request -> reaches upstream
    const res1 = await handleChat(makeReq());
    expect(res1.status).toBe(200);
    expect(await res1.text()).toBe("upstream-result");
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);

    // Give background cache pump a tick
    await new Promise((r) => setTimeout(r, 20));

    // 2nd request with same key -> replayed from idempotency cache!
    const res2 = await handleChat(makeReq());
    expect(res2.status).toBe(200);
    expect(res2.headers.get("x-9router-cache")).toBe("idempotency");
    expect(await res2.text()).toBe("upstream-result");
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1); // not called again!
  });

  it("rejects with 422 when Idempotency-Key is reused with different body", async () => {
    const req1 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "test-key-diff" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "prompt 1" }] }),
    });

    const res1 = await handleChat(req1);
    expect(res1.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));

    const req2 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "test-key-diff" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "prompt 2 DIFFERENT" }] }),
    });

    const res2 = await handleChat(req2);
    expect(res2.status).toBe(422);
  });

  it("replays response when semanticCacheEnabled is true and body is identical", async () => {
    mocks.getSettings.mockResolvedValue({
      semanticCacheEnabled: true,
    });

    const makeReq = () =>
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "semantic query" }] }),
      });

    // 1st request -> upstream
    const res1 = await handleChat(makeReq());
    expect(res1.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));

    // 2nd request -> semantic cache hit!
    const res2 = await handleChat(makeReq());
    expect(res2.status).toBe(200);
    expect(res2.headers.get("x-9router-cache")).toBe("semantic");
    expect(await res2.text()).toBe("upstream-result");
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1); // saved upstream call!
  });
});
