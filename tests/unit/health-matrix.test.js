import { describe, it, expect } from "vitest";
import {
  buildMatrix,
  pickBestAccount,
  preflight,
  summaryByProvider,
} from "../../src/custom/guard/healthMatrix.js";

const NOW = 1_800_000_000_000;

function entry(overrides = {}) {
  return {
    connectionId: "conn-a",
    provider: "qoder",
    model: "mmodel",
    state: "closed",
    blockedUntil: null,
    consecutiveFailures: 0,
    lastError: null,
    lastStatus: null,
    lastFailureKind: null,
    lastFailureScope: null,
    lastFailureAction: null,
    needsHuman: false,
    needsHumanSince: null,
    cooldownMs: 0,
    avgLatencyMs: null,
    probesRemaining: 0,
    ...overrides,
  };
}

const snapshot = (entries) => ({ tracked: entries.length, open: 0, halfOpen: 0, entries });

describe("T5 health matrix", () => {
  it("maps every account row with its state and taxonomy fields", () => {
    const matrix = buildMatrix(
      snapshot([
        entry({ connectionId: "a", state: "closed" }),
        entry({ connectionId: "b", state: "open", blockedUntil: NOW + 60_000, consecutiveFailures: 3, lastFailureKind: "queue" }),
      ]),
      { now: NOW }
    );

    expect(matrix.accounts).toHaveLength(2);
    expect(matrix.accounts[0]).toMatchObject({
      connectionId: "a",
      state: "closed",
      healthy: true,
      blocked: false,
    });
    expect(matrix.accounts[1]).toMatchObject({
      connectionId: "b",
      state: "open",
      healthy: false,
      blocked: true,
      lastFailureKind: "queue",
      consecutiveFailures: 3,
    });
  });

  it("summarises healthy/open/halfOpen/needsHuman and counts failure kinds", () => {
    const matrix = buildMatrix(
      snapshot([
        entry({ connectionId: "a" }),
        entry({ connectionId: "b", state: "open", blockedUntil: NOW + 1000, lastFailureKind: "billing" }),
        entry({ connectionId: "c", needsHuman: true, lastFailureKind: "billing" }),
      ]),
      { now: NOW }
    );

    expect(matrix.summary).toMatchObject({ total: 3, healthy: 1, open: 1, needsHuman: 1 });
    expect(matrix.summary.byKind.billing).toBe(2);
  });

  it("filters by provider and by model", () => {
    const snap = snapshot([
      entry({ connectionId: "a", provider: "qoder", model: "mmodel" }),
      entry({ connectionId: "b", provider: "qoder", model: "smodel" }),
      entry({ connectionId: "c", provider: "muse", model: "muse-spark-1.3" }),
    ]);

    expect(buildMatrix(snap, { now: NOW, provider: "qoder" }).accounts.map((r) => r.connectionId)).toEqual(["a", "b"]);
    expect(buildMatrix(snap, { now: NOW, model: "smodel" }).accounts.map((r) => r.connectionId)).toEqual(["b"]);
    expect(buildMatrix(snap, { now: NOW, provider: "qoder", model: "mmodel" }).accounts.map((r) => r.connectionId)).toEqual(["a"]);
  });

  it("treats the provider|model aggregate as a model verdict, not as an account", () => {
    const matrix = buildMatrix(
      snapshot([
        entry({ connectionId: null, aggregate: true, provider: "qoder", model: "mmodel", state: "open", blockedUntil: NOW + 60_000 }),
        entry({ connectionId: "a" }),
      ]),
      { now: NOW }
    );

    expect(matrix.accounts).toHaveLength(1);
    expect(matrix.aggregates).toHaveLength(1);
    // The model is blocked for every account, so it is not usable even though
    // one account row is still closed.
    expect(matrix.recommendation.usable).toBe(false);
  });

  it("picks a healthy account before a half-open one and an open one", () => {
    const matrix = buildMatrix(
      snapshot([
        entry({ connectionId: "open", state: "open", blockedUntil: NOW + 60_000 }),
        entry({ connectionId: "half", state: "half-open", probesRemaining: 1 }),
        entry({ connectionId: "closed" }),
      ]),
      { now: NOW }
    );

    expect(pickBestAccount(matrix, { now: NOW }).connectionId).toBe("closed");
  });

  it("prefers the account with fewer failures, then the lower latency", () => {
    const matrix = buildMatrix(
      snapshot([
        entry({ connectionId: "slow", consecutiveFailures: 0, avgLatencyMs: 5000 }),
        entry({ connectionId: "fast", consecutiveFailures: 0, avgLatencyMs: 100 }),
        entry({ connectionId: "broken", consecutiveFailures: 4 }),
      ]),
      { now: NOW }
    );

    expect(pickBestAccount(matrix, { now: NOW }).connectionId).toBe("fast");
  });

  it("returns null when nothing is available", () => {
    const matrix = buildMatrix(
      snapshot([entry({ connectionId: "a", state: "open", blockedUntil: NOW + 60_000 })]),
      { now: NOW }
    );

    const best = pickBestAccount(matrix, { now: NOW });
    expect(best.connectionId).toBeNull();
    expect(best.degraded).toBe(true);
  });

  it("preflight passes when a healthy account exists", () => {
    const matrix = buildMatrix(snapshot([entry({ connectionId: "a" })]), { now: NOW });
    const pre = preflight(matrix, { now: NOW, model: "mmodel" });

    expect(pre.ok).toBe(true);
    expect(pre.degraded).toBe(false);
    expect(pre.connectionId).toBe("a");
  });

  it("preflight reports degraded when only unhealthy accounts remain", () => {
    const matrix = buildMatrix(
      snapshot([
        entry({ connectionId: "a", state: "open", blockedUntil: NOW + 60_000 }),
        entry({ connectionId: "b", needsHuman: true }),
      ]),
      { now: NOW }
    );

    const pre = preflight(matrix, { now: NOW });
    expect(pre.degraded).toBe(true);
  });

  it("preflight fails when every account is blocked", () => {
    const matrix = buildMatrix(
      snapshot([entry({ connectionId: "a", state: "open", blockedUntil: NOW + 60_000 })]),
      { now: NOW }
    );

    const pre = preflight(matrix, { now: NOW });
    expect(pre.ok).toBe(false);
    expect(pre.connectionId).toBeNull();
  });

  it("an account needing a human is not healthy even when closed", () => {
    const matrix = buildMatrix(snapshot([entry({ connectionId: "a", needsHuman: true })]), { now: NOW });

    expect(matrix.accounts[0].healthy).toBe(false);
    expect(matrix.recommendation.usable).toBe(false);
    expect(matrix.recommendation.reason).toMatch(/human/i);
  });

  it("an expired lock is not blocking any more", () => {
    const matrix = buildMatrix(
      snapshot([entry({ connectionId: "a", state: "open", blockedUntil: NOW - 1 })]),
      { now: NOW }
    );

    expect(matrix.accounts[0].blocked).toBe(false);
  });

  it("summarises per provider for the dashboard", () => {
    const matrix = buildMatrix(
      snapshot([
        entry({ connectionId: "a", provider: "qoder", model: "mmodel" }),
        entry({ connectionId: "b", provider: "qoder", model: "smodel" }),
        entry({ connectionId: "c", provider: "muse", model: "muse-spark-1.3" }),
      ]),
      { now: NOW }
    );

    const providers = summaryByProvider(matrix);
    expect(providers).toHaveLength(2);
    const qoder = providers.find((p) => p.provider === "qoder");
    expect(qoder).toMatchObject({ total: 2, healthy: 2 });
    expect(qoder.models).toEqual(["mmodel", "smodel"]);
  });

  it("is deterministic for the same snapshot and clock", () => {
    const snap = snapshot([entry({ connectionId: "a" }), entry({ connectionId: "b", state: "open", blockedUntil: NOW + 5 })]);
    const a = buildMatrix(snap, { now: NOW });
    const b = buildMatrix(snap, { now: NOW });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(pickBestAccount(a, { now: NOW })).toEqual(pickBestAccount(b, { now: NOW }));
  });

  it("handles an empty snapshot without throwing", () => {
    const matrix = buildMatrix(snapshot([]), { now: NOW });
    expect(matrix.accounts).toEqual([]);
    expect(matrix.recommendation.usable).toBe(false);
  });
});
