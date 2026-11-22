import { describe, it, expect } from "vitest";
import {
  hashSample,
  shouldShadow,
  createShadowRouter,
  compareResponses,
  createShadowStore,
} from "../../src/custom/routing/shadow.js";

describe("src/custom/routing/shadow", () => {
  describe("hashSample", () => {
    it("is deterministic for the same string", () => {
      expect(hashSample("req-1")).toBe(hashSample("req-1"));
      expect(hashSample("req-1")).toBe(hashSample("req-1"));
    });

    it("stays inside [0, buckets)", () => {
      for (let i = 0; i < 200; i++) {
        const bucket = hashSample(`req-${i}`, 100);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(100);
      }
    });

    it("honours a custom bucket count", () => {
      for (let i = 0; i < 100; i++) {
        const bucket = hashSample(`req-${i}`, 7);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(7);
      }
    });

    it("spreads different strings across buckets", () => {
      const seen = new Set();
      for (let i = 0; i < 500; i++) seen.add(hashSample(`req-${i}`, 100));
      expect(seen.size).toBeGreaterThan(50);
    });
  });

  describe("shouldShadow", () => {
    it("ratio 0 never shadows", () => {
      for (let i = 0; i < 100; i++) {
        expect(shouldShadow({ requestId: `req-${i}`, ratio: 0 })).toBe(false);
      }
    });

    it("ratio 1 always shadows", () => {
      for (let i = 0; i < 100; i++) {
        expect(shouldShadow({ requestId: `req-${i}`, ratio: 1 })).toBe(true);
      }
    });

    it("is deterministic per request id", () => {
      const first = shouldShadow({ requestId: "stable-id", ratio: 0.5 });
      for (let i = 0; i < 100; i++) {
        expect(shouldShadow({ requestId: "stable-id", ratio: 0.5 })).toBe(first);
      }
    });

    it("spreads sampled/not-sampled at ratio 0.5", () => {
      let sampled = 0;
      for (let i = 0; i < 1000; i++) {
        if (shouldShadow({ requestId: `req-${i}`, ratio: 0.5 })) sampled++;
      }
      expect(sampled).toBeGreaterThanOrEqual(300);
      expect(sampled).toBeLessThanOrEqual(700);
    });
  });

  describe("compareResponses", () => {
    it("matches after trim + lowercase", () => {
      const r = compareResponses("Hello", "hello ");
      expect(r.matched).toBe(true);
      expect(r.similarity).toBe(1);
    });

    it("does not match different texts", () => {
      const r = compareResponses("a", "b");
      expect(r.matched).toBe(false);
      expect(r.similarity).toBeLessThan(1);
      expect(r.similarity).toBeGreaterThanOrEqual(0);
    });

    it("empty primary never matches and yields similarity 0", () => {
      const r = compareResponses("", "x");
      expect(r.matched).toBe(false);
      expect(r.similarity).toBe(0);
    });

    it("empty shadow never matches and yields similarity 0", () => {
      const r = compareResponses("x", "");
      expect(r.matched).toBe(false);
      expect(r.similarity).toBe(0);
    });

    it("similarity grows with overlap", () => {
      const near = compareResponses("the quick brown fox", "the quick brown fox jumps");
      const far = compareResponses("the quick brown fox", "completely different wording here");
      expect(near.similarity).toBeGreaterThan(far.similarity);
      expect(near.similarity).toBeLessThanOrEqual(1);
      expect(far.similarity).toBeGreaterThanOrEqual(0);
    });
  });

  describe("createShadowStore", () => {
    it("stores, replaces and reads records by request id", () => {
      const store = createShadowStore();
      store.add("r1", { requestId: "r1", value: 1 });
      store.add("r1", { requestId: "r1", value: 2 });
      expect(store.list()).toHaveLength(1);
      expect(store.get("r1").value).toBe(2);
      expect(store.get("missing")).toBeNull();
    });

    it("evicts the oldest record when full", () => {
      const store = createShadowStore({ maxRecords: 3 });
      for (const id of ["a", "b", "c"]) store.add(id, { requestId: id });
      store.add("d", { requestId: "d" });
      expect(store.list()).toHaveLength(3);
      expect(store.get("a")).toBeNull();
      expect(store.get("d")).not.toBeNull();
    });

    it("clears everything", () => {
      const store = createShadowStore();
      store.add("a", { requestId: "a" });
      store.clear();
      expect(store.list()).toHaveLength(0);
    });
  });

  describe("createShadowRouter.plan", () => {
    const targets = [{ provider: "openai", model: "gpt-4o-mini" }];

    it("enabled:false always returns a null shadow", () => {
      const router = createShadowRouter({
        config: { enabled: false, ratio: 1, targets },
      });
      for (let i = 0; i < 50; i++) {
        const plan = router.plan({ requestId: `req-${i}`, modelInfo: {} });
        expect(plan.shadow).toBeNull();
        expect(plan.reason).toBe("disabled");
      }
    });

    it("ratio 0 always returns a null shadow", () => {
      const router = createShadowRouter({
        config: { enabled: true, ratio: 0, targets },
      });
      for (let i = 0; i < 50; i++) {
        const plan = router.plan({ requestId: `req-${i}`, modelInfo: {} });
        expect(plan.shadow).toBeNull();
        expect(plan.reason).toBe("not-sampled");
      }
    });

    it("ratio 1 always returns a shadow target", () => {
      const router = createShadowRouter({
        config: { enabled: true, ratio: 1, targets },
      });
      for (let i = 0; i < 50; i++) {
        const plan = router.plan({ requestId: `req-${i}`, modelInfo: {} });
        expect(plan.shadow).toEqual({ provider: "openai", model: "gpt-4o-mini" });
        expect(plan.reason).toBe("sampled");
      }
    });

    it("no targets returns a null shadow", () => {
      const router = createShadowRouter({
        config: { enabled: true, ratio: 1, targets: [] },
      });
      const plan = router.plan({ requestId: "req-1", modelInfo: {} });
      expect(plan.shadow).toBeNull();
      expect(plan.reason).toBe("no-targets");
    });

    it("is deterministic across 100 repeated calls", () => {
      const router = createShadowRouter({
        config: {
          enabled: true,
          ratio: 0.5,
          targets: [
            { provider: "openai", model: "gpt-4o-mini" },
            { provider: "anthropic", model: "claude-haiku-4-5" },
          ],
        },
      });
      const first = router.plan({ requestId: "req-deterministic", modelInfo: {} });
      for (let i = 0; i < 100; i++) {
        expect(router.plan({ requestId: "req-deterministic", modelInfo: {} })).toEqual(first);
      }
      expect(first.shadow === null || typeof first.shadow.provider === "string").toBe(true);
    });

    it("weighted target choice is stable and uses only configured targets", () => {
      const router = createShadowRouter({
        config: {
          enabled: true,
          ratio: 1,
          targets: [
            { provider: "openai", model: "gpt-4o-mini", weight: 3 },
            { provider: "anthropic", model: "claude-haiku-4-5", weight: 1 },
          ],
        },
      });
      const allowed = new Set(["openai/gpt-4o-mini", "anthropic/claude-haiku-4-5"]);
      const counts = {};
      for (let i = 0; i < 500; i++) {
        const id = `req-${i}`;
        const plan = router.plan({ requestId: id, modelInfo: {} });
        const key = `${plan.shadow.provider}/${plan.shadow.model}`;
        expect(allowed.has(key)).toBe(true);
        counts[key] = (counts[key] ?? 0) + 1;
        expect(router.plan({ requestId: id, modelInfo: {} })).toEqual(plan);
      }
      expect(counts["openai/gpt-4o-mini"]).toBeGreaterThan(counts["anthropic/claude-haiku-4-5"]);
    });

    it("a custom sampler is honoured", () => {
      const router = createShadowRouter({
        config: { enabled: true, ratio: 0.5, targets },
        sample: () => false,
      });
      const plan = router.plan({ requestId: "req-1", modelInfo: {} });
      expect(plan.shadow).toBeNull();
      expect(plan.reason).toBe("not-sampled");
    });

    it("never throws on malformed input", () => {
      const router = createShadowRouter();
      expect(() => router.plan()).not.toThrow();
      expect(router.plan().shadow).toBeNull();
      expect(() => router.record()).not.toThrow();
      expect(() => router.stats()).not.toThrow();
    });
  });

  describe("createShadowRouter.record + stats", () => {
    it("reflects a matching comparison", () => {
      const router = createShadowRouter({
        config: { enabled: true, ratio: 1, targets: [{ provider: "openai", model: "gpt-4o-mini" }] },
      });
      router.record({
        requestId: "r1",
        primary: { provider: "anthropic", model: "claude-opus-4-1" },
        shadow: { provider: "openai", model: "gpt-4o-mini" },
        primaryText: "Hello",
        shadowText: "hello ",
        latencyMs: 120,
      });
      const stats = router.stats();
      expect(stats.total).toBe(1);
      expect(stats.compared).toBe(1);
      expect(stats.matched).toBe(1);
      expect(stats.errors).toBe(0);
      expect(stats.byTarget["openai/gpt-4o-mini"]).toBe(1);
    });

    it("counts errors", () => {
      const router = createShadowRouter();
      router.record({ requestId: "e1", primaryText: "a", shadowText: "b", error: new Error("boom") });
      const stats = router.stats();
      expect(stats.errors).toBe(1);
      expect(stats.total).toBe(1);
      expect(stats.matched).toBe(0);
    });

    it("a later record for the same request id replaces the earlier one", () => {
      const router = createShadowRouter();
      router.record({ requestId: "dup", primaryText: "a", shadowText: "a" });
      router.record({ requestId: "dup", primaryText: "a", shadowText: "b" });
      const stats = router.stats();
      expect(stats.total).toBe(1);
      expect(stats.matched).toBe(0);
    });

    it("stats start empty", () => {
      const router = createShadowRouter();
      expect(router.stats()).toEqual({
        total: 0,
        compared: 0,
        matched: 0,
        errors: 0,
        byTarget: {},
      });
    });
  });
});
