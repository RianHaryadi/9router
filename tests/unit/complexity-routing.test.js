import assert from "node:assert";
import { describe, it } from "vitest";
import { classifyComplexity, pickRouteTier } from "../../src/custom/routing/complexity.js";

describe("src/custom/routing/complexity", () => {
  const simple = { model: "gpt-4", messages: [{ role: "user", content: "hi" }] };

  describe("classifyComplexity", () => {
    it("empty / minimal body -> medium default", () => {
      assert.deepStrictEqual(classifyComplexity({ model: "gpt-4" }), { level: "medium", score: 0.5, reasons: ["default"] });
    });

    it("unknown input never throws", () => {
      const r = classifyComplexity(null);
      assert.strictEqual(r.level, "medium");
      assert.strictEqual(r.score, 0.5);
      assert.deepStrictEqual(r.reasons, ["default"]);
    });

    it("simple: 1 short message", () => {
      const r = classifyComplexity(simple);
      assert.strictEqual(r.level, "simple");
      assert.ok(r.score <= 0.33);
    });

    it("reason token: many-messages (>40)", () => {
      const body = { model: "gpt-4", messages: Array.from({ length: 45 }, (_, i) => ({ role: "user", content: `msg ${i}` })) };
      const r = classifyComplexity(body);
      assert.strictEqual(r.level, "complex");
      assert.ok(r.reasons.includes("many-messages"), r.reasons.join(","));
    });

    it("reason token: long-conversation (>12000 chars)", () => {
      const body = { model: "gpt-4", messages: [{ role: "user", content: "x".repeat(13000) }] };
      const r = classifyComplexity(body);
      assert.ok(r.reasons.includes("long-conversation"), r.reasons.join(","));
      assert.strictEqual(r.level, "complex");
    });

    it("reason token: many-tools (>4)", () => {
      const tools = ["t1", "t2", "t3", "t4", "t5"].map((t) => ({ type: "function", function: { name: t } }));
      const r = classifyComplexity({ model: "gpt-4", messages: [{ role: "user", content: "hello" }], tools });
      assert.ok(r.reasons.includes("many-tools"), r.reasons.join(","));
    });

    it("reason token: forced-tool-choice", () => {
      const r = classifyComplexity({ model: "gpt-4", messages: [{ role: "user", content: "hello" }], tool_choice: { type: "function", function: { name: "t1" } } });
      assert.ok(r.reasons.includes("forced-tool-choice"), r.reasons.join(","));
    });

    it("reason token: big-system prompt (>2000 chars)", () => {
      const body = { model: "gpt-4", system: "y".repeat(2100), messages: [{ role: "user", content: "hello" }] };
      const r = classifyComplexity(body);
      assert.ok(r.reasons.includes("big-system"), r.reasons.join(","));
    });

    it("reason token: big-single-message (>6000 chars)", () => {
      const r = classifyComplexity({ model: "gpt-4", messages: [{ role: "user", content: "z".repeat(6100) }] });
      assert.ok(r.reasons.includes("big-single-message"), r.reasons.join(","));
    });

    it("reason token: json-schema response_format", () => {
      const r = classifyComplexity({ model: "gpt-4", messages: [{ role: "user", content: "hello" }], response_format: { json_schema: { name: "r" } } });
      assert.ok(r.reasons.includes("json-schema"), r.reasons.join(","));
    });

    it("reason token: code-fence", () => {
      const r = classifyComplexity({
        model: "gpt-4",
        messages: [{ role: "user", content: "```js\nconst a = 1;\n```" }],
      });
      assert.ok(r.reasons.includes("code-fence"), r.reasons.join(","));
    });

    it("reason token: image-parts", () => {
      const r = classifyComplexity({
        model: "gpt-4",
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://x" } }] }],
      });
      assert.ok(r.reasons.includes("image-parts"), r.reasons.join(","));
    });

    it("reason token: document-parts", () => {
      const r = classifyComplexity({
        model: "gpt-4",
        messages: [{ role: "user", content: [{ type: "document", document: "http://x.pdf" }] }],
      });
      assert.ok(r.reasons.includes("document-parts"), r.reasons.join(","));
    });

    it("reasons order is deterministic", () => {
      const r = classifyComplexity({ model: "gpt-4", messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "t1" } }] });
      const r2 = classifyComplexity({ model: "gpt-4", messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "t1" } }] });
      assert.deepStrictEqual(r, r2);
    });

    it("complex: long conversation itself", () => {
      const body = {
        model: "gpt-4",
        messages: Array.from({ length: 55 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `line ${i}` })),
      };
      const r = classifyComplexity(body);
      assert.strictEqual(r.level, "complex");
    });

    it("score clamps at 1 (1MB body)", () => {
      const huge = "a".repeat(1048576);
      const r = classifyComplexity({ model: "gpt-4", messages: [{ role: "user", content: huge }] });
      assert.strictEqual(r.score, 1);
      assert.strictEqual(r.level, "complex");
    });

    it("scores are within 0..1", () => {
      for (let i = 0; i < 10; i++) {
        const r = classifyComplexity({
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "there" }],
          tools: [{ type: "function", function: { name: "t1" } }],
          system: "o".repeat(500),
          response_format: { json_schema: { name: "r" } },
          tool_choice: { type: "function", function: { name: "t1" } },
        });
        assert.ok(r.score >= 0 && r.score <= 1);
        assert.ok(["simple", "medium", "complex"].includes(r.level));
      }
    });
  });

  describe("pickRouteTier", () => {
    it("valid mapping returns tier per level", () => {
      const tiers = { simple: "gpt-3.5-turbo", medium: "gpt-4", complex: "gpt-4o" };
      assert.strictEqual(pickRouteTier({ level: "simple", score: 0.1, reasons: [] }, tiers), "gpt-3.5-turbo");
      assert.strictEqual(pickRouteTier({ level: "medium", score: 0.5, reasons: [] }, tiers), "gpt-4");
      assert.strictEqual(pickRouteTier({ level: "complex", score: 0.9, reasons: [] }, tiers), "gpt-4o");
    });

    it("missing tier -> null", () => {
      assert.strictEqual(pickRouteTier({ level: "complex", score: 0.9, reasons: [] }, { simple: "a", medium: "b" }), null);
    });

    it("invalid classification -> null", () => {
      assert.strictEqual(pickRouteTier({ level: "nope", score: 0.5, reasons: [] }, { simple: "a", medium: "b", complex: "c" }), null);
      assert.strictEqual(pickRouteTier({ level: null }, { simple: "a", medium: "b", complex: "c" }), null);
      assert.strictEqual(pickRouteTier(null, { simple: "a", medium: "b", complex: "c" }), null);
      assert.strictEqual(pickRouteTier(undefined, { simple: "a", medium: "b", complex: "c" }), null);
    });
  });
});
