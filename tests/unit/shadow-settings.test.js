import { describe, it, expect } from "vitest";

import {
  normalizeShadowSettings,
  normalizeShadowTarget,
} from "../../src/custom/routing/shadowSettings.js";

// The shadow settings are written straight into the settings row, so their
// shape is checked at the trust boundary: a ratio of 5 or a target without a
// model would reach the router and be silently misread.

describe("normalizeShadowTarget", () => {
  it("trims the provider and the model", () => {
    const result = normalizeShadowTarget({ provider: "  anthropic ", model: " claude " });
    expect(result).toEqual({ ok: true, value: { provider: "anthropic", model: "claude", weight: 1 } });
  });

  it("keeps a positive weight", () => {
    const result = normalizeShadowTarget({ provider: "anthropic", model: "claude", weight: 3 });
    expect(result.value.weight).toBe(3);
  });

  it("falls back to weight 1 for a missing or invalid weight", () => {
    expect(normalizeShadowTarget({ provider: "a", model: "b" }).value.weight).toBe(1);
    expect(normalizeShadowTarget({ provider: "a", model: "b", weight: 0 }).value.weight).toBe(1);
    expect(normalizeShadowTarget({ provider: "a", model: "b", weight: -5 }).value.weight).toBe(1);
    expect(normalizeShadowTarget({ provider: "a", model: "b", weight: "x" }).value.weight).toBe(1);
  });

  it("rejects a target without a provider or without a model", () => {
    expect(normalizeShadowTarget({ model: "claude" }).ok).toBe(false);
    expect(normalizeShadowTarget({ provider: "anthropic" }).ok).toBe(false);
    expect(normalizeShadowTarget({ provider: "  ", model: "claude" }).ok).toBe(false);
    expect(normalizeShadowTarget(null).ok).toBe(false);
  });
});

describe("normalizeShadowSettings", () => {
  it("accepts a valid ratio", () => {
    const body = { shadowRoutingRatio: 0.25 };
    expect(normalizeShadowSettings(body)).toEqual({ ok: true });
    expect(body.shadowRoutingRatio).toBe(0.25);
  });

  it("rejects a ratio outside 0..1", () => {
    expect(normalizeShadowSettings({ shadowRoutingRatio: 5 }).ok).toBe(false);
    expect(normalizeShadowSettings({ shadowRoutingRatio: -1 }).ok).toBe(false);
    expect(normalizeShadowSettings({ shadowRoutingRatio: "abc" }).ok).toBe(false);
  });

  it("rejects targets that are not an array", () => {
    expect(normalizeShadowSettings({ shadowRoutingTargets: "nope" }).ok).toBe(false);
  });

  it("rejects a target list with an invalid entry", () => {
    const result = normalizeShadowSettings({
      shadowRoutingTargets: [{ provider: "anthropic", model: "claude" }, { provider: "google" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/provider and a model/);
  });

  it("normalizes a valid target list", () => {
    const body = { shadowRoutingTargets: [{ provider: " anthropic ", model: " claude " }] };
    expect(normalizeShadowSettings(body)).toEqual({ ok: true });
    expect(body.shadowRoutingTargets).toEqual([{ provider: "anthropic", model: "claude", weight: 1 }]);
  });

  it("leaves an unrelated body untouched", () => {
    const body = { promptInspectionEnabled: true };
    expect(normalizeShadowSettings(body)).toEqual({ ok: true });
    expect(body).toEqual({ promptInspectionEnabled: true });
  });
});
