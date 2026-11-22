import assert from "node:assert";
import { describe, it } from "vitest";
import { fingerprint, createSemanticCache } from "../../src/custom/cache/semantic.js";

describe("src/custom/cache/semantic", () => {
  describe("fingerprint", () => {
    const base = {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      max_tokens: 100,
      top_p: 1,
      stop: ["\n"],
      user: "alice",
      stream: false,
    };

    it("stable across top-level object key order", () => {
      const reordered = {
        stream: false,
        temperature: 0.7,
        model: "gpt-4",
        user: "alice",
        max_tokens: 100,
        messages: [{ content: "hi", role: "user" }],
        top_p: 1,
        stop: ["\n"],
      };
      assert.strictEqual(fingerprint(base), fingerprint(reordered));
    });

    it("different model -> different fp", () => {
      const other = { ...base, model: "gpt-3.5-turbo" };
      assert.notStrictEqual(fingerprint(base), fingerprint(other));
    });

    it("different messages content -> different fp", () => {
      const other = { ...base, messages: [{ role: "user", content: "bye" }] };
      assert.notStrictEqual(fingerprint(base), fingerprint(other));
    });

    it("different temperature -> different fp", () => {
      const other = { ...base, temperature: 0.9 };
      assert.notStrictEqual(fingerprint(base), fingerprint(other));
    });

    it("excluded keys (user, stream) do not change fp", () => {
      const withStream = { ...base, stream: true, user: "bob" };
      assert.strictEqual(fingerprint(base), fingerprint(withStream));
    });

    it("keys starting with _ are excluded", () => {
      const extra = { ...base, _customRtkPolicy: "x", _toolNameMap: { a: 1 } };
      assert.strictEqual(fingerprint(base), fingerprint(extra));
    });

    it("requestId and metadata are excluded", () => {
      const extra = { ...base, requestId: "abc", metadata: { foo: 1 } };
      assert.strictEqual(fingerprint(base), fingerprint(extra));
    });

    it("tools present + tool_choice in fp, stable under nested key order", () => {
      const a = {
        ...base,
        tool_choice: "auto",
        tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: { x: { type: "string" } } } } }],
      };
      const b = {
        ...base,
        tools: [{ function: { parameters: { properties: { x: { type: "string" } }, type: "object" }, name: "f" }, type: "function" }],
        tool_choice: "auto",
      };
      assert.strictEqual(fingerprint(a), fingerprint(b));
    });

    it("empty messages list allowed", () => {
      assert.ok(typeof fingerprint({ ...base, messages: [] }) === "string");
    });

    it("non-string content (array-of-parts) serialized deterministically, order-preserving part list", () => {
      const a = { ...base, messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "http://x" } }] }] };
      const b = { ...base, messages: [{ role: "user", content: [{ image_url: { url: "http://x" }, type: "image_url" }, { type: "text", text: "hi" }] }] };
      // part ORDER is semantics: different order -> different fp
      assert.notStrictEqual(fingerprint(a), fingerprint(b));
      const c = { ...base, messages: [{ role: "user", content: [{ text: "hi", type: "text" }, { type: "image_url", image_url: { url: "http://x" } }] }] };
      // same parts, nested object key order does not matter
      assert.strictEqual(fingerprint(a), fingerprint(c));
    });

    it("absent optional keys vs explicitly present", () => {
      const a = { model: "gpt-4", messages: [{ role: "user", content: "hi" }] };
      const b = { model: "gpt-4", messages: [{ role: "user", content: "hi" }], temperature: 0.7, top_p: 1 };
      assert.notStrictEqual(fingerprint(a), fingerprint(b));
    });
  });

  describe("createSemanticCache", () => {
    it("set/get roundtrip", () => {
      const c = createSemanticCache();
      c.set("fp1", "value1");
      assert.strictEqual(c.get("fp1"), "value1");
    });

    it("get on unknown returns null", () => {
      const c = createSemanticCache();
      assert.strictEqual(c.get("missing"), null);
    });

    it("expired entry yields null and is removed", () => {
      let now = 0;
      const c = createSemanticCache({ ttlMs: 100, now: () => now });
      c.set("fp", "v");
      now = 101;
      assert.strictEqual(c.get("fp"), null);
      assert.strictEqual(c.stats().size, 0);
    });

    it("not expired within ttl", () => {
      let now = 0;
      const c = createSemanticCache({ ttlMs: 100, now: () => now });
      c.set("fp", "v");
      now = 99;
      assert.strictEqual(c.get("fp"), "v");
    });

    it("LRU eviction when over maxEntries", () => {
      const c = createSemanticCache({ maxEntries: 2 });
      c.set("a", 1);
      c.set("b", 2);
      c.get("a"); // touch a so it is most recent
      c.set("c", 3); // evict b (least recently used)
      assert.strictEqual(c.get("a"), 1);
      assert.strictEqual(c.get("c"), 3);
      assert.strictEqual(c.get("b"), null);
      assert.strictEqual(c.stats().evictions, 1);
    });

    it("hits/misses counters", () => {
      const c = createSemanticCache();
      c.set("a", 1);
      c.get("a"); // hit
      c.get("a"); // hit
      c.get("zzz"); // miss
      const st = c.stats();
      assert.strictEqual(st.hits, 2);
      assert.strictEqual(st.misses, 1);
    });

    it("delete removes entry", () => {
      const c = createSemanticCache();
      c.set("a", 1);
      assert.strictEqual(c.delete("a"), true);
      assert.strictEqual(c.get("a"), null);
      assert.strictEqual(c.delete("a"), false);
    });

    it("clear empties cache", () => {
      const c = createSemanticCache();
      c.set("a", 1);
      c.set("b", 2);
      c.clear();
      assert.strictEqual(c.stats().size, 0);
      assert.strictEqual(c.get("a"), null);
    });

    it("stores caller-supplied value as-is", () => {
      const c = createSemanticCache();
      const obj = { lines: ["data: x", "data: y"], done: true };
      c.set("fp", obj);
      assert.strictEqual(c.get("fp"), obj);
    });
  });
});
