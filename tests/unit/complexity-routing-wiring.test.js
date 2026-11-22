import { describe, it, expect } from "vitest";

import {
  normalizeComplexityTiers,
  resolveComplexityModel,
} from "../../src/custom/routing/complexityRouting.js";
import { classifyComplexity } from "../../src/custom/routing/complexity.js";

// Complexity routing sends a simple request to a cheaper model and a heavy
// one to a stronger model. It is off by default and never changes a request
// that has no tier for its level.

const TIERS = {
  simple: "openai/gpt-4o-mini",
  medium: "anthropic/claude-sonnet-4",
  complex: "anthropic/claude-opus-4",
};

describe("normalizeComplexityTiers", () => {
  it("keeps the three levels and trims the values", () => {
    expect(normalizeComplexityTiers({
      simple: "  openai/gpt-4o-mini ",
      medium: "anthropic/claude-sonnet-4",
      complex: "anthropic/claude-opus-4",
    })).toEqual(TIERS);
  });

  it("drops a level without a model", () => {
    expect(normalizeComplexityTiers({ simple: "openai/gpt-4o-mini", medium: "", complex: null }))
      .toEqual({ simple: "openai/gpt-4o-mini" });
  });

  it("drops an unknown level", () => {
    expect(normalizeComplexityTiers({ simple: "a/b", insane: "c/d" })).toEqual({ simple: "a/b" });
  });

  it("returns an empty map for a non-object", () => {
    expect(normalizeComplexityTiers(null)).toEqual({});
    expect(normalizeComplexityTiers("nope")).toEqual({});
  });
});

describe("resolveComplexityModel", () => {
  it("does nothing when the feature is off", () => {
    const result = resolveComplexityModel({
      body: { messages: [{ role: "user", content: "hi" }] },
      requestedModel: "anthropic/claude-opus-4",
      config: { enabled: false, tiers: TIERS },
    });
    expect(result.model).toBe("anthropic/claude-opus-4");
    expect(result.changed).toBe(false);
  });

  it("does nothing when no tier is configured", () => {
    const result = resolveComplexityModel({
      body: { messages: [{ role: "user", content: "hi" }] },
      requestedModel: "anthropic/claude-opus-4",
      config: { enabled: true, tiers: {} },
    });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("no-tiers");
  });

  it("routes a one-line question to the simple tier", () => {
    const result = resolveComplexityModel({
      body: { messages: [{ role: "user", content: "hi" }] },
      requestedModel: "anthropic/claude-opus-4",
      config: { enabled: true, tiers: TIERS },
    });
    expect(result.changed).toBe(true);
    expect(result.level).toBe("simple");
    expect(result.model).toBe("openai/gpt-4o-mini");
  });

  it("routes a long, tool-heavy request to the complex tier", () => {
    const body = {
      messages: Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(500),
      })),
      tools: Array.from({ length: 8 }, (_, i) => ({ type: "function", function: { name: `t${i}` } })),
    };
    const result = resolveComplexityModel({
      body,
      requestedModel: "openai/gpt-4o-mini",
      config: { enabled: true, tiers: TIERS },
    });
    expect(result.level).toBe("complex");
    expect(result.model).toBe("anthropic/claude-opus-4");
  });

  it("keeps the requested model when the level has no tier", () => {
    const result = resolveComplexityModel({
      body: { messages: [{ role: "user", content: "hi" }] },
      requestedModel: "anthropic/claude-opus-4",
      config: { enabled: true, tiers: { complex: "anthropic/claude-opus-4" } },
    });
    expect(result.changed).toBe(false);
    expect(result.model).toBe("anthropic/claude-opus-4");
    expect(result.reason).toBe("no-tier");
  });

  it("keeps the requested model when the tier names the same model", () => {
    const result = resolveComplexityModel({
      body: { messages: [{ role: "user", content: "hi" }] },
      requestedModel: "openai/gpt-4o-mini",
      config: { enabled: true, tiers: { simple: "openai/gpt-4o-mini" } },
    });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("same-model");
  });

  it("fails open when the classifier throws", () => {
    const result = resolveComplexityModel({
      body: {},
      requestedModel: "anthropic/claude-opus-4",
      config: { enabled: true, tiers: TIERS },
      classify: () => { throw new Error("boom"); },
    });
    expect(result.changed).toBe(false);
    expect(result.model).toBe("anthropic/claude-opus-4");
  });

  it("fails open on an unusable classification", () => {
    const result = resolveComplexityModel({
      body: {},
      requestedModel: "anthropic/claude-opus-4",
      config: { enabled: true, tiers: TIERS },
      classify: () => ({ level: "galactic", score: 1 }),
    });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("unclassified");
  });
});

describe("complexity routing and the classifier agree", () => {
  it("classifies a bare greeting as simple", () => {
    expect(classifyComplexity({ messages: [{ role: "user", content: "hi" }] }).level).toBe("simple");
  });

  it("classifies a huge tool-heavy conversation as complex", () => {
    const body = {
      messages: Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "y".repeat(900),
      })),
      tools: Array.from({ length: 8 }, (_, i) => ({ type: "function", function: { name: `t${i}` } })),
    };
    expect(classifyComplexity(body).level).toBe("complex");
  });
});
