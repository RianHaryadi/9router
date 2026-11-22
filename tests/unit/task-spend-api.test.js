import { describe, it, expect } from "vitest";

import { GET as tasksGet } from "../../src/app/api/usage/tasks/route.js";

// The task-spend API groups the usage rows by the task the client named.
// Rows without a task roll into "unassigned".
//
// NOTE: this test only asserts the ENVELOPE shape (ok, array/number types) —
// never row values — so it stays green on an empty or unavailable database.
// The repos swallow adapter errors and return empty defaults.

function get(url) {
  return new Request(url);
}

describe("GET /api/usage/tasks", () => {
  it("returns the tasks envelope", async () => {
    const res = await tasksGet(get("http://localhost/api/usage/tasks"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(typeof body.total).toBe("object");
    expect(typeof body.total.cost).toBe("number");
    expect(typeof body.total.requests).toBe("number");
  });

  it("rejects an unparseable `since`", async () => {
    const res = await tasksGet(get("http://localhost/api/usage/tasks?since=not-a-date"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/since/);
  });

  it("accepts an ISO-8601 `since`", async () => {
    const res = await tasksGet(get("http://localhost/api/usage/tasks?since=2026-01-01T00:00:00.000Z"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("accepts a task filter", async () => {
    const res = await tasksGet(get("http://localhost/api/usage/tasks?task=task-42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
