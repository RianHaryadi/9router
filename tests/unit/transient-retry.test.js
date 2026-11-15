import { describe, expect, it, vi } from "vitest";
import {
  executeWithRetry,
  isTransientError,
  retryDelayMs,
} from "../../src/custom/guard/transientRetry.js";

describe("isTransientError", () => {
  it("classifies transport failures as retryable", () => {
    expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientError({ message: "fetch failed", cause: { code: "UND_ERR_SOCKET" } })).toBe(true);
    expect(isTransientError({ name: "TimeoutError" })).toBe(true);
    expect(isTransientError(new Error("socket hang up"))).toBe(true);
  });

  it("never retries an abort or a real application error", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isTransientError(abort)).toBe(false);
    expect(isTransientError({ code: "ENOTFOUND" })).toBe(false);
    expect(isTransientError(new Error("invalid model"))).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially and caps at the ceiling", () => {
    expect(retryDelayMs(1, { baseMs: 100 })).toBe(100);
    expect(retryDelayMs(2, { baseMs: 100 })).toBe(200);
    expect(retryDelayMs(3, { baseMs: 100 })).toBe(400);
    expect(retryDelayMs(9, { baseMs: 100, maxMs: 500 })).toBe(500);
  });
});

describe("executeWithRetry", () => {
  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    expect(await executeWithRetry(fn, { retries: 3, baseMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
      return "recovered";
    });
    const seen = [];
    expect(await executeWithRetry(fn, { retries: 3, baseMs: 1, onRetry: (info) => seen.push(info.attempt) })).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([1, 2]);
  });

  it("rethrows a non-transient error immediately", async () => {
    const fn = vi.fn(async () => { throw new Error("bad request"); });
    await expect(executeWithRetry(fn, { retries: 3, baseMs: 1 })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured number of attempts", async () => {
    const fn = vi.fn(async () => { throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }); });
    await expect(executeWithRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops retrying once the signal is aborted", async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
    });
    await expect(executeWithRetry(fn, { retries: 3, baseMs: 1, signal: controller.signal })).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
