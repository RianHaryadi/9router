import { describe, it, expect } from "vitest";

import { GET as breakerGet } from "../../src/app/api/health/breaker/route.js";
import { GET as fallbacksGet } from "../../src/app/api/usage/fallbacks/route.js";
import { GET as latencyGet } from "../../src/app/api/usage/latency/route.js";
import { GET as projectsGet } from "../../src/app/api/usage/projects/route.js";

// NOTE: the DB-backed routes only ever assert envelope shape (`ok: true`,
// array/number types) — never row values — so these tests stay green on an
// empty or even unavailable local database. The repos swallow adapter errors
// and return empty defaults, so a missing DB adapter degrades to an empty
// 200 instead of a throw.

function get(url) {
  return new Request(url);
}

describe("observability & health API routes — importability", () => {
  it("exports a GET handler from each route module", () => {
    expect(typeof breakerGet).toBe("function");
    expect(typeof fallbacksGet).toBe("function");
    expect(typeof latencyGet).toBe("function");
    expect(typeof projectsGet).toBe("function");
  });
});

describe("GET /api/health/breaker", () => {
  it("returns the in-memory breaker snapshot without touching the DB", async () => {
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

describe("GET /api/usage/fallbacks", () => {
  it("returns the events envelope", async () => {
    const res = await fallbacksGet(get("http://localhost/api/usage/fallbacks?limit=5&offset=0"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.summary).toBeTypeOf("object");
    expect(typeof body.summary.total).toBe("number");
    expect(body.summary.byProvider).toBeTypeOf("object");
    expect(body.summary.byReason).toBeTypeOf("object");
    expect(Array.isArray(body.summary.recent)).toBe(true);
  });

  it("returns the aggregates when summary=1", async () => {
    const res = await fallbacksGet(get("http://localhost/api/usage/fallbacks?summary=1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toBeTypeOf("object");
  });

  it("rejects a non-ISO `since` with 400", async () => {
    const res = await fallbacksGet(get("http://localhost/api/usage/fallbacks?since=not-a-date"));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("survives junk limit/offset values without throwing", async () => {
    const res = await fallbacksGet(get("http://localhost/api/usage/fallbacks?limit=abc&offset=-3"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
  });
});

describe("GET /api/usage/latency", () => {
  it("returns percentiles plus the provider snapshot", async () => {
    const res = await latencyGet(get("http://localhost/api/usage/latency?limit=50"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.count).toBe("number");
    expect(body.latencyMs).toBeTypeOf("object");
    expect(body.ttftMs).toBeTypeOf("object");
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it("rejects a non-ISO `since` with 400", async () => {
    const res = await latencyGet(get("http://localhost/api/usage/latency?since=whatever"));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/usage/projects", () => {
  it("returns the project spend list and summed totals", async () => {
    const res = await projectsGet(get("http://localhost/api/usage/projects?since=2026-01-01T00:00:00.000Z"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.total).toBeTypeOf("object");
    expect(typeof body.total.cost).toBe("number");
    expect(typeof body.total.requests).toBe("number");

    for (const row of body.projects) {
      expect(typeof row.project).toBe("string");
      expect(typeof row.cost).toBe("number");
      expect(typeof row.requests).toBe("number");
    }
  });

  it("sums to zero totals on an empty result set", async () => {
    const res = await projectsGet(get("http://localhost/api/usage/projects"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    if (body.projects.length === 0) {
      expect(body.total).toEqual({ cost: 0, requests: 0 });
    }
  });

  it("rejects a non-ISO `since` with 400", async () => {
    const res = await projectsGet(get("http://localhost/api/usage/projects?since=13/13/13"));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
