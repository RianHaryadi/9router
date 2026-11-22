import assert from "node:assert";
import { describe, it } from "vitest";
import { createIdempotencyStore } from "../../src/custom/idempotency/index.js";

describe("src/custom/idempotency", () => {
  // Helper: deterministic clock
  function clock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
  }

  describe("createIdempotencyStore — defaults", () => {
    it("returns an object with claim/complete/get/seq/invalidate/clear/stats", () => {
      const store = createIdempotencyStore();
      assert.strictEqual(typeof store.claim, "function");
      assert.strictEqual(typeof store.complete, "function");
      assert.strictEqual(typeof store.get, "function");
      assert.strictEqual(typeof store.seq, "function");
      assert.strictEqual(typeof store.invalidate, "function");
      assert.strictEqual(typeof store.clear, "function");
      assert.strictEqual(typeof store.stats, "function");
    });
  });

  describe("claim — first attempt", () => {
    it("returns in-progress with seq=1 on first claim", () => {
      const store = createIdempotencyStore();
      const r = store.claim("key1", "digest-abc");
      assert.strictEqual(r.status, "in-progress");
      assert.strictEqual(r.seq, 1);
    });
  });

  describe("claim — in-progress (same digest, not completed)", () => {
    it("returns in-progress again with incremented seq, not re-executed", () => {
      const store = createIdempotencyStore();
      store.claim("key1", "digest-abc");
      const r = store.claim("key1", "digest-abc");
      assert.strictEqual(r.status, "in-progress");
      assert.strictEqual(r.seq, 2);
    });
  });

  describe("complete", () => {
    it("marks in-progress entry completed; get returns completed+value", () => {
      const store = createIdempotencyStore();
      store.claim("key1", "digest-abc");
      const ok = store.complete("key1", "digest-abc", { result: 42 });
      assert.strictEqual(ok, true);
      const g = store.get("key1");
      assert.strictEqual(g.status, "completed");
      assert.deepStrictEqual(g.value, { result: 42 });
    });

    it("complete on missing key returns false", () => {
      const store = createIdempotencyStore();
      assert.strictEqual(store.complete("nokey", "x", "v"), false);
    });

    it("complete with wrong digest returns false (no overwrite)", () => {
      const store = createIdempotencyStore();
      store.claim("key1", "digest-abc");
      assert.strictEqual(store.complete("key1", "digest-WRONG", "v"), false);
      const g = store.get("key1");
      assert.strictEqual(g.status, "in-progress");
    });

    it("complete on already-completed key returns true (idempotent no-op)", () => {
      const store = createIdempotencyStore();
      store.claim("key1", "d");
      assert.strictEqual(store.complete("key1", "d", "v"), true);
      // second complete with same digest — should not error, value unchanged
      assert.strictEqual(store.complete("key1", "d", "v2"), true);
      const g = store.get("key1");
      assert.deepStrictEqual(g.value, "v"); // original value preserved
    });
  });

  describe("claim — replay after complete (same digest)", () => {
    it("returns completed with original value, NOT re-executed", () => {
      const store = createIdempotencyStore();
      store.claim("key1", "d");
      store.complete("key1", "d", "original-value");
      const r = store.claim("key1", "d");
      assert.strictEqual(r.status, "completed");
      assert.strictEqual(r.value, "original-value");
    });
  });

  describe("claim — replay after complete (DIFFERENT digest)", () => {
    it("returns conflict with expectedDigest", () => {
      const store = createIdempotencyStore();
      store.claim("key1", "digest-A");
      store.complete("key1", "digest-A", "result-A");
      const r = store.claim("key1", "digest-B");
      assert.strictEqual(r.status, "conflict");
      assert.strictEqual(r.expectedDigest, "digest-A");
    });

    it("conflict does NOT overwrite the stored value", () => {
      const store = createIdempotencyStore();
      store.claim("key1", "A");
      store.complete("key1", "A", "val-A");
      store.claim("key1", "B"); // conflict
      const g = store.get("key1");
      assert.strictEqual(g.status, "completed");
      assert.strictEqual(g.value, "val-A");
    });
  });

  describe("seq — monotonic per key", () => {
    it("increments per claim attempt for same key", () => {
      const store = createIdempotencyStore();
      store.claim("k", "d");
      assert.strictEqual(store.seq("k"), 1);
      store.claim("k", "d");
      assert.strictEqual(store.seq("k"), 2);
      store.claim("k", "d");
      assert.strictEqual(store.seq("k"), 3);
    });

    it("different keys have independent seq", () => {
      const store = createIdempotencyStore();
      store.claim("a", "d");
      store.claim("b", "d");
      store.claim("a", "d");
      assert.strictEqual(store.seq("a"), 2);
      assert.strictEqual(store.seq("b"), 1);
    });

    it("seq for missing key returns 0", () => {
      const store = createIdempotencyStore();
      assert.strictEqual(store.seq("missing"), 0);
    });
  });

  describe("get — missing key", () => {
    it("returns status=missing", () => {
      const store = createIdempotencyStore();
      assert.strictEqual(store.get("nokey").status, "missing");
    });
  });

  describe("invalidate", () => {
    it("removes the entry; subsequent claim is fresh (seq resets to 1)", () => {
      const store = createIdempotencyStore();
      store.claim("k", "d");
      store.claim("k", "d"); // seq 2
      store.invalidate("k");
      assert.strictEqual(store.get("k").status, "missing");
      const r = store.claim("k", "d");
      assert.strictEqual(r.status, "in-progress");
      assert.strictEqual(r.seq, 1); // fresh
    });

    it("invalidate on missing key is a no-op (no throw)", () => {
      const store = createIdempotencyStore();
      store.invalidate("nokey"); // must not throw
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      const store = createIdempotencyStore();
      store.claim("a", "d");
      store.claim("b", "d");
      store.clear();
      assert.strictEqual(store.get("a").status, "missing");
      assert.strictEqual(store.get("b").status, "missing");
      assert.strictEqual(store.stats().size, 0);
    });
  });

  describe("stats", () => {
    it("reports size, completed, inProgress, evictions, conflicts", () => {
      const store = createIdempotencyStore();
      const s = store.stats();
      assert.strictEqual(s.size, 0);
      assert.strictEqual(s.completed, 0);
      assert.strictEqual(s.inProgress, 0);
      assert.strictEqual(s.evictions, 0);
      assert.strictEqual(s.conflicts, 0);

      store.claim("a", "d");
      assert.strictEqual(store.stats().inProgress, 1);

      store.complete("a", "d", "v");
      assert.strictEqual(store.stats().completed, 1);
      assert.strictEqual(store.stats().inProgress, 0);
    });

    it("counts conflicts", () => {
      const store = createIdempotencyStore();
      store.claim("k", "A");
      store.complete("k", "A", "v");
      store.claim("k", "B"); // conflict
      assert.strictEqual(store.stats().conflicts, 1);
    });
  });

  describe("TTL expiry (lazy, via injected now)", () => {
    it("expired entry behaves as missing on access", () => {
      const c = clock(0);
      const store = createIdempotencyStore({ ttlMs: 1000, now: c.now });
      store.claim("k", "d");
      c.set(500);
      assert.strictEqual(store.get("k").status, "in-progress");
      c.set(1500); // past 1000ms ttl
      assert.strictEqual(store.get("k").status, "missing");
    });

    it("TTL does not apply to completed entries", () => {
      const c = clock(0);
      const store = createIdempotencyStore({ ttlMs: 1000, now: c.now });
      store.claim("k", "d");
      store.complete("k", "d", "v");
      c.set(9999);
      const g = store.get("k");
      assert.strictEqual(g.status, "completed");
      assert.strictEqual(g.value, "v");
    });
  });

  describe("LRU eviction at maxEntries", () => {
    it("evicts least-recently-used entry when over maxEntries", () => {
      const store = createIdempotencyStore({ maxEntries: 2, ttlMs: 999999 });
      store.claim("A", "d");
      store.claim("B", "d");
      // A is now LRU; claiming C should evict A
      store.claim("C", "d");
      assert.strictEqual(store.get("A").status, "missing");
      assert.strictEqual(store.get("B").status, "in-progress");
      assert.strictEqual(store.get("C").status, "in-progress");
      assert.strictEqual(store.stats().evictions, 1);
    });

    it("access bumps LRU position (get counts as access)", () => {
      const store = createIdempotencyStore({ maxEntries: 2, ttlMs: 999999 });
      store.claim("A", "d");
      store.claim("B", "d");
      store.get("A"); // bump A → B is now LRU
      store.claim("C", "d"); // evicts B
      assert.strictEqual(store.get("A").status, "in-progress");
      assert.strictEqual(store.get("B").status, "missing");
      assert.strictEqual(store.get("C").status, "in-progress");
    });
  });
});
