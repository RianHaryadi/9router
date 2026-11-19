/**
 * Unit tests for src/sse/handlers/embeddings.js
 *
 * This file used to target cloud/src/handlers/embeddings.js, but the cloud/
 * worker tree was removed upstream (commit 58788a0d). The test is rewritten
 * against the handler that actually ships: src/sse/handlers/embeddings.js.
 *
 * Tests cover:
 *  - Body validation: invalid JSON → 400, missing model → 400, missing input → 400
 *  - Invalid model format → 400
 *  - Auth: requireApiKey on, missing key → 401, invalid key → 401
 *  - Happy path → delegates to handleEmbeddingsCore and returns the response
 *  - Fallback: no credentials → 400, account unavailable → cycles to the next
 *
 * Strategy: mock all external dependencies so the tests run without a
 * database or a provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  enforceKeyAccessResolved: vi.fn(),
  getKeyAccessContext: vi.fn(),
  handleEmbeddingsCore: vi.fn(),
  saveRequestUsage: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  // The key is read from the request, so the mock has to look at the header
  // rather than always answering.
  extractApiKey: (request) => {
    const header = request.headers.get("Authorization");
    if (!header) return null;
    return header.replace(/^Bearer\s+/i, "");
  },
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("../../src/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: mocks.getKeyAccessContext,
  enforceKeyAccessResolved: mocks.enforceKeyAccessResolved,
}));

vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({
  handleEmbeddingsCore: mocks.handleEmbeddingsCore,
}));

vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), warn: vi.fn(),
  error: vi.fn(), info: vi.fn(), maskKey: vi.fn(),
}));

import { handleEmbeddings } from "../../src/sse/handlers/embeddings.js";

const VALID_EMBEDDING_RESPONSE_BODY = {
  object: "list",
  data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
  model: "text-embedding-ada-002",
  usage: { prompt_tokens: 3, total_tokens: 3 },
};

/** Make a Request object */
function makeRequest(body = null, authHeader = "Bearer client-key") {
  const headers = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;

  return new Request("https://9cli.hxd.app/v1/embeddings", {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function okResponse() {
  return {
    success: true,
    usage: { prompt_tokens: 3, total_tokens: 3 },
    response: new Response(JSON.stringify(VALID_EMBEDDING_RESPONSE_BODY), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.getKeyAccessContext.mockResolvedValue(null);
  mocks.enforceKeyAccessResolved.mockResolvedValue(null);
  mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
  mocks.getProviderCredentials.mockResolvedValue({
    apiKey: "provider-secret",
    connectionId: "connection-a",
    connectionName: "Provider A",
  });
  mocks.clearAccountError.mockResolvedValue(undefined);
  mocks.handleEmbeddingsCore.mockResolvedValue(okResponse());
  mocks.saveRequestUsage.mockResolvedValue(undefined);
});

// ─── Tests: Body validation ───────────────────────────────────────────────────

describe("handleEmbeddings — body validation", () => {
  it("invalid JSON body → 400", async () => {
    const req = new Request("https://9cli.hxd.app/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ bad json",
    });
    const res = await handleEmbeddings(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/invalid json/i);
  });

  it("missing model field → 400", async () => {
    const res = await handleEmbeddings(makeRequest({ input: "hello world" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/missing model/i);
  });

  it("missing input field → 400", async () => {
    const res = await handleEmbeddings(makeRequest({ model: "ag/gemini-embedding-001" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/missing required field: input/i);
  });

  it("model with no provider mapping → 400", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: null, model: null });

    const res = await handleEmbeddings(makeRequest({ model: "nonexistent/model", input: "hello" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/invalid model format/i);
  });
});

// ─── Tests: Authentication ────────────────────────────────────────────────────

describe("handleEmbeddings — authentication", () => {
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
  });

  it("missing API key → 401", async () => {
    const res = await handleEmbeddings(makeRequest({ model: "openai/text-embedding-ada-002", input: "hello" }, null));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toMatch(/missing api key/i);
  });

  it("invalid API key → 401", async () => {
    mocks.isValidApiKey.mockResolvedValue(false);

    const res = await handleEmbeddings(makeRequest({ model: "openai/text-embedding-ada-002", input: "hello" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toMatch(/invalid api key/i);
  });
});

// ─── Tests: Valid request (happy path) ───────────────────────────────────────

describe("handleEmbeddings — valid request (happy path)", () => {
  it("single string input → 200 with embeddings data", async () => {
    const res = await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: "Hello world test embedding",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("array input → 200 with embeddings data", async () => {
    const res = await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: ["Hello", "World"],
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
  });

  it("delegates to handleEmbeddingsCore with the resolved provider/model", async () => {
    await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: "Test",
    }));

    expect(mocks.handleEmbeddingsCore).toHaveBeenCalledOnce();
    const callArgs = mocks.handleEmbeddingsCore.mock.calls[0][0];
    expect(callArgs.body.input).toBe("Test");
    expect(callArgs.modelInfo.provider).toBe("openai");
    expect(callArgs.modelInfo.model).toBe("text-embedding-ada-002");
    expect(callArgs.credentials).toBeDefined();
  });

  it("records the request usage for a successful call", async () => {
    await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: "Hello",
    }));

    expect(mocks.saveRequestUsage).toHaveBeenCalledOnce();
    const usage = mocks.saveRequestUsage.mock.calls[0][0];
    expect(usage.provider).toBe("openai");
    expect(usage.model).toBe("text-embedding-ada-002");
    expect(usage.status).toBe("success");
  });
});

// ─── Tests: Credential fallback ───────────────────────────────────────────────

describe("handleEmbeddings — credential fallback", () => {
  it("no credentials at all → 400", async () => {
    mocks.getProviderCredentials.mockResolvedValue(null);

    const res = await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: "hello",
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/no credentials/i);
  });

  it("a non-fallback error from the core is returned directly", async () => {
    mocks.handleEmbeddingsCore.mockResolvedValue({
      success: false,
      status: 400,
      error: "input must be a string or array",
      response: new Response(
        JSON.stringify({ error: { message: "input must be a string or array" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });

    const res = await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: "hello",
    }));

    expect(res.status).toBe(400);
    expect(mocks.getProviderCredentials).toHaveBeenCalledOnce();
  });

  it("a fallback error cycles to the next account", async () => {
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    mocks.getProviderCredentials
      .mockResolvedValueOnce({
        apiKey: "provider-secret",
        connectionId: "connection-a",
        connectionName: "Provider A",
      })
      .mockResolvedValueOnce({
        apiKey: "provider-secret-2",
        connectionId: "connection-b",
        connectionName: "Provider B",
      });
    mocks.handleEmbeddingsCore
      .mockResolvedValueOnce({
        success: false,
        status: 429,
        error: "Rate limit exceeded",
        response: new Response("{}", { status: 429 }),
      })
      .mockResolvedValueOnce(okResponse());

    const res = await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: "hello",
    }));

    expect(res.status).toBe(200);
    expect(mocks.markAccountUnavailable).toHaveBeenCalled();
    // The failed account is excluded from the next round.
    const excludeIds = mocks.getProviderCredentials.mock.calls[1][1];
    expect([...excludeIds]).toContain("connection-a");
  });

  it("all accounts rate limited → the unavailable status with Retry-After", async () => {
    mocks.getProviderCredentials.mockResolvedValue({
      allRateLimited: true,
      lastError: "Rate limit exceeded",
      lastErrorCode: 429,
      retryAfter: 60,
      retryAfterHuman: "60s",
    });

    const res = await handleEmbeddings(makeRequest({
      model: "openai/text-embedding-ada-002",
      input: "hello",
    }));

    expect([429, 503]).toContain(res.status);
    expect(res.headers.get("Retry-After")).toBeDefined();
  });
});
