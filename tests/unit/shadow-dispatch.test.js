import { describe, expect, it, vi } from "vitest";
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

describe("shadow dispatch wiring", () => {
  it("does nothing when shadow routing is disabled", async () => {
    resetShadowRouter();
    const dispatch = vi.fn();
    await dispatchShadow({
      requestId: "r1",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: false, ratio: 1, targets: [{ provider: "anthropic", model: "claude" }] },
      dispatch,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when ratio is zero", async () => {
    resetShadowRouter();
    const dispatch = vi.fn();
    await dispatchShadow({
      requestId: "r2",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 0, targets: [{ provider: "anthropic", model: "claude" }] },
      dispatch,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches to the shadow target and records the comparison", async () => {
    resetShadowRouter();
    const dispatch = vi.fn(async () => new Response(jsonReply("shadow answer"), { status: 200 }));
    await dispatchShadow({
      requestId: "r3",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] },
      config: { enabled: true, ratio: 1, targets: [{ provider: "anthropic", model: "claude" }] },
      dispatch,
      primaryText: "shadow answer",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [shadowBody] = dispatch.mock.calls[0];
    expect(shadowBody.model).toBe("anthropic/claude");
    expect(shadowBody.stream).toBe(false);

    const stats = shadowStats();
    expect(stats.total).toBe(1);
    expect(stats.compared).toBe(1);
    expect(stats.matched).toBe(1);
    expect(stats.byTarget["anthropic/claude"]).toBe(1);
  });

  it("never throws when the shadow dispatch fails", async () => {
    resetShadowRouter();
    const dispatch = vi.fn(async () => { throw new Error("shadow upstream down"); });
    await expect(dispatchShadow({
      requestId: "r4",
      modelInfo: { provider: "openai", model: "gpt-4o" },
      body: { model: "openai/gpt-4o", messages: [] },
      config: { enabled: true, ratio: 1, targets: [{ provider: "anthropic", model: "claude" }] },
      dispatch,
    })).resolves.toBeNull();
    expect(shadowStats().errors).toBe(1);
  });

  it("keeps a bounded list of recent dispatches", async () => {
    resetShadowRouter();
    const dispatch = vi.fn(async () => new Response(jsonReply("x"), { status: 200 }));
    for (let i = 0; i < 5; i++) {
      await dispatchShadow({
        requestId: `r-${i}`,
        modelInfo: { provider: "openai", model: "gpt-4o" },
        body: { model: "openai/gpt-4o", messages: [] },
        config: { enabled: true, ratio: 1, targets: [{ provider: "anthropic", model: "claude" }] },
        dispatch,
      });
    }
    const recent = recentShadowDispatches(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].requestId).toBe("r-4");
  });
});
