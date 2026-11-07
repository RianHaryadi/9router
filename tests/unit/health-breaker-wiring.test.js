// Wiring contract for the health breaker: auth.js `getProviderCredentials`
// partitions candidates through `filterByHealth` and must never let the
// breaker empty the pool (state.md "Keputusan desain" #4 — breaker is
// informational, not a deadlock), and chat.js calls recordSuccess/
// recordFailure. auth.js itself pulls in the local DB, so the wiring logic
// is asserted against the pure helper exported by healthBreaker.js.
import { beforeEach, describe, expect, it } from "vitest";
import {
  HEALTH_BREAKER_CONFIG,
  filterByHealth,
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

// Mirror of the two-stage filter in auth.js getProviderCredentials.
function selectConnections(baseAvailable) {
  const { healthy, blocked } = filterByHealth(baseAvailable, PROVIDER, MODEL);
  return {
    healthy,
    blocked,
    available: healthy.length > 0 ? healthy : baseAvailable,
  };
}

const failConn = (connectionId) =>
  recordFailure({ connectionId, provider: PROVIDER, model: MODEL, status: 429, errorText: "rate limit" });

beforeEach(() => {
  resetAll();
});

describe("healthBreaker — API surface expected by auth.js/chat.js", () => {
  it("exports every symbol the wiring imports", () => {
    expect(typeof recordSuccess).toBe("function");
    expect(typeof recordFailure).toBe("function");
    expect(typeof getState).toBe("function");
    expect(typeof isOpen).toBe("function");
    expect(typeof isBlockedFor).toBe("function");
    expect(typeof listBlocked).toBe("function");
    expect(typeof getSnapshot).toBe("function");
    expect(typeof resetBreaker).toBe("function");
    expect(typeof resetAll).toBe("function");
    expect(typeof filterByHealth).toBe("function");
    expect(HEALTH_BREAKER_CONFIG.openAfter).toBe(3);
  });

  it("is synchronous and side-effect free on read", () => {
    expect(() => isOpen({ connectionId: "x", provider: PROVIDER, model: MODEL })).not.toThrow();
    expect(() => getState({ connectionId: "x", provider: PROVIDER, model: MODEL })).not.toThrow();
    expect(() => listBlocked()).not.toThrow();
    expect(() => getSnapshot()).not.toThrow();
  });
});

describe("healthBreaker — filterByHealth (auth.js wiring)", () => {
  it("splits connections into healthy and breaker-blocked", () => {
    const connections = [{ id: "conn-a" }, { id: "conn-b" }];
    failConn("conn-a");
    failConn("conn-a");
    failConn("conn-a");
    expect(isOpen({ connectionId: "conn-a", provider: PROVIDER, model: MODEL })).toBe(true);

    const { healthy, blocked } = filterByHealth(connections, PROVIDER, MODEL);

    expect(blocked.map((c) => c.id)).toEqual(["conn-a"]);
    expect(healthy.map((c) => c.id)).toEqual(["conn-b"]);
  });

  it("keeps a healthy connection selectable while another one is open", () => {
    const connections = [{ id: "conn-a" }, { id: "conn-b" }];
    failConn("conn-a");
    failConn("conn-a");
    failConn("conn-a");

    const { available } = selectConnections(connections);

    expect(available.map((c) => c.id)).toEqual(["conn-b"]);
  });

  it("falls back to the pre-breaker list when every connection is blocked (no deadlock)", () => {
    const connections = [{ id: "conn-a" }, { id: "conn-b" }];
    for (const c of connections) {
      failConn(c.id);
      failConn(c.id);
      failConn(c.id);
    }

    const { healthy, blocked, available } = selectConnections(connections);

    expect(healthy).toEqual([]); // all breaker-blocked…
    expect(blocked).toHaveLength(2); // …and that is visible…
    expect(available).toBe(connections); // …but selection still has candidates
    expect(available).toHaveLength(2);
  });

  it("returns everything healthy when no breaker has fired", () => {
    const connections = [{ id: "conn-a" }, { id: "conn-b" }];
    const { healthy, blocked, available } = selectConnections(connections);

    expect(blocked).toEqual([]);
    expect(healthy).toEqual(connections);
    expect(available).toEqual(connections);
  });

  it("ignores breaker state for other models", () => {
    const connections = [{ id: "conn-a" }];
    failConn("conn-a");
    failConn("conn-a");
    failConn("conn-a");

    const { healthy, blocked } = filterByHealth(connections, PROVIDER, "other-model");

    expect(blocked).toEqual([]);
    expect(healthy).toEqual(connections);
  });

  it("treats a closed breaker after success as healthy again (chat.js success hook)", () => {
    const connections = [{ id: "conn-a" }, { id: "conn-b" }];
    failConn("conn-a");
    failConn("conn-a");
    failConn("conn-a");
    expect(selectConnections(connections).available.map((c) => c.id)).toEqual(["conn-b"]);

    // chat.js onRequestSuccess → recordSuccess closes the breaker again.
    recordSuccess({ connectionId: "conn-a", provider: PROVIDER, model: MODEL });

    const { healthy, blocked } = selectConnections(connections);
    expect(blocked).toEqual([]);
    expect(healthy).toEqual(connections);
    expect(getState({ connectionId: "conn-a", provider: PROVIDER, model: MODEL }).consecutiveFailures).toBe(0);
  });
});
