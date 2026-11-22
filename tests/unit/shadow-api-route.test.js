import { describe, it, expect, beforeEach } from "vitest";

import { GET as shadowGet } from "../../src/app/api/health/shadow/route.js";
import { resetShadowRouter, dispatchShadow } from "../../src/custom/wiring/shadowDispatch.js";

// The shadow API exposes what the shadow router has been doing. The ANSWER
// TEXT is deliberately never returned: a shadow record holds the user's own
// conversation, and the dashboard only needs the verdict.

function get(url) {
  return new Request(url);
}

function jsonReply(text) {
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}

describe("GET /api/health/shadow", () => {
  beforeEach(() => {
    resetShadowRouter();
  });

  it("returns the shadow envelope", async () => {
    const res = await shadowGet(get("http://localhost/api/health/shadow"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.ratio).toBe("number");
    expect(Array.isArray(body.targets)).toBe(true);
    expect(body.stats).toBeTypeOf("object");
    expect(typeof body.stats.total).toBe("number");
    expect(Array.isArray(body.recent)).toBe(true);
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("never returns the answer text", async () => {
    const dispatch = async () => new Response(jsonReply("a very secret answer"), { status: 200 });
    await dispatchShadow({
      requestId: "api-r1",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [{ provider: "anthropic", model: "claude" }] },
      dispatch,
      primaryText: "a very secret answer",
    });

    const res = await shadowGet(get("http://localhost/api/health/shadow"));
    const raw = await res.text();
    expect(raw).not.toContain("a very secret answer");

    const body = JSON.parse(raw);
    expect(body.recent).toHaveLength(1);
    const entry = body.recent[0];
    expect(entry.requestId).toBe("api-r1");
    expect(entry.primaryText).toBeUndefined();
    expect(entry.shadowText).toBeUndefined();
    expect(entry.matched).toBe(true);
    expect(entry.hasPrimaryText).toBe(true);
  });

  it("clamps the limit to a sane range", async () => {
    const res = await shadowGet(get("http://localhost/api/health/shadow?limit=99999"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.recent)).toBe(true);
    expect(body.recent.length).toBeLessThanOrEqual(200);
  });
});
