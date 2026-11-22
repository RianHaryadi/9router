// Health circuit breaker (state.md "Keputusan desain" #3): in-memory
// closed → open → half-open state machine per connection+model with a
// provider+model aggregate level. Request-scoped errors (400 context
// overflow etc) must never count as failures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEALTH_BREAKER_CONFIG,
  getSnapshot,
  getState,
  isBlockedFor,
  isOpen,
  listBlocked,
  recordFailure,
  recordSuccess,
  resetAll,
  resetBreaker,
} from "../../src/sse/services/healthBreaker.js";

const PROVIDER = "openai";
const MODEL = "gpt-5";
const CONN = "conn-alpha";

const stateParams = { connectionId: CONN, provider: PROVIDER, model: MODEL };
const aggParams = { connectionId: null, provider: PROVIDER, model: MODEL };

const fail = (overrides = {}) =>
  recordFailure({
    connectionId: CONN,
    provider: PROVIDER,
    model: MODEL,
    status: 500,
    errorText: "upstream exploded",
    ...overrides,
  });

beforeEach(() => {
  resetAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("healthBreaker — config", () => {
  it("exposes the contract from state.md", () => {
    expect(HEALTH_BREAKER_CONFIG).toEqual({
      openAfter: 3,
      baseCooldownMs: 60_000,
      maxCooldownMs: 15 * 60_000,
      cooldownMultiplier: 2,
      halfOpenProbes: 1,
      windowMs: 10 * 60_000,
    });
  });
});

describe("healthBreaker — closed → open", () => {
  it("stays closed after 2 consecutive failures (openAfter = 3)", () => {
    fail();
    fail();

    const state = getState(stateParams);
    expect(state.state).toBe("closed");
    expect(state.consecutiveFailures).toBe(2);
    expect(state.blockedUntil).toBeNull();
    expect(isOpen(stateParams)).toBe(false);
    expect(isBlockedFor(stateParams)).toBe(false);
  });

  it("opens on the 3rd consecutive failure with a future blockedUntil", () => {
    const now = Date.now();
    fail();
    fail();
    fail();

    const state = getState(stateParams);
    expect(state.state).toBe("open");
    expect(state.consecutiveFailures).toBe(3);
    expect(state.blockedUntil).toBeGreaterThan(now);
    expect(state.blockedUntil).toBeLessThanOrEqual(now + HEALTH_BREAKER_CONFIG.baseCooldownMs + 50);
    expect(state.cooldownMs).toBe(HEALTH_BREAKER_CONFIG.baseCooldownMs);
    expect(state.lastStatus).toBe(500);
    expect(state.lastError).toBe("upstream exploded");
    expect(isOpen(stateParams)).toBe(true);
    expect(isBlockedFor(stateParams)).toBe(true);
  });

  it("escalates the cooldown exponentially and caps it at maxCooldownMs", () => {
    fail();
    fail();
    fail(); // open, 60s
    fail(); // 4th failure → 120s
    fail(); // 5th → 240s
    fail(); // 6th → 480s
    fail(); // 7th → 960s → capped at 15min

    const state = getState(stateParams);
    expect(state.state).toBe("open");
    expect(state.consecutiveFailures).toBe(7);
    expect(state.cooldownMs).toBe(HEALTH_BREAKER_CONFIG.maxCooldownMs);
    expect(state.blockedUntil).toBeGreaterThan(Date.now() + HEALTH_BREAKER_CONFIG.maxCooldownMs - 100);
  });
});

describe("healthBreaker — request-scoped failures", () => {
  it("does not increment the counter when requestScoped is true", () => {
    const snapshot = fail({ requestScoped: true, status: 400, errorText: "maximum context length" });

    expect(snapshot).toEqual({
      state: "closed",
      blockedUntil: null,
      consecutiveFailures: 0,
    });
    expect(getState(stateParams).consecutiveFailures).toBe(0);
    expect(isOpen(stateParams)).toBe(false);
  });

  it("mixes request-scoped and account-scoped failures without counting the former", () => {
    fail({ status: 400, errorText: "invalid request", requestScoped: true });
    fail();
    fail({ status: 400, errorText: "invalid request", requestScoped: true });
    fail();

    expect(getState(stateParams).consecutiveFailures).toBe(2);
    expect(isOpen(stateParams)).toBe(false);

    fail();
    expect(getState(stateParams).state).toBe("open");
  });
});

describe("healthBreaker — success closes the breaker", () => {
  it("recordSuccess resets an open breaker to closed", () => {
    fail();
    fail();
    fail();
    expect(isOpen(stateParams)).toBe(true);

    const snapshot = recordSuccess({ ...stateParams, latencyMs: 1_200 });

    expect(snapshot.state).toBe("closed");
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.blockedUntil).toBeNull();
    expect(snapshot.avgLatencyMs).toBe(1_200);
    expect(isOpen(stateParams)).toBe(false);
    expect(isBlockedFor(stateParams)).toBe(false);
  });

  it("keeps a simple EWMA of latency across successes", () => {
    recordSuccess({ ...stateParams, latencyMs: 1_000 });
    recordSuccess({ ...stateParams, latencyMs: 2_000 });

    expect(getState(stateParams).avgLatencyMs).toBe(1_500);
  });
});

describe("healthBreaker — half-open probing", () => {
  it("moves open → half-open once blockedUntil passes, admits one probe", () => {
    const t0 = Date.parse("2026-01-01T00:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0);

    fail();
    fail();
    fail();
    expect(getState(stateParams).blockedUntil).toBe(t0 + HEALTH_BREAKER_CONFIG.baseCooldownMs);
    expect(isOpen(stateParams)).toBe(true);

    nowSpy.mockReturnValue(t0 + HEALTH_BREAKER_CONFIG.baseCooldownMs + 1);

    const state = getState(stateParams);
    expect(state.state).toBe("half-open");
    expect(state.blockedUntil).toBeNull();
    expect(isOpen(stateParams)).toBe(false);
    expect(isBlockedFor(stateParams)).toBe(false); // probe window open
    expect(state.probesRemaining).toBe(HEALTH_BREAKER_CONFIG.halfOpenProbes);

    // A failed probe consumes the only probe and re-opens with ×2 cooldown.
    fail();
    const reopened = getState(stateParams);
    expect(reopened.state).toBe("open");
    expect(reopened.consecutiveFailures).toBe(4);
    expect(reopened.blockedUntil).toBe(
      t0 + HEALTH_BREAKER_CONFIG.baseCooldownMs + 1 + HEALTH_BREAKER_CONFIG.baseCooldownMs * 2
    );
    expect(isBlockedFor(stateParams)).toBe(true);

    // Success from the half-open state closes it again.
    nowSpy.mockReturnValue(t0 + HEALTH_BREAKER_CONFIG.baseCooldownMs + 1 + 120_000 + 1);
    expect(getState(stateParams).state).toBe("half-open");
    recordSuccess(stateParams);
    expect(getState(stateParams).state).toBe("closed");
    expect(getState(stateParams).consecutiveFailures).toBe(0);
  });
});

describe("healthBreaker — provider+model aggregate", () => {
  it("counts the aggregate alongside connection-level failures", () => {
    fail();
    fail();
    fail();

    const agg = getState(aggParams);
    expect(agg.state).toBe("open");
    expect(agg.consecutiveFailures).toBe(3);
    expect(isOpen({ connectionId: "noauth", provider: PROVIDER, model: MODEL })).toBe(true);
    expect(isBlockedFor({ connectionId: null, provider: PROVIDER, model: MODEL })).toBe(true);

    const blocked = listBlocked();
    const aggEntry = blocked.find((e) => e.connectionId === null && e.provider === PROVIDER);
    expect(aggEntry).toBeTruthy();
    expect(aggEntry.state).toBe("open");
    expect(aggEntry.model).toBe(MODEL);
  });

  it("does not block a healthy sibling connection when only another one opened", () => {
    fail();
    fail();
    fail();

    // The aggregate is informational for regular connections: gating siblings
    // on it would empty the healthy set and defeat connection-level filtering.
    expect(isOpen({ connectionId: "conn-beta", provider: PROVIDER, model: MODEL })).toBe(false);
    expect(isBlockedFor({ connectionId: "conn-beta", provider: PROVIDER, model: MODEL })).toBe(false);
  });

  it("treats noauth connections as provider-level only", () => {
    recordFailure({ connectionId: "noauth", provider: PROVIDER, model: MODEL, status: 429, errorText: "rate limit" });
    recordFailure({ connectionId: "noauth", provider: PROVIDER, model: MODEL, status: 429, errorText: "rate limit" });
    recordFailure({ connectionId: "noauth", provider: PROVIDER, model: MODEL, status: 429, errorText: "rate limit" });

    expect(isOpen({ connectionId: "noauth", provider: PROVIDER, model: MODEL })).toBe(true);
    expect(listBlocked().some((e) => e.connectionId === null)).toBe(true);
    // No connection-level entry was created for noauth.
    expect(getSnapshot().tracked).toBe(1);
  });
});

describe("healthBreaker — dumps", () => {
  it("getSnapshot reports tracked/open/halfOpen counts and entries", () => {
    expect(getSnapshot()).toEqual({ tracked: 0, open: 0, halfOpen: 0, entries: [] });

    fail();
    const closedSnap = getSnapshot();
    expect(closedSnap.tracked).toBe(2); // connection + aggregate
    expect(closedSnap.open).toBe(0);

    fail();
    fail();
    const openSnap = getSnapshot();
    expect(openSnap.tracked).toBe(2);
    expect(openSnap.open).toBe(2);
    expect(openSnap.halfOpen).toBe(0);
    expect(openSnap.entries.map((e) => e.state)).toEqual(["open", "open"]);
  });

  it("listBlocked only returns non-closed entries", () => {
    expect(listBlocked()).toEqual([]);
    fail();
    expect(listBlocked()).toEqual([]); // still closed after 1 failure

    fail();
    fail();
    expect(listBlocked()).toHaveLength(2); // connection + aggregate
    expect(listBlocked().every((e) => e.state === "open")).toBe(true);
  });
});

describe("healthBreaker — resets", () => {
  it("resetBreaker clears the connection pair (and its aggregate)", () => {
    fail();
    fail();
    fail();
    expect(isOpen(stateParams)).toBe(true);

    resetBreaker(stateParams);

    expect(getState(stateParams).state).toBe("closed");
    expect(getState(stateParams).consecutiveFailures).toBe(0);
    expect(isOpen(stateParams)).toBe(false);
    expect(isBlockedFor(stateParams)).toBe(false);
    expect(getState(aggParams).state).toBe("closed");
    expect(listBlocked()).toEqual([]);
  });

  it("resetAll clears every entry", () => {
    fail();
    fail();
    fail();
    recordFailure({ connectionId: "conn-beta", provider: PROVIDER, model: MODEL, status: 500, errorText: "boom" });

    resetAll();

    expect(getSnapshot()).toEqual({ tracked: 0, open: 0, halfOpen: 0, entries: [] });
    expect(listBlocked()).toEqual([]);
    expect(isOpen(stateParams)).toBe(false);
    expect(isOpen({ connectionId: "conn-beta", provider: PROVIDER, model: MODEL })).toBe(false);
    expect(isOpen({ connectionId: "noauth", provider: PROVIDER, model: MODEL })).toBe(false);
  });
});
