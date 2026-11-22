import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fork (T4b): provider failures must be classified before an account is
// locked in the DB. The Qoder model-queue signal (code 10605) means "this
// model is busy", not "these accounts are broken" — locking every account in
// turn is what made the qoder fleet unusable while its credit was untouched.

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const QODER_QUEUE = JSON.stringify({
  code: "10605",
  message: JSON.stringify({
    isQueued: true,
    modelKey: "mmodel",
    queueCount: 0,
    queueType: "p4",
    retryAfterSeconds: 30,
    serviceAvailable: false,
    subCode: "RESOURCE_LIMIT",
    waitTime: 30,
  }),
});

const QODER_DAILY_LIMIT = JSON.stringify({
  code: "10605",
  message: JSON.stringify({
    isQueued: true,
    modelKey: "mmodel",
    queueCount: 454,
    queueType: "p2",
    serviceAvailable: true,
    subCode: "CALL_COUNT_LIMIT",
    waitTime: 367,
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T00:00:00.000Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.getProviderConnections.mockResolvedValue([{ id: "acct-1", backoffLevel: 0 }]);
  db.updateProviderConnection.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lockedModelKeys = () =>
  db.updateProviderConnection.mock.calls
    .flatMap(([, patch]) => Object.keys(patch || {}))
    .filter((k) => k.startsWith("modelLock_"));

describe("T4b — error taxonomy gates the DB account lock", () => {
  it("does NOT lock the account when the model is merely queued (Qoder 10605)", async () => {
    const result = await markAccountUnavailable("acct-1", 503, QODER_QUEUE, "qoder", "mmodel");

    // Fall back to the next account in the same request...
    expect(result.shouldFallback).toBe(true);
    // ...but never write a lock, so the healthy account stays in rotation.
    expect(result.cooldownMs).toBe(0);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not lock nor mark the account unavailable for a local model_config bug", async () => {
    const result = await markAccountUnavailable(
      "acct-1",
      400,
      'qoder: model_config for "smodel" not yet known (run a model list fetch)',
      "qoder",
      "smodel",
    );

    expect(result.shouldFallback).toBe(false);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("locks the model for a long window on a daily-count limit", async () => {
    const result = await markAccountUnavailable("acct-1", 503, QODER_DAILY_LIMIT, "qoder", "mmodel");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(30 * 60_000);
    expect(lockedModelKeys()).toEqual(["modelLock_mmodel"]);
  });

  it("locks the account for a billing block and keeps upstream's testStatus behaviour", async () => {
    const result = await markAccountUnavailable(
      "acct-1",
      402,
      '{"error":{"code":"billing_not_configured","message":"Billing verification failed"}}',
      "muse",
      "muse-spark-1.3",
    );

    expect(result.shouldFallback).toBe(true);
    // The duration stays upstream's (a 402 is provider-aware upstream); the
    // taxonomy only decides the blast radius, which here is the account.
    expect(result.cooldownMs).toBe(2 * 60_000);
    expect(db.updateProviderConnection).toHaveBeenCalledWith("acct-1", expect.objectContaining({
      testStatus: "unavailable",
      errorCode: 402,
    }));
    expect(lockedModelKeys()).toEqual(["modelLock_muse-spark-1.3"]);
  });

  it("locks the account on 401 auth failures", async () => {
    const result = await markAccountUnavailable("acct-1", 401, "invalid_api_key", "qoder", "mmodel");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(2 * 60_000);
    expect(lockedModelKeys()).toEqual(["modelLock_mmodel"]);
  });

  it("keeps upstream behaviour for a plain 404 (model missing)", async () => {
    const result = await markAccountUnavailable(
      "acct-1",
      404,
      '{"code":404,"message":"Requested entity was not found."}',
      "antigravity",
      "gemini-3-pro",
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(2 * 60_000);
    expect(lockedModelKeys()).toEqual(["modelLock_gemini-3-pro"]);
  });

  it("keeps upstream behaviour for 429 rate limits (escalating backoff)", async () => {
    const result = await markAccountUnavailable("acct-1", 429, "rate limit exceeded", "openai", "gpt-5.6");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(2000);
    expect(db.updateProviderConnection).toHaveBeenCalledWith("acct-1", expect.objectContaining({
      backoffLevel: 1,
    }));
  });

  it("keeps upstream behaviour for a 503 without queue markers", async () => {
    const result = await markAccountUnavailable("acct-1", 503, "upstream boom", "openai", "gpt-5.6");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(30_000);
    expect(lockedModelKeys()).toEqual(["modelLock_gpt-5.6"]);
  });

  it("keeps upstream behaviour for an unknown 4xx (request-scoped, no lock)", async () => {
    // Upstream treats a 4xx that is not 401/402/403/429 as request-scoped:
    // the request was bad, the credential is fine, so no fallback and no lock.
    const result = await markAccountUnavailable("acct-1", 418, "teapot", "openai", "gpt-5.6");

    expect(result.shouldFallback).toBe(false);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("treats a capacity message as a queue and does not lock the account", async () => {
    const result = await markAccountUnavailable("acct-1", 200, "model at capacity", "openai", "gpt-5.6");

    expect(result.shouldFallback).toBe(true);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("never locks when there is no connection id", async () => {
    const result = await markAccountUnavailable(null, 503, QODER_QUEUE, "qoder", "mmodel");

    expect(result.shouldFallback).toBe(false);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });
});
