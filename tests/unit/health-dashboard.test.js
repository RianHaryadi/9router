import { describe, expect, it } from "vitest";
import { GET as breakerGet } from "../../src/app/api/health/breaker/route.js";
import { GET as latencyGet } from "../../src/app/api/usage/latency/route.js";
import { GET as projectsGet } from "../../src/app/api/usage/projects/route.js";
import { GET as fallbacksGet } from "../../src/app/api/usage/fallbacks/route.js";
import { formatPercentile, stateVariant } from "../../src/app/(dashboard)/dashboard/health/components/helpers.js";

/**
 * helper request — passes explicit empty-determinism params (since=2099, limit=1)
 * so the test shape is stable even if the user's ~/.9router has real data.
 * Routes backed by getAdapter() which opens the real DB file; filtering by a
 * future date forces empty result sets → assertions only check envelope shape,
 * never row content.
 */
const EMPTY_SINCE = "2099-01-01T00:00:00.000Z";
const req = (url) => new Request(url);

describe("health dashboard — pure helpers", () => {
  it("formatPercentile — valid number", () => {
    expect(formatPercentile(12.4)).toBe("12 ms");
  });
  it("formatPercentile — null / undefined", () => {
    expect(formatPercentile(null)).toBe("—");
    expect(formatPercentile(undefined)).toBe("—");
  });
  it("formatPercentile — NaN", () => {
    expect(formatPercentile(NaN)).toBe("—");
  });
  it("formatPercentile — string numeric", () => {
    expect(formatPercentile("987.6")).toBe("988 ms");
  });

  it("stateVariant — closed → success", () => {
    expect(stateVariant("closed")).toBe("success");
  });
  it("stateVariant — half-open → warning", () => {
    expect(stateVariant("half-open")).toBe("warning");
  });
  it("stateVariant — open → error", () => {
    expect(stateVariant("open")).toBe("error");
  });
  it("stateVariant — unknown state → error default", () => {
    expect(stateVariant("flapping")).toBe("error");
    expect(stateVariant("")).toBe("error");
    expect(stateVariant(null)).toBe("error");
  });
});

describe("GET /api/health/breaker — handler, no DB deps", () => {
  it("returns ok + snapshot with required fields", async () => {
    const res = await breakerGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.snapshot).toBeTypeOf("object");
    expect(typeof body.snapshot.tracked).toBe("number");
    expect(typeof body.snapshot.open).toBe("number");
    expect(typeof body.snapshot.halfOpen).toBe("number");
    expect(Array.isArray(body.snapshot.entries)).toBe(true);
    expect(Array.isArray(body.blocked)).toBe(true);
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});

describe("GET /api/usage/latency — handler, DB-backed", () => {
  it("returns ok + latencyMs/ttftMs with required percentile keys + providers array", async () => {
    // since=2099 forces empty set → shape is deterministic regardless of DB content
    const res = await latencyGet(req(`http://localhost/api/usage/latency?since=${EMPTY_SINCE}&limit=1`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.count).toBe("number");

    const pctKeys = ["p50", "p90", "p95", "p99", "min", "max", "avg"];
    expect(body.latencyMs).toBeTypeOf("object");
    for (const k of pctKeys) {
      // values may be null when set is empty, but key must exist
      expect(body.latencyMs).toHaveProperty(k);
    }
    expect(body.ttftMs).toBeTypeOf("object");
    for (const k of pctKeys) {
      expect(body.ttftMs).toHaveProperty(k);
    }
    expect(Array.isArray(body.providers)).toBe(true);
  });
});

describe("GET /api/usage/projects — handler, DB-backed", () => {
  it("returns ok + projects array + total with cost & requests numbers", async () => {
    const res = await projectsGet(req(`http://localhost/api/usage/projects?since=${EMPTY_SINCE}`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.total).toBeTypeOf("object");
    expect(typeof body.total.cost).toBe("number");
    expect(typeof body.total.requests).toBe("number");

    // When DB is empty, projects is [] and totals are 0 — verify that shape
    if (body.projects.length === 0) {
      expect(body.total.cost).toBe(0);
      expect(body.total.requests).toBe(0);
    }

    // If there are rows, check each row's required fields
    for (const row of body.projects) {
      expect(typeof row.project).toBe("string");
      expect(typeof row.cost).toBe("number");
      expect(typeof row.requests).toBe("number");
      expect(typeof (row.promptTokens ?? 0)).toBe("number");
      expect(typeof (row.completionTokens ?? 0)).toBe("number");
    }
  });
});

describe("GET /api/usage/fallbacks — handler, DB-backed", () => {
  it("returns ok + events array + summary with byProvider / byReason / recent", async () => {
    const res = await fallbacksGet(
      req(`http://localhost/api/usage/fallbacks?since=${EMPTY_SINCE}&limit=1&summary=1`)
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.summary).toBeTypeOf("object");
    expect(body.summary.byProvider).toBeTypeOf("object");
    expect(body.summary.byReason).toBeTypeOf("object");
    expect(Array.isArray(body.summary.recent)).toBe(true);
  });

  it("rejects a non-ISO since with 400", async () => {
    const res = await fallbacksGet(req("http://localhost/api/usage/fallbacks?since=not-a-date"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("survives junk limit/offset without throwing", async () => {
    const res = await fallbacksGet(req("http://localhost/api/usage/fallbacks?limit=abc&offset=-3"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
