// T1 — schema v3 (observability) + new fallback/metrics repos.
// Static checks only: schema shape + importability. No DB runtime here (the
// adapter would touch the real data dir) — that's covered by other db tests.
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, TABLES } from "../../src/lib/db/schema.js";
import {
  saveFallbackEvent, getFallbackEvents, getFallbackSummary, pruneFallbackEvents,
} from "../../src/lib/db/repos/fallbackRepo.js";
import {
  getLatencyPercentiles, getSpendByProject, getProviderHealthSnapshot,
} from "../../src/lib/db/repos/metricsRepo.js";

describe("fork schema v4/v5 — observability + per-key budget + request identity", () => {
  it("bumps SCHEMA_VERSION to 12", () => {
    // v4 added apiKeys budget columns (budgetLimitCents/budgetPeriod/
    // budgetStartedAt/budgetSpentCents) for the per-key monthly budget feature
    // (Fase 2). v5 added usageHistory.requestId so a request that reports no
    // tokens can still be told apart from another one. v9 added
    // apiKeys.keyRef — the non-reversible fingerprint that usage rows store
    // instead of the raw key. v12 added the ownerId column on combos and
    // promptTemplates, so a teammate owns the rows they create. Version bumps
    // +1 every schema change per schema.js contract.
    expect(SCHEMA_VERSION).toBe(12);
  });

  it("adds latencyMs, ttftMs, projectName, fallbackCount to usageHistory", () => {
    const cols = TABLES.usageHistory.columns;
    expect(cols.latencyMs).toBe("INTEGER DEFAULT 0");
    expect(cols.ttftMs).toBe("INTEGER DEFAULT 0");
    expect(cols.projectName).toBe("TEXT");
    expect(cols.fallbackCount).toBe("INTEGER DEFAULT 0");
  });

  it("indexes usageHistory by projectName", () => {
    const idx = TABLES.usageHistory.indexes || [];
    expect(idx.some((s) => s.includes("idx_uh_project") && s.includes("usageHistory(projectName)"))).toBe(true);
  });
});

describe("fork schema v3 — fallbackEvents table", () => {
  const fe = TABLES.fallbackEvents;

  it("exists with the required primary columns", () => {
    expect(fe).toBeTruthy();
    expect(fe.columns.id).toBe("TEXT PRIMARY KEY");
    expect(fe.columns.timestamp).toBe("TEXT NOT NULL");
  });

  it("has every required column", () => {
    const required = [
      "id", "timestamp", "requestId", "provider", "model", "connectionId",
      "apiKey", "projectName", "fromProvider", "fromModel", "status",
      "reason", "cooldownMs", "latencyMs",
    ];
    for (const col of required) {
      expect(fe.columns[col], `missing column ${col}`).toBeTruthy();
    }
  });

  it("defines exactly the 3 expected indexes", () => {
    expect(fe.indexes).toHaveLength(3);
    expect(fe.indexes.some((s) => s.includes("idx_fe_ts") && s.includes("fallbackEvents(timestamp DESC)"))).toBe(true);
    expect(fe.indexes.some((s) => s.includes("idx_fe_provider") && s.includes("fallbackEvents(provider)"))).toBe(true);
    expect(fe.indexes.some((s) => s.includes("idx_fe_request") && s.includes("fallbackEvents(requestId)"))).toBe(true);
  });
});

describe("fork schema v3 — new repos are importable", () => {
  it("exports the fallbackRepo functions", () => {
    expect(typeof saveFallbackEvent).toBe("function");
    expect(typeof getFallbackEvents).toBe("function");
    expect(typeof getFallbackSummary).toBe("function");
    expect(typeof pruneFallbackEvents).toBe("function");
  });

  it("exports the metricsRepo functions", () => {
    expect(typeof getLatencyPercentiles).toBe("function");
    expect(typeof getSpendByProject).toBe("function");
    expect(typeof getProviderHealthSnapshot).toBe("function");
  });

  it("re-exports both repos from the db barrel (src/lib/db/index.js)", async () => {
    const db = await import("../../src/lib/db/index.js");
    for (const name of [
      "saveFallbackEvent", "getFallbackEvents", "getFallbackSummary", "pruneFallbackEvents",
      "getLatencyPercentiles", "getSpendByProject", "getProviderHealthSnapshot",
    ]) {
      expect(typeof db[name], `${name} missing from db/index.js`).toBe("function");
    }
  });
});
