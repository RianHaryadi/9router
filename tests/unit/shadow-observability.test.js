import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  dispatchShadow,
  recentShadowDispatches,
  resetShadowRouter,
  shadowStats,
} from "../../src/custom/wiring/shadowDispatch.js";

// The shadow dispatch always runs with stream:false, so the provider answers
// with a plain JSON body.
function jsonReply(text) {
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}

const TARGET = { provider: "anthropic", model: "claude" };

describe("shadow configuration changes take effect", () => {
  beforeEach(() => {
    resetShadowRouter();
  });

  it("picks up a new target without a restart", async () => {
    const dispatch = vi.fn(async () => new Response(jsonReply("x"), { status: 200 }));

    await dispatchShadow({
      requestId: "r1",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [TARGET] },
      dispatch,
    });
    expect(dispatch.mock.calls[0][0].model).toBe("anthropic/claude");

    // The owner edits the target in the dashboard.
    await dispatchShadow({
      requestId: "r2",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [{ provider: "google", model: "gemini" }] },
      dispatch,
    });
    expect(dispatch.mock.calls[1][0].model).toBe("google/gemini");
  });

  it("picks up a new ratio without a restart", async () => {
    const dispatch = vi.fn(async () => new Response(jsonReply("x"), { status: 200 }));

    // Ratio 1 — always sampled.
    await dispatchShadow({
      requestId: "r3",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [TARGET] },
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);

    // The owner turns the ratio down to 0 — no further dispatch.
    await dispatchShadow({
      requestId: "r4",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 0, targets: [TARGET] },
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps the recorded history when the configuration changes", async () => {
    const dispatch = vi.fn(async () => new Response(jsonReply("same answer"), { status: 200 }));

    await dispatchShadow({
      requestId: "r5",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [TARGET] },
      dispatch,
      primaryText: "same answer",
    });
    expect(shadowStats().total).toBe(1);

    // The config changes — the router is rebuilt, but the history must survive.
    await dispatchShadow({
      requestId: "r6",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [{ provider: "google", model: "gemini" }] },
      dispatch,
      primaryText: "same answer",
    });

    expect(shadowStats().total).toBe(2);
    expect(shadowStats().matched).toBe(2);
    expect(recentShadowDispatches(10)).toHaveLength(2);
  });
});

describe("shadow statistics", () => {
  beforeEach(() => {
    resetShadowRouter();
  });

  it("counts an identical pair as matched and reports a match rate", async () => {
    const dispatch = vi.fn(async () => new Response(jsonReply("same"), { status: 200 }));
    await dispatchShadow({
      requestId: "m1",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [TARGET] },
      dispatch,
      primaryText: "same",
    });
    const stats = shadowStats();
    expect(stats.matched).toBe(1);
    expect(stats.matchRate).toBe(1);
  });

  it("counts a differing pair as compared but not matched", async () => {
    const dispatch = vi.fn(async () => new Response(jsonReply("different"), { status: 200 }));
    await dispatchShadow({
      requestId: "m2",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [TARGET] },
      dispatch,
      primaryText: "original",
    });
    const stats = shadowStats();
    expect(stats.compared).toBe(1);
    expect(stats.matched).toBe(0);
    expect(stats.matchRate).toBe(0);
  });

  it("does not count a record with no shadow answer as compared", async () => {
    const dispatch = vi.fn(async () => new Response(jsonReply(""), { status: 200 }));
    await dispatchShadow({
      requestId: "m3",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [TARGET] },
      dispatch,
      primaryText: "original",
    });
    expect(shadowStats().compared).toBe(0);
    expect(shadowStats().total).toBe(1);
  });
});
